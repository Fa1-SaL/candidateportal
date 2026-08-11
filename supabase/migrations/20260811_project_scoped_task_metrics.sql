-- Resolve task metrics against the candidate's exact active assignment.
-- Project slugs are not globally unique because older catalogs can retain
-- inactive projects under a different vertical.
create or replace function public.upsert_task_metrics_batch(p_rows jsonb)
returns table(out_email text, out_status text, out_message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_candidate_id uuid;
  v_assignment_id uuid;
  v_assignment_count integer;
  v_client_name text;
  v_vertical_name text;
  v_allow_missing boolean;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    begin
      select id into v_candidate_id
      from public.candidates
      where email = lower(trim(r->>'p_email'));

      v_allow_missing := coalesce(
        nullif(trim(r->>'p_allow_missing_assignment'), '')::boolean,
        false
      );

      if v_candidate_id is null and v_allow_missing then
        out_email := lower(trim(r->>'p_email'));
        out_status := 'skipped';
        out_message := 'candidate is not in the active portal roster';
        return next;
        continue;
      end if;

      if v_candidate_id is null then
        raise exception 'no candidate found for %', r->>'p_email';
      end if;

      v_client_name := coalesce(nullif(trim(r->>'p_client'), ''), 'Snorkel');
      v_vertical_name := nullif(trim(r->>'p_vertical'), '');

      select count(*)
      into v_assignment_count
      from public.assignments a
      join public.subprojects sp on sp.id = a.subproject_id
      join public.verticals v on v.id = sp.vertical_id
      join public.clients cl on cl.id = v.client_id
      where a.candidate_id = v_candidate_id
        and sp.active
        and lower(cl.display_name) = lower(v_client_name)
        and (
          regexp_replace(lower(sp.slug), '[^a-z0-9]+', '', 'g') =
            regexp_replace(lower(trim(r->>'p_project_slug')), '[^a-z0-9]+', '', 'g')
          or regexp_replace(lower(sp.display_name), '[^a-z0-9]+', '', 'g') =
            regexp_replace(lower(trim(r->>'p_project_slug')), '[^a-z0-9]+', '', 'g')
        )
        and (
          v_vertical_name is null
          or lower(v.display_name) = lower(v_vertical_name)
        );

      if v_assignment_count = 0 then
        if v_allow_missing then
          out_email := lower(trim(r->>'p_email'));
          out_status := 'skipped';
          out_message := 'candidate has no active assignment on ' ||
            coalesce(r->>'p_project_slug', 'the requested project');
          return next;
          continue;
        end if;

        raise exception 'no active assignment on % for %',
          r->>'p_project_slug', r->>'p_email';
      end if;

      if v_assignment_count > 1 then
        raise exception 'ambiguous assignment on % for %; include p_vertical',
          r->>'p_project_slug', r->>'p_email';
      end if;

      select a.id
      into v_assignment_id
      from public.assignments a
      join public.subprojects sp on sp.id = a.subproject_id
      join public.verticals v on v.id = sp.vertical_id
      join public.clients cl on cl.id = v.client_id
      where a.candidate_id = v_candidate_id
        and sp.active
        and lower(cl.display_name) = lower(v_client_name)
        and (
          regexp_replace(lower(sp.slug), '[^a-z0-9]+', '', 'g') =
            regexp_replace(lower(trim(r->>'p_project_slug')), '[^a-z0-9]+', '', 'g')
          or regexp_replace(lower(sp.display_name), '[^a-z0-9]+', '', 'g') =
            regexp_replace(lower(trim(r->>'p_project_slug')), '[^a-z0-9]+', '', 'g')
        )
        and (
          v_vertical_name is null
          or lower(v.display_name) = lower(v_vertical_name)
        )
      limit 1;

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
        evaluation_pending = coalesce(
          excluded.evaluation_pending,
          public.task_metrics.evaluation_pending
        ),
        source_sheet = excluded.source_sheet,
        metric_kind = excluded.metric_kind;

      out_email := lower(trim(r->>'p_email'));
      out_status := 'ok';
      out_message := null;
      return next;
    exception when others then
      out_email := lower(trim(coalesce(r->>'p_email', '')));
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
