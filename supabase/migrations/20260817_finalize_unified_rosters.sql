-- The master and PaperBench assignment feeds are authoritative snapshots.
-- Finalize their latest successful run before refreshing task metrics so a
-- candidate removed from a source cannot retain a stale portal project.
create or replace function public.finalize_unified_rosters_and_refresh(
  p_assignment_ids uuid[] default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_key text;
  v_sync_run_id text;
  v_expected_count integer;
  v_status text;
  v_message text;
begin
  foreach v_source_key in array array[
    'snorkel-master-user',
    'paperbench-live-candidates'
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

    select count(*)
    into v_expected_count
    from public.portal_assignment_memberships membership
    where membership.source_key = v_source_key
      and membership.last_seen_run_id = v_sync_run_id
      and membership.active;

    select result.out_status, result.out_message
    into v_status, v_message
    from public.finalize_portal_assignment_snapshot(
      v_source_key,
      v_sync_run_id,
      v_expected_count
    ) result;

    if v_status is distinct from 'ok' then
      raise exception 'could not finalize %: %',
        v_source_key,
        coalesce(v_message, 'unknown error');
    end if;
  end loop;

  return public.refresh_task_metrics_from_events(p_assignment_ids);
end;
$$;

revoke all on function public.finalize_unified_rosters_and_refresh(uuid[])
  from public, anon, authenticated;
grant execute on function public.finalize_unified_rosters_and_refresh(uuid[])
  to service_role;
