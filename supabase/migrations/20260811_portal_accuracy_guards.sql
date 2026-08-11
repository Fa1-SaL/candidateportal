-- Provenance and snapshot membership make candidate ingestion deterministic.
-- A generic roster can fill missing fields, while a project-specific source
-- can replace them without a later low-authority sync undoing the correction.
alter table public.candidates
  add column if not exists portal_sync_meta jsonb not null default '{}'::jsonb;

alter table public.assignments
  add column if not exists portal_sync_meta jsonb not null default '{}'::jsonb;

alter table public.background_verification
  add column if not exists portal_sync_meta jsonb not null default '{}'::jsonb;

create table if not exists public.portal_assignment_memberships (
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  source_key text not null,
  last_seen_run_id text not null,
  last_seen_at timestamptz not null default now(),
  active boolean not null default true,
  source_sheet text,
  source_row integer,
  primary key (assignment_id, source_key)
);

create index if not exists portal_assignment_memberships_source_idx
  on public.portal_assignment_memberships (source_key, active, last_seen_run_id);

alter table public.portal_assignment_memberships enable row level security;

revoke all on public.portal_assignment_memberships from public, anon, authenticated;

create or replace function public.portal_field_priority(p_meta jsonb, p_field text)
returns integer
language sql
immutable
as $$
  select coalesce((p_meta #>> array[p_field, 'priority'])::integer, -1);
$$;

create or replace function public.portal_mark_field_source(
  p_meta jsonb,
  p_field text,
  p_priority integer,
  p_source_key text,
  p_source_sheet text,
  p_source_row integer
)
returns jsonb
language sql
stable
as $$
  select jsonb_set(
    coalesce(p_meta, '{}'::jsonb),
    array[p_field],
    jsonb_strip_nulls(jsonb_build_object(
      'priority', p_priority,
      'source_key', p_source_key,
      'source_sheet', p_source_sheet,
      'source_row', p_source_row,
      'observed_at', now()
    )),
    true
  );
$$;

create or replace function public.upsert_portal_assignments_batch(p_rows jsonb)
returns table(out_email text, out_status text, out_message text)
language plpgsql
security definer
set search_path = public
set statement_timeout = '120s'
as $$
declare
  r jsonb;
  v_email text;
  v_client_name text;
  v_vertical_name text;
  v_project_name text;
  v_source_key text;
  v_source_sheet text;
  v_sync_run_id text;
  v_priority integer;
  v_source_row integer;
  v_project_count integer;
  v_subproject_id uuid;
  v_candidate_id uuid;
  v_assignment_id uuid;
  v_meta jsonb;
  v_value text;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    begin
      v_email := lower(trim(coalesce(r->>'p_email', '')));
      v_client_name := coalesce(nullif(trim(r->>'p_client'), ''), 'Snorkel');
      v_vertical_name := nullif(trim(r->>'p_vertical'), '');
      v_project_name := nullif(trim(r->>'p_project'), '');
      v_source_key := nullif(trim(r->>'p_source_key'), '');
      v_source_sheet := nullif(trim(r->>'p_source_sheet'), '');
      v_sync_run_id := nullif(trim(r->>'p_sync_run_id'), '');
      v_priority := coalesce(nullif(trim(r->>'p_source_priority'), '')::integer, 0);
      v_source_row := nullif(trim(r->>'p_source_row'), '')::integer;

      if v_email = '' or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
        raise exception 'valid email is required';
      end if;
      if v_vertical_name is null or v_project_name is null then
        raise exception 'vertical and project are required';
      end if;
      if v_source_key is null then
        raise exception 'source_key is required';
      end if;
      if v_priority < 0 or v_priority > 1000 then
        raise exception 'source_priority must be between 0 and 1000';
      end if;

      select count(*)
      into v_project_count
      from public.subprojects sp
      join public.verticals v on v.id = sp.vertical_id
      join public.clients c on c.id = v.client_id
      where sp.active
        and lower(c.display_name) = lower(v_client_name)
        and lower(v.display_name) = lower(v_vertical_name)
        and (
          regexp_replace(lower(sp.display_name), '[^a-z0-9]+', '', 'g') =
            regexp_replace(lower(v_project_name), '[^a-z0-9]+', '', 'g')
          or regexp_replace(lower(sp.slug), '[^a-z0-9]+', '', 'g') =
            regexp_replace(lower(v_project_name), '[^a-z0-9]+', '', 'g')
        );

      if v_project_count = 0 then
        raise exception 'unknown active project %.%.%', v_client_name, v_vertical_name, v_project_name;
      end if;
      if v_project_count > 1 then
        raise exception 'ambiguous active project %.%.%', v_client_name, v_vertical_name, v_project_name;
      end if;

      select sp.id
      into v_subproject_id
      from public.subprojects sp
      join public.verticals v on v.id = sp.vertical_id
      join public.clients c on c.id = v.client_id
      where sp.active
        and lower(c.display_name) = lower(v_client_name)
        and lower(v.display_name) = lower(v_vertical_name)
        and (
          regexp_replace(lower(sp.display_name), '[^a-z0-9]+', '', 'g') =
            regexp_replace(lower(v_project_name), '[^a-z0-9]+', '', 'g')
          or regexp_replace(lower(sp.slug), '[^a-z0-9]+', '', 'g') =
            regexp_replace(lower(v_project_name), '[^a-z0-9]+', '', 'g')
        );

      insert into public.candidates (source_uid, email)
      values (gen_random_uuid(), v_email)
      on conflict (email) do nothing;

      select id, portal_sync_meta
      into v_candidate_id, v_meta
      from public.candidates
      where email = v_email;

      v_value := nullif(trim(r->>'p_full_name'), '');
      if v_value is not null
        and v_priority >= public.portal_field_priority(v_meta, 'full_name') then
        update public.candidates
        set full_name = v_value,
            portal_sync_meta = public.portal_mark_field_source(
              portal_sync_meta, 'full_name', v_priority, v_source_key,
              v_source_sheet, v_source_row
            ),
            updated_at = now()
        where id = v_candidate_id
        returning portal_sync_meta into v_meta;
      end if;

      v_value := nullif(trim(r->>'p_phone'), '');
      if v_value is not null
        and v_priority >= public.portal_field_priority(v_meta, 'phone') then
        update public.candidates
        set phone = v_value,
            portal_sync_meta = public.portal_mark_field_source(
              portal_sync_meta, 'phone', v_priority, v_source_key,
              v_source_sheet, v_source_row
            ),
            updated_at = now()
        where id = v_candidate_id
        returning portal_sync_meta into v_meta;
      end if;

      v_value := nullif(trim(r->>'p_bgv_id_status'), '');
      if v_value is not null then
        insert into public.background_verification (candidate_id, id_status)
        values (v_candidate_id, v_value)
        on conflict (candidate_id) do nothing;

        select portal_sync_meta
        into v_meta
        from public.background_verification
        where candidate_id = v_candidate_id;

        if v_priority >= public.portal_field_priority(v_meta, 'id_status') then
          update public.background_verification
          set id_status = v_value,
              portal_sync_meta = public.portal_mark_field_source(
                portal_sync_meta, 'id_status', v_priority, v_source_key,
                v_source_sheet, v_source_row
              ),
              updated_at = now()
          where candidate_id = v_candidate_id;
        end if;
      end if;

      insert into public.assignments (
        source_uid, candidate_id, subproject_id, is_offboarded_heuristic,
        source_sheet, source_row, last_seen_at
      )
      values (
        gen_random_uuid(), v_candidate_id, v_subproject_id, false,
        v_source_sheet, v_source_row, now()
      )
      on conflict (candidate_id, subproject_id) do update
      set last_seen_at = now(), updated_at = now()
      returning id, portal_sync_meta into v_assignment_id, v_meta;

      v_value := nullif(trim(r->>'p_domain'), '');
      if v_value is not null
        and v_priority >= public.portal_field_priority(v_meta, 'domain') then
        update public.assignments
        set domain = v_value,
            portal_sync_meta = public.portal_mark_field_source(
              portal_sync_meta, 'domain', v_priority, v_source_key,
              v_source_sheet, v_source_row
            )
        where id = v_assignment_id
        returning portal_sync_meta into v_meta;
      end if;

      v_value := nullif(trim(r->>'p_remofirst_status'), '');
      if v_value is not null
        and v_priority >= public.portal_field_priority(v_meta, 'remofirst_status') then
        update public.assignments
        set remofirst_status = v_value,
            portal_sync_meta = public.portal_mark_field_source(
              portal_sync_meta, 'remofirst_status', v_priority, v_source_key,
              v_source_sheet, v_source_row
            )
        where id = v_assignment_id
        returning portal_sync_meta into v_meta;
      end if;

      v_value := nullif(trim(r->>'p_contract_status'), '');
      if v_value is not null
        and v_priority >= public.portal_field_priority(v_meta, 'contract_status') then
        update public.assignments
        set contract_status = v_value,
            portal_sync_meta = public.portal_mark_field_source(
              portal_sync_meta, 'contract_status', v_priority, v_source_key,
              v_source_sheet, v_source_row
            )
        where id = v_assignment_id
        returning portal_sync_meta into v_meta;
      end if;

      if nullif(trim(r->>'p_rate_amount'), '') is not null
        and v_priority >= public.portal_field_priority(v_meta, 'rate') then
        update public.assignments
        set rate_amount = (r->>'p_rate_amount')::numeric,
            rate_currency = coalesce(nullif(trim(r->>'p_rate_currency'), ''), 'INR'),
            rate_unit = nullif(trim(r->>'p_rate_unit'), ''),
            portal_sync_meta = public.portal_mark_field_source(
              portal_sync_meta, 'rate', v_priority, v_source_key,
              v_source_sheet, v_source_row
            )
        where id = v_assignment_id
        returning portal_sync_meta into v_meta;
      end if;

      if v_priority >= public.portal_field_priority(v_meta, '_assignment') then
        update public.assignments
        set source_sheet = coalesce(v_source_sheet, source_sheet),
            source_row = coalesce(v_source_row, source_row),
            is_offboarded_heuristic = false,
            portal_sync_meta = public.portal_mark_field_source(
              portal_sync_meta, '_assignment', v_priority, v_source_key,
              v_source_sheet, v_source_row
            ),
            last_seen_at = now(),
            updated_at = now()
        where id = v_assignment_id;
      end if;

      if coalesce(nullif(trim(r->>'p_membership_authoritative'), '')::boolean, false) then
        if v_sync_run_id is null then
          raise exception 'sync_run_id is required for authoritative membership';
        end if;

        insert into public.portal_assignment_memberships (
          assignment_id, source_key, last_seen_run_id, last_seen_at,
          active, source_sheet, source_row
        )
        values (
          v_assignment_id, v_source_key, v_sync_run_id, now(),
          true, v_source_sheet, v_source_row
        )
        on conflict (assignment_id, source_key) do update
        set last_seen_run_id = excluded.last_seen_run_id,
            last_seen_at = excluded.last_seen_at,
            active = true,
            source_sheet = excluded.source_sheet,
            source_row = excluded.source_row;
      end if;

      out_email := v_email;
      out_status := 'ok';
      out_message := null;
      return next;
    exception when others then
      out_email := coalesce(v_email, lower(trim(coalesce(r->>'p_email', ''))));
      out_status := 'error';
      out_message := sqlerrm;
      return next;
    end;
  end loop;
end;
$$;

create or replace function public.finalize_portal_assignment_snapshot(
  p_source_key text,
  p_sync_run_id text,
  p_expected_count integer
)
returns table(out_status text, out_message text, out_deactivated integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seen_count integer;
  v_deactivated integer;
begin
  if nullif(trim(p_source_key), '') is null
    or nullif(trim(p_sync_run_id), '') is null then
    raise exception 'source_key and sync_run_id are required';
  end if;
  if p_expected_count is null or p_expected_count <= 0 then
    raise exception 'refusing to finalize an empty snapshot';
  end if;

  select count(*)
  into v_seen_count
  from public.portal_assignment_memberships membership
  where membership.source_key = p_source_key
    and membership.last_seen_run_id = p_sync_run_id
    and membership.active;

  if v_seen_count <> p_expected_count then
    raise exception 'snapshot count mismatch: expected %, stored %',
      p_expected_count, v_seen_count;
  end if;

  update public.portal_assignment_memberships membership
  set active = false
  where membership.source_key = p_source_key
    and membership.last_seen_run_id <> p_sync_run_id
    and membership.active;

  with affected as (
    select distinct membership.assignment_id
    from public.portal_assignment_memberships membership
    where membership.source_key = p_source_key
  ), changed as (
    update public.assignments assignment
    set is_offboarded_heuristic = not exists (
          select 1
          from public.portal_assignment_memberships membership
          where membership.assignment_id = assignment.id
            and membership.active
        ),
        updated_at = now()
    where assignment.id in (select assignment_id from affected)
    returning assignment.id
  )
  select count(*) into v_deactivated from changed;

  out_status := 'ok';
  out_message := null;
  out_deactivated := v_deactivated;
  return next;
exception when others then
  out_status := 'error';
  out_message := sqlerrm;
  out_deactivated := 0;
  return next;
end;
$$;

revoke all on function public.upsert_portal_assignments_batch(jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_portal_assignments_batch(jsonb)
  to service_role;

revoke all on function public.finalize_portal_assignment_snapshot(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.finalize_portal_assignment_snapshot(text, text, integer)
  to service_role;

-- Keep the existing STEM n8n payload compatible while routing it through the
-- provenance-aware writer. Project candidate sheets and their exact contract
-- rate columns are authoritative for the corresponding STEM assignment.
create or replace function public.upsert_stem_assignment_batch(p_rows jsonb)
returns table(out_email text, out_status text, out_message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  select coalesce(
    jsonb_agg(
      source.item || jsonb_build_object(
        'p_client', 'Snorkel',
        'p_vertical', 'STEM',
        'p_project', source.item->>'p_project_slug',
        'p_source_key', 'stem-project:' || lower(source.item->>'p_project_slug'),
        'p_source_priority', 100,
        'p_remofirst_status', case
          when lower(trim(source.item->>'p_remofirst_status')) in (
            'unmapped:not started',
            'not started'
          ) then 'not_received'
          else source.item->>'p_remofirst_status'
        end
      )
    ),
    '[]'::jsonb
  )
  into v_rows
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as source(item);

  return query
  select *
  from public.upsert_portal_assignments_batch(v_rows);
end;
$$;

revoke all on function public.upsert_stem_assignment_batch(jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_stem_assignment_batch(jsonb)
  to service_role;

create or replace view public.portal_data_quality_issues
with (security_invoker = true)
as
with assignment_rows as (
  select
    a.id as assignment_id,
    c.email,
    cl.display_name as client_name,
    v.display_name as vertical_name,
    sp.display_name as project_name,
    sp.active as project_active,
    a.domain,
    a.remofirst_status,
    a.contract_status,
    a.rate_amount,
    a.rate_currency,
    a.rate_unit,
    a.last_seen_at,
    a.source_sheet,
    a.is_offboarded_heuristic
  from public.assignments a
  join public.candidates c on c.id = a.candidate_id
  join public.subprojects sp on sp.id = a.subproject_id
  join public.verticals v on v.id = sp.vertical_id
  join public.clients cl on cl.id = v.client_id
)
select assignment_id, email, client_name, vertical_name, project_name,
       'error'::text as severity, 'INACTIVE_PROJECT'::text as issue_code,
       'Active assignment points to an inactive project'::text as details
from assignment_rows
where not is_offboarded_heuristic and not project_active
union all
select assignment_id, email, client_name, vertical_name, project_name,
       'error', 'PARTIAL_RATE',
       'Rate amount, currency, and unit must be populated together'
from assignment_rows
where not is_offboarded_heuristic
  and (
    (rate_amount is null and (rate_currency is not null or rate_unit is not null))
    or (rate_amount is not null and (rate_currency is null or rate_unit is null))
  )
union all
select assignment_id, email, client_name, vertical_name, project_name,
       'error', 'INVALID_RATE', 'Rate must be greater than zero'
from assignment_rows
where not is_offboarded_heuristic and rate_amount <= 0
union all
select assignment_id, email, client_name, vertical_name, project_name,
       'warning', 'MISSING_PRIMARY_RATE',
       'No project-specific primary rate has been synchronized'
from assignment_rows
where not is_offboarded_heuristic
  and vertical_name in ('STEM', 'Mojave')
  and rate_amount is null
union all
select assignment_id, email, client_name, vertical_name, project_name,
       'error', 'UNMAPPED_STATUS',
       concat_ws(', ',
         case when contract_status like 'unmapped:%' then 'contract=' || contract_status end,
         case when remofirst_status like 'unmapped:%' then 'remofirst=' || remofirst_status end
       )
from assignment_rows
where not is_offboarded_heuristic
  and (contract_status like 'unmapped:%' or remofirst_status like 'unmapped:%')
union all
select assignment_id, email, client_name, vertical_name, project_name,
       'warning', 'STALE_ASSIGNMENT',
       'Assignment has not been observed by a successful sync in more than 96 hours'
from assignment_rows
where not is_offboarded_heuristic
  and last_seen_at < now() - interval '96 hours'
  and coalesce(source_sheet, '') <> 'Candidate Portal Test Data';

revoke all on public.portal_data_quality_issues from public, anon, authenticated;
grant select on public.portal_data_quality_issues to service_role;
