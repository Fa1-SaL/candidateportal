begin;

-- Candidate-facing sessions are read-only. Keep database writes behind the
-- service role even if a future RLS policy is accidentally too permissive.
revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public
  from anon, authenticated;

revoke usage, select, update
  on all sequences in schema public
  from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger
  on tables from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke usage, select, update
  on sequences from anon, authenticated;

-- PostgreSQL grants function execution to PUBLIC by default. All portal sync
-- RPCs are internal and n8n already authenticates with the service role.
revoke execute on all functions in schema public
  from public, anon, authenticated;

grant execute on all functions in schema public
  to service_role;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

alter default privileges for role postgres in schema public
  grant execute on functions to service_role;

-- Lock down legacy SECURITY DEFINER functions that predate the batched sync
-- APIs. Their bodies use unqualified object names, so pin a trusted path.
do $$
declare
  function_identity regprocedure;
begin
  for function_identity in
    select procedure.oid::regprocedure
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'flag_assignment_for_review',
        'flag_assignment_for_review_batch',
        'handle_new_auth_user',
        'portal_field_priority',
        'portal_mark_field_source',
        'reset_flagged_tasks',
        'set_ip_addendum_status',
        'set_ip_addendum_status_batch',
        'upsert_stem_assignment',
        'upsert_task_metrics_daily'
      )
  loop
    execute format(
      'alter function %s set search_path = public, pg_temp',
      function_identity
    );
  end loop;
end;
$$;

-- This view previously ran with the owner's privileges and bypassed RLS.
do $$
begin
  if to_regclass('public.candidate_task_totals') is not null then
    alter view public.candidate_task_totals set (security_invoker = true);
    revoke all on table public.candidate_task_totals from anon, authenticated;
    grant select on table public.candidate_task_totals to authenticated, service_role;
  end if;
end;
$$;

create unique index if not exists candidates_auth_user_id_unique
  on public.candidates (auth_user_id)
  where auth_user_id is not null;

-- Fail the migration if the intended least-privilege posture was not reached.
do $$
begin
  if exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relkind in ('r', 'p')
      and (
        has_table_privilege('anon', relation.oid, 'INSERT')
        or has_table_privilege('anon', relation.oid, 'UPDATE')
        or has_table_privilege('anon', relation.oid, 'DELETE')
        or has_table_privilege('authenticated', relation.oid, 'INSERT')
        or has_table_privilege('authenticated', relation.oid, 'UPDATE')
        or has_table_privilege('authenticated', relation.oid, 'DELETE')
      )
  ) then
    raise exception 'candidate-facing roles still have public table write privileges';
  end if;

  if exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.prosecdef
      and (
        has_function_privilege('anon', procedure.oid, 'EXECUTE')
        or has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      )
  ) then
    raise exception 'candidate-facing roles can still execute SECURITY DEFINER functions';
  end if;

  if to_regclass('public.candidate_task_totals') is not null
    and has_table_privilege('anon', 'public.candidate_task_totals', 'SELECT')
  then
    raise exception 'anonymous users can still read candidate_task_totals';
  end if;
end;
$$;

commit;
