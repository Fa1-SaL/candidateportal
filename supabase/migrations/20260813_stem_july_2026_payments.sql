-- Synchronize the July 2026 Final Amt values from the four authoritative
-- Snorkel STEM payment workbooks without creating candidate assignments.
alter table public.payments
  add column if not exists source_key text,
  add column if not exists source_sheet text,
  add column if not exists sync_run_id text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists payments_assignment_source_reference_uidx
  on public.payments (assignment_id, source_key, reference)
  where source_key is not null;

create index if not exists payments_source_sync_idx
  on public.payments (source_key, sync_run_id);

create or replace function public.sync_stem_july_2026_payments(p_rows jsonb)
returns table(
  out_email text,
  out_project text,
  out_status text,
  out_message text,
  out_reference text,
  out_amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_candidate_id uuid;
  v_assignment_id uuid;
  v_assignment_count integer;
  v_sync_run_id text;
  v_source_key constant text := 'stem-payments-july-2026';
  v_projects text[];
  v_input_count integer;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  v_input_count := jsonb_array_length(p_rows);
  if v_input_count = 0 then
    raise exception 'refusing to replace the STEM July 2026 snapshot with no rows';
  end if;

  select array_agg(project_name order by project_name)
  into v_projects
  from (
    select distinct lower(trim(value->>'p_project')) as project_name
    from jsonb_array_elements(p_rows)
  ) projects;

  if v_projects is distinct from array['rainier', 'riga', 'sequoia', 'starfish']::text[] then
    raise exception 'expected Riga, Rainier, Sequoia, and Starfish; received %', v_projects;
  end if;

  select min(nullif(trim(value->>'p_sync_run_id'), ''))
  into v_sync_run_id
  from jsonb_array_elements(p_rows);

  if v_sync_run_id is null or exists (
    select 1
    from jsonb_array_elements(p_rows)
    where nullif(trim(value->>'p_sync_run_id'), '') is distinct from v_sync_run_id
  ) then
    raise exception 'every payment row must contain the same non-empty sync run id';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows)
    where lower(trim(value->>'p_source_key')) <> v_source_key
       or lower(trim(value->>'p_client')) <> 'snorkel'
       or lower(trim(value->>'p_vertical')) <> 'stem'
       or lower(trim(value->>'p_currency')) <> 'inr'
       or lower(trim(value->>'p_status')) not in ('disbursed', 'processing', 'failed')
       or nullif(trim(value->>'p_email'), '') is null
       or nullif(trim(value->>'p_reference'), '') is null
       or coalesce(nullif(trim(value->>'p_amount'), '')::numeric, 0) <= 0
  ) then
    raise exception 'one or more STEM payment rows failed snapshot validation';
  end if;

  if (
    select count(*)
    from jsonb_array_elements(p_rows)
  ) <> (
    select count(distinct concat_ws(
      '|',
      lower(trim(value->>'p_email')),
      lower(trim(value->>'p_project')),
      lower(trim(value->>'p_status'))
    ))
    from jsonb_array_elements(p_rows)
  ) then
    raise exception 'duplicate email/project/status rows must be aggregated before sync';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    out_email := lower(trim(r->>'p_email'));
    out_project := trim(r->>'p_project');
    out_reference := trim(r->>'p_reference');
    out_amount := (r->>'p_amount')::numeric;

    select candidate.id
    into v_candidate_id
    from public.candidates candidate
    where candidate.email = out_email;

    if v_candidate_id is null then
      out_status := 'skipped';
      out_message := 'candidate is not in the portal roster';
      return next;
      continue;
    end if;

    select count(*)
    into v_assignment_count
    from public.assignments assignment
    join public.subprojects project on project.id = assignment.subproject_id
    join public.verticals vertical on vertical.id = project.vertical_id
    join public.clients client on client.id = vertical.client_id
    where assignment.candidate_id = v_candidate_id
      and project.active
      and lower(client.display_name) = 'snorkel'
      and lower(vertical.display_name) = 'stem'
      and lower(project.display_name) = lower(out_project);

    if v_assignment_count = 0 then
      out_status := 'skipped';
      out_message := 'candidate has no matching active Snorkel/STEM assignment';
      return next;
      continue;
    end if;

    if v_assignment_count > 1 then
      raise exception 'ambiguous Snorkel/STEM/% assignment for %', out_project, out_email;
    end if;

    select assignment.id
    into v_assignment_id
    from public.assignments assignment
    join public.subprojects project on project.id = assignment.subproject_id
    join public.verticals vertical on vertical.id = project.vertical_id
    join public.clients client on client.id = vertical.client_id
    where assignment.candidate_id = v_candidate_id
      and project.active
      and lower(client.display_name) = 'snorkel'
      and lower(vertical.display_name) = 'stem'
      and lower(project.display_name) = lower(out_project);

    insert into public.payments (
      assignment_id,
      period_start,
      period_end,
      amount,
      currency,
      status,
      paid_on,
      reference,
      source_key,
      source_sheet,
      sync_run_id,
      created_at,
      updated_at
    ) values (
      v_assignment_id,
      date '2026-07-01',
      date '2026-07-31',
      out_amount,
      'INR',
      lower(trim(r->>'p_status')),
      nullif(trim(r->>'p_paid_on'), '')::date,
      out_reference,
      v_source_key,
      nullif(trim(r->>'p_source_sheet'), ''),
      v_sync_run_id,
      now(),
      now()
    )
    on conflict (assignment_id, source_key, reference)
      where source_key is not null
    do update set
      period_start = excluded.period_start,
      period_end = excluded.period_end,
      amount = excluded.amount,
      currency = excluded.currency,
      status = excluded.status,
      paid_on = excluded.paid_on,
      source_sheet = excluded.source_sheet,
      sync_run_id = excluded.sync_run_id,
      updated_at = now();

    out_status := 'ok';
    out_message := null;
    return next;
  end loop;

  delete from public.payments payment
  where payment.source_key = v_source_key
    and payment.sync_run_id is distinct from v_sync_run_id;
end;
$$;

revoke all on function public.sync_stem_july_2026_payments(jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_stem_july_2026_payments(jsonb)
  to service_role;
