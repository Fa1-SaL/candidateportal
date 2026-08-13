-- A task ID is not globally unique in Sentinel: the same task can be offered
-- to multiple candidates, and a candidate can have more than one submission.
-- Keep a source-row identity for upserts while preserving the user-facing ID.
alter table public.task_events
  add column if not exists source_event_key text,
  add column if not exists submission_external_id text;

update public.task_events
set source_event_key = 'legacy:' || id::text
where source_event_key is null;

alter table public.task_events
  alter column source_event_key set not null;

alter table public.task_events
  drop constraint if exists task_events_task_external_id_key;

create unique index if not exists task_events_source_event_key_key
  on public.task_events (source_event_key);

create index if not exists task_events_assignment_status_idx
  on public.task_events (assignment_id, status);

alter table public.task_events enable row level security;
grant select on public.task_events to authenticated;

drop policy if exists task_events_self_read on public.task_events;
create policy task_events_self_read
  on public.task_events
  for select
  to authenticated
  using (
    assignment_id in (
      select assignment.id
      from public.assignments assignment
      join public.candidates candidate
        on candidate.id = assignment.candidate_id
      where candidate.auth_user_id = auth.uid()
    )
  );

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
  v_task_external_id text;
  v_submission_external_id text;
  v_source_sheet text;
  v_source_event_key text;
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
      v_task_external_id := nullif(trim(r->>'p_task_external_id'), '');
      v_submission_external_id := nullif(
        trim(r->>'p_submission_external_id'),
        ''
      );
      v_source_sheet := nullif(trim(r->>'p_source_sheet'), '');

      if v_task_external_id is null then
        raise exception 'task_external_id is required';
      end if;

      select candidate.id
      into v_candidate_id
      from public.candidates candidate
      where candidate.email = lower(trim(r->>'p_email'));

      if v_candidate_id is null then
        if v_allow_missing_assignment then
          out_task_external_id := v_task_external_id;
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
          out_task_external_id := v_task_external_id;
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

      v_source_event_key := coalesce(
        nullif(trim(r->>'p_event_key'), ''),
        concat_ws(
          '|',
          'task-event',
          lower(coalesce(v_source_sheet, 'unknown-source')),
          v_candidate_id::text,
          lower(v_task_external_id),
          lower(coalesce(v_submission_external_id, ''))
        )
      );

      select event.assignment_id
      into v_old_assignment_id
      from public.task_events event
      where event.source_event_key = v_source_event_key;

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
        source_event_key,
        task_external_id,
        submission_external_id,
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
        v_source_event_key,
        v_task_external_id,
        v_submission_external_id,
        v_assignment_id,
        nullif(trim(r->>'p_project_name_raw'), ''),
        nullif(trim(r->>'p_task_type'), ''),
        v_status,
        nullif(trim(r->>'p_created_at_source'), '')::timestamptz,
        nullif(trim(r->>'p_submitted_at_source'), '')::timestamptz,
        nullif(trim(r->>'p_bpo_source'), ''),
        nullif(trim(r->>'p_final_outcome'), ''),
        v_source_sheet
      )
      on conflict (source_event_key) do update
      set task_external_id = excluded.task_external_id,
          submission_external_id = excluded.submission_external_id,
          assignment_id = excluded.assignment_id,
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

      out_task_external_id := v_task_external_id;
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

revoke all on function public.upsert_task_events_batch(jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_task_events_batch(jsonb)
  to service_role;
