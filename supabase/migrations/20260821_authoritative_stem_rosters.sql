-- Treat the four STEM candidate tabs as authoritative project rosters. Each
-- n8n execution writes all current rows in one batch, then finalizes every
-- project snapshot in the same transaction so removed candidates cannot stay
-- assigned indefinitely.

create or replace function public.upsert_stem_assignment_batch(p_rows jsonb)
returns table(out_email text, out_status text, out_message text)
language plpgsql
security definer
set search_path = public
set statement_timeout = '180s'
as $$
declare
  v_rows jsonb;
  v_result record;
  v_snapshot record;
  v_finalize_status text;
  v_finalize_message text;
  v_has_error boolean := false;
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

  for v_result in
    select *
    from public.upsert_portal_assignments_batch(v_rows)
  loop
    out_email := v_result.out_email;
    out_status := v_result.out_status;
    out_message := v_result.out_message;
    v_has_error := v_has_error or v_result.out_status is distinct from 'ok';
    return next;
  end loop;

  if v_has_error then
    raise exception 'STEM roster upsert failed; snapshot finalization cancelled';
  end if;

  for v_snapshot in
    select
      row_data->>'p_source_key' as source_key,
      row_data->>'p_sync_run_id' as sync_run_id,
      count(distinct lower(trim(row_data->>'p_email')))::integer as expected_count
    from jsonb_array_elements(v_rows) as source(row_data)
    where coalesce(
        nullif(trim(source.row_data->>'p_membership_authoritative'), '')::boolean,
        false
      )
      and nullif(trim(source.row_data->>'p_sync_run_id'), '') is not null
      and source.row_data->>'p_source_key' in (
        'stem-project:riga',
        'stem-project:rainier',
        'stem-project:sequoia',
        'stem-project:starfish'
      )
    group by row_data->>'p_source_key', row_data->>'p_sync_run_id'
  loop
    -- Assignments created before the membership ledger existed have no row
    -- for the finalizer to deactivate. Bootstrap them once with an older run
    -- marker; current rows already have a membership and win the conflict.
    insert into public.portal_assignment_memberships (
      assignment_id,
      source_key,
      last_seen_run_id,
      last_seen_at,
      active,
      source_sheet,
      source_row
    )
    select
      assignment.id,
      v_snapshot.source_key,
      'legacy-before:' || v_snapshot.sync_run_id,
      now(),
      true,
      assignment.source_sheet,
      assignment.source_row
    from public.assignments assignment
    join public.subprojects project on project.id = assignment.subproject_id
    join public.verticals vertical on vertical.id = project.vertical_id
    join public.clients client on client.id = vertical.client_id
    where lower(client.display_name) = 'snorkel'
      and lower(vertical.display_name) = 'stem'
      and 'stem-project:' || lower(project.slug) = v_snapshot.source_key
    on conflict (assignment_id, source_key) do nothing;

    select result.out_status, result.out_message
    into v_finalize_status, v_finalize_message
    from public.finalize_portal_assignment_snapshot(
      v_snapshot.source_key,
      v_snapshot.sync_run_id,
      v_snapshot.expected_count
    ) result;

    if v_finalize_status is distinct from 'ok' then
      raise exception 'could not finalize %: %',
        v_snapshot.source_key,
        coalesce(v_finalize_message, 'unknown error');
    end if;
  end loop;
end;
$$;

revoke all on function public.upsert_stem_assignment_batch(jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_stem_assignment_batch(jsonb)
  to service_role;

-- If an authoritative n8n run already populated the ledger before this
-- migration was applied, finalize that latest complete snapshot immediately.
-- Fresh environments simply skip sources that do not have a run yet.
do $$
declare
  v_source_key text;
  v_sync_run_id text;
  v_expected_count integer;
  v_finalize_status text;
  v_finalize_message text;
begin
  foreach v_source_key in array array[
    'stem-project:riga',
    'stem-project:rainier',
    'stem-project:sequoia',
    'stem-project:starfish'
  ] loop
    select membership.last_seen_run_id
    into v_sync_run_id
    from public.portal_assignment_memberships membership
    where membership.source_key = v_source_key
      and membership.active
    order by membership.last_seen_at desc
    limit 1;

    if v_sync_run_id is null then
      continue;
    end if;

    insert into public.portal_assignment_memberships (
      assignment_id,
      source_key,
      last_seen_run_id,
      last_seen_at,
      active,
      source_sheet,
      source_row
    )
    select
      assignment.id,
      v_source_key,
      'legacy-before:' || v_sync_run_id,
      now(),
      true,
      assignment.source_sheet,
      assignment.source_row
    from public.assignments assignment
    join public.subprojects project on project.id = assignment.subproject_id
    join public.verticals vertical on vertical.id = project.vertical_id
    join public.clients client on client.id = vertical.client_id
    where lower(client.display_name) = 'snorkel'
      and lower(vertical.display_name) = 'stem'
      and 'stem-project:' || lower(project.slug) = v_source_key
    on conflict (assignment_id, source_key) do nothing;

    select count(*)
    into v_expected_count
    from public.portal_assignment_memberships membership
    where membership.source_key = v_source_key
      and membership.last_seen_run_id = v_sync_run_id
      and membership.active;

    select result.out_status, result.out_message
    into v_finalize_status, v_finalize_message
    from public.finalize_portal_assignment_snapshot(
      v_source_key,
      v_sync_run_id,
      v_expected_count
    ) result;

    if v_finalize_status is distinct from 'ok' then
      raise exception 'could not finalize existing % snapshot: %',
        v_source_key,
        coalesce(v_finalize_message, 'unknown error');
    end if;
  end loop;
end;
$$;
