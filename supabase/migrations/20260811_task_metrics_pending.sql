-- Some source trackers expose the review queue directly. Preserve that source
-- value instead of deriving it from counts that can overlap (for example,
-- rework and review queues).
alter table public.task_metrics
  add column if not exists evaluation_pending integer;

create or replace function public.upsert_task_metrics_batch(p_rows jsonb)
returns table(out_email text, out_status text, out_message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_candidate_id uuid;
  v_subproject_id uuid;
  v_assignment_id uuid;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    begin
      select id into v_candidate_id
      from public.candidates
      where email = lower(trim(r->>'p_email'));

      if v_candidate_id is null then
        raise exception 'no candidate found for %', r->>'p_email';
      end if;

      select id into v_subproject_id
      from public.subprojects
      where slug = r->>'p_project_slug'
      limit 1;

      if v_subproject_id is null then
        raise exception 'unknown project_slug "%"', r->>'p_project_slug';
      end if;

      select id into v_assignment_id
      from public.assignments
      where candidate_id = v_candidate_id
        and subproject_id = v_subproject_id;

      if v_assignment_id is null then
        raise exception 'no assignment on %', r->>'p_project_slug';
      end if;

      insert into public.task_metrics (
        assignment_id,
        as_of,
        submitted,
        accepted,
        rejected,
        rework,
        evaluation_pending,
        source_sheet,
        metric_kind
      )
      values (
        v_assignment_id,
        (r->>'p_as_of')::date,
        nullif(trim(r->>'p_submitted'), '')::integer,
        nullif(trim(r->>'p_accepted'), '')::integer,
        nullif(trim(r->>'p_rejected'), '')::integer,
        nullif(trim(r->>'p_rework'), '')::integer,
        nullif(trim(r->>'p_evaluation_pending'), '')::integer,
        nullif(trim(r->>'p_source_sheet'), ''),
        coalesce(nullif(trim(r->>'p_metric_kind'), ''), 'daily')
      )
      on conflict (assignment_id, as_of) do update
      set
        submitted = excluded.submitted,
        accepted = excluded.accepted,
        rejected = excluded.rejected,
        rework = excluded.rework,
        evaluation_pending = coalesce(excluded.evaluation_pending, public.task_metrics.evaluation_pending),
        source_sheet = excluded.source_sheet,
        metric_kind = excluded.metric_kind;

      out_email := r->>'p_email';
      out_status := 'ok';
      out_message := null;
      return next;
    exception when others then
      out_email := r->>'p_email';
      out_status := 'error';
      out_message := sqlerrm;
      return next;
    end;
  end loop;
end;
$$;

revoke all on function public.upsert_task_metrics_batch(jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_task_metrics_batch(jsonb)
  to service_role;
