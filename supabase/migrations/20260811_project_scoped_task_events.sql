-- Store raw task rows on the candidate's exact project assignment and refresh
-- the cumulative metrics consumed by the portal after every successful batch.
create or replace function public.refresh_task_metrics_from_events(
  p_assignment_ids uuid[] default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refreshed integer;
begin
  with aggregates as (
    select
      event.assignment_id,
      count(*)::integer as submitted,
      count(*) filter (
        where lower(trim(event.status)) in (
          'accepted',
          'approved',
          'provisionally accepted'
        )
      )::integer as accepted,
      count(*) filter (
        where lower(trim(event.status)) in ('rejected', 'invalid')
      )::integer as rejected,
      count(*) filter (
        where lower(trim(event.status)) in (
          'needs revision',
          'needs_revision',
          'rework',
          'requiring rework'
        )
      )::integer as rework,
      count(*) filter (
        where lower(trim(event.status)) not in (
          'accepted',
          'approved',
          'provisionally accepted',
          'rejected',
          'invalid',
          'needs revision',
          'needs_revision',
          'rework',
          'requiring rework'
        )
      )::integer as evaluation_pending,
      string_agg(distinct event.source_sheet, ' | ') as source_sheet
    from public.task_events event
    where p_assignment_ids is null
       or event.assignment_id = any(p_assignment_ids)
    group by event.assignment_id
  ), upserted as (
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
    select
      aggregate.assignment_id,
      current_date,
      aggregate.submitted,
      aggregate.accepted,
      aggregate.rejected,
      aggregate.rework,
      aggregate.evaluation_pending,
      aggregate.source_sheet,
      'cumulative'
    from aggregates aggregate
    on conflict (assignment_id, as_of) do update
    set submitted = excluded.submitted,
        accepted = excluded.accepted,
        rejected = excluded.rejected,
        rework = excluded.rework,
        evaluation_pending = excluded.evaluation_pending,
        source_sheet = excluded.source_sheet,
        metric_kind = excluded.metric_kind
    returning assignment_id
  )
  select count(*) into v_refreshed from upserted;

  return v_refreshed;
end;
$$;

create or replace function public.upsert_task_events_batch(p_rows jsonb)
returns table(out_task_external_id text, out_status text, out_message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_candidate_id uuid;
  v_assignment_id uuid;
  v_old_assignment_id uuid;
  v_assignment_count integer;
  v_client_name text;
  v_vertical_name text;
  v_project_name text;
  v_status text;
  v_allow_missing_assignment boolean;
  v_affected_assignment_ids uuid[] := array[]::uuid[];
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    begin
      v_allow_missing_assignment := coalesce(
        nullif(trim(r->>'p_allow_missing_assignment'), '')::boolean,
        false
      );

      select candidate.id
      into v_candidate_id
      from public.candidates candidate
      where candidate.email = lower(trim(r->>'p_email'));

      if v_candidate_id is null then
        if v_allow_missing_assignment then
          out_task_external_id := trim(r->>'p_task_external_id');
          out_status := 'skipped';
          out_message := format('no candidate found for %s', r->>'p_email');
          return next;
          continue;
        end if;
        raise exception 'no candidate found for %', r->>'p_email';
      end if;

      v_client_name := coalesce(nullif(trim(r->>'p_client'), ''), 'Snorkel');
      v_vertical_name := nullif(trim(r->>'p_vertical'), '');
      v_project_name := nullif(trim(r->>'p_project_slug'), '');

      if v_project_name is null then
        raise exception 'project_slug is required';
      end if;

      select count(*)
      into v_assignment_count
      from public.assignments assignment
      join public.subprojects project on project.id = assignment.subproject_id
      join public.verticals vertical on vertical.id = project.vertical_id
      join public.clients client on client.id = vertical.client_id
      where assignment.candidate_id = v_candidate_id
        and project.active
        and lower(client.display_name) = lower(v_client_name)
        and (
          regexp_replace(lower(project.slug), '[^a-z0-9]+', '', 'g') =
            regexp_replace(lower(v_project_name), '[^a-z0-9]+', '', 'g')
          or regexp_replace(lower(project.display_name), '[^a-z0-9]+', '', 'g') =
            regexp_replace(lower(v_project_name), '[^a-z0-9]+', '', 'g')
        )
        and (
          v_vertical_name is null
          or lower(vertical.display_name) = lower(v_vertical_name)
        );

      if v_assignment_count = 0 then
        if v_allow_missing_assignment then
          out_task_external_id := trim(r->>'p_task_external_id');
          out_status := 'skipped';
          out_message := format(
            'no active assignment on %s for %s',
            v_project_name,
            r->>'p_email'
          );
          return next;
          continue;
        end if;
        raise exception 'no active assignment on % for %',
          v_project_name, r->>'p_email';
      end if;
      if v_assignment_count > 1 then
        raise exception 'ambiguous assignment on % for %; include p_vertical',
          v_project_name, r->>'p_email';
      end if;

      select assignment.id
      into v_assignment_id
      from public.assignments assignment
      join public.subprojects project on project.id = assignment.subproject_id
      join public.verticals vertical on vertical.id = project.vertical_id
      join public.clients client on client.id = vertical.client_id
      where assignment.candidate_id = v_candidate_id
        and project.active
        and lower(client.display_name) = lower(v_client_name)
        and (
          regexp_replace(lower(project.slug), '[^a-z0-9]+', '', 'g') =
            regexp_replace(lower(v_project_name), '[^a-z0-9]+', '', 'g')
          or regexp_replace(lower(project.display_name), '[^a-z0-9]+', '', 'g') =
            regexp_replace(lower(v_project_name), '[^a-z0-9]+', '', 'g')
        )
        and (
          v_vertical_name is null
          or lower(vertical.display_name) = lower(v_vertical_name)
        );

      select event.assignment_id
      into v_old_assignment_id
      from public.task_events event
      where event.task_external_id = trim(r->>'p_task_external_id');

      v_status := lower(trim(coalesce(r->>'p_status', '')));
      v_status := case
        when v_status in ('accepted', 'approved', 'provisionally accepted')
          then 'accepted'
        when v_status in ('rejected', 'invalid')
          then 'rejected'
        when v_status in (
          'needs revision', 'needs_revision', 'rework', 'requiring rework'
        ) then 'rework'
        else 'evaluation_pending'
      end;

      insert into public.task_events (
        task_external_id,
        assignment_id,
        project_name_raw,
        task_type,
        status,
        created_at_source,
        submitted_at_source,
        bpo_source,
        final_outcome,
        source_sheet
      )
      values (
        trim(r->>'p_task_external_id'),
        v_assignment_id,
        nullif(trim(r->>'p_project_name_raw'), ''),
        nullif(trim(r->>'p_task_type'), ''),
        v_status,
        nullif(trim(r->>'p_created_at_source'), '')::timestamptz,
        nullif(trim(r->>'p_submitted_at_source'), '')::timestamptz,
        nullif(trim(r->>'p_bpo_source'), ''),
        nullif(trim(r->>'p_final_outcome'), ''),
        nullif(trim(r->>'p_source_sheet'), '')
      )
      on conflict (task_external_id) do update
      set assignment_id = excluded.assignment_id,
          project_name_raw = excluded.project_name_raw,
          task_type = excluded.task_type,
          status = excluded.status,
          created_at_source = excluded.created_at_source,
          submitted_at_source = excluded.submitted_at_source,
          bpo_source = excluded.bpo_source,
          final_outcome = excluded.final_outcome,
          source_sheet = excluded.source_sheet,
          updated_at = now();

      v_affected_assignment_ids := array_append(
        v_affected_assignment_ids,
        v_assignment_id
      );
      if v_old_assignment_id is not null
        and v_old_assignment_id <> v_assignment_id then
        v_affected_assignment_ids := array_append(
          v_affected_assignment_ids,
          v_old_assignment_id
        );
      end if;

      out_task_external_id := trim(r->>'p_task_external_id');
      out_status := 'ok';
      out_message := null;
      return next;
    exception when others then
      out_task_external_id := trim(coalesce(r->>'p_task_external_id', ''));
      out_status := 'error';
      out_message := sqlerrm;
      return next;
    end;
  end loop;

  if cardinality(v_affected_assignment_ids) > 0 then
    perform public.refresh_task_metrics_from_events(
      array(select distinct unnest(v_affected_assignment_ids))
    );
  end if;
end;
$$;

revoke all on function public.refresh_task_metrics_from_events(uuid[])
  from public, anon, authenticated;
grant execute on function public.refresh_task_metrics_from_events(uuid[])
  to service_role;

revoke all on function public.upsert_task_events_batch(jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_task_events_batch(jsonb)
  to service_role;
