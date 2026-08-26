-- Treat task sheets as authoritative snapshots. Batches are staged first, then
-- applied and reconciled in one transaction so a partial workflow run cannot
-- expose a mixed task state in the candidate portal.

alter table public.task_events
  add column if not exists source_key text,
  add column if not exists last_seen_run_id text,
  add column if not exists last_seen_at timestamptz,
  add column if not exists active boolean not null default true;

create index if not exists task_events_source_snapshot_idx
  on public.task_events (source_key, active, last_seen_run_id);

-- Task history is not an authoritative project roster. Retire the legacy
-- Terminus task-evidence membership while preserving any live-roster
-- membership for the same assignment.
update public.portal_assignment_memberships membership
set active = false
where membership.source_key = 'coding-project-task-evidence:terminus'
  and membership.active;

with affected as (
  select distinct membership.assignment_id
  from public.portal_assignment_memberships membership
  where membership.source_key = 'coding-project-task-evidence:terminus'
)
update public.assignments assignment
set is_offboarded_heuristic = not exists (
      select 1
      from public.portal_assignment_memberships membership
      where membership.assignment_id = assignment.id
        and membership.active
    ),
    updated_at = now()
where assignment.id in (select assignment_id from affected);

-- Assignments that predate the membership ledger must participate in the
-- first authoritative roster reconciliation. The next successful snapshot
-- keeps current rows and retires any legacy row absent from its owning roster.
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
  case lower(project.display_name)
    when 'paperbench' then 'paperbench-live-candidates'
    when 'sentinel ultra' then 'snorkel-master-user'
    when 'mojave' then 'snorkel-master-user'
    when 'terminus' then 'coding-project-roster:terminus'
    when 'otter' then 'coding-project-roster:otter'
    when 'suitelife' then 'coding-project-roster:suitelife'
    when 'rudder' then 'coding-project-roster:rudder'
    when 'geranium' then 'geranium-allocated-ecs'
  end,
  'legacy-before:authoritative-rosters-20260826',
  now(),
  true,
  assignment.source_sheet,
  assignment.source_row
from public.assignments assignment
join public.subprojects project
  on project.id = assignment.subproject_id
join public.verticals vertical
  on vertical.id = project.vertical_id
join public.clients client
  on client.id = vertical.client_id
where lower(client.display_name) = 'snorkel'
  and lower(project.display_name) in (
    'paperbench',
    'sentinel ultra',
    'mojave',
    'terminus',
    'otter',
    'suitelife',
    'rudder',
    'geranium'
  )
on conflict (assignment_id, source_key) do nothing;

-- Give existing event rows a source identity so the first successful snapshot
-- can retire rows that disappeared from the corresponding source sheet.
update public.task_events event
set source_key = case
      when lower(coalesce(event.source_sheet, '')) like '%paperbench%'
        then 'task-source:paperbench'
      when lower(coalesce(event.source_sheet, '')) like '%sentinel%'
        or lower(coalesce(event.source_sheet, '')) like '%sentinal%'
        then 'task-source:sentinel-ultra'
      when lower(coalesce(event.source_sheet, '')) like '%otter%'
        then 'task-source:otter'
      when lower(coalesce(event.source_sheet, '')) like '%rudder%'
        then 'task-source:rudder'
      when lower(coalesce(event.source_sheet, '')) like '%geranium%'
        then 'task-source:geranium'
      else event.source_key
    end
where event.source_key is null;

update public.task_events event
set source_key = case lower(project.display_name)
      when 'riga' then 'task-source:riga'
      when 'rainier' then 'task-source:rainier'
      when 'starfish' then 'task-source:starfish'
      else event.source_key
    end
from public.assignments assignment
join public.subprojects project
  on project.id = assignment.subproject_id
where event.assignment_id = assignment.id
  and event.source_key is null
  and lower(project.display_name) in ('riga', 'rainier', 'starfish');

create table if not exists public.task_event_sync_stage (
  source_key text not null,
  sync_run_id text not null,
  row_key text not null,
  payload jsonb not null,
  staged_at timestamptz not null default now(),
  primary key (source_key, sync_run_id, row_key)
);

alter table public.task_event_sync_stage enable row level security;
revoke all on table public.task_event_sync_stage
  from public, anon, authenticated;

create or replace function public.stage_task_event_snapshot_batch(
  p_source_key text,
  p_sync_run_id text,
  p_rows jsonb
)
returns table(
  out_task_external_id text,
  out_status text,
  out_message text
)
language plpgsql
security definer
set search_path = public
set statement_timeout = '180s'
as $$
declare
  r jsonb;
  v_email text;
  v_task_external_id text;
  v_row_key text;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('candidate-portal:assignment-sync', 0)
  );

  p_source_key := nullif(trim(p_source_key), '');
  p_sync_run_id := nullif(trim(p_sync_run_id), '');

  if p_source_key is null then
    raise exception 'source_key is required';
  end if;
  if p_sync_run_id is null then
    raise exception 'sync_run_id is required';
  end if;
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then
    raise exception 'rows must be a JSON array';
  end if;

  for r in
    select value
    from jsonb_array_elements(p_rows)
  loop
    v_email := lower(nullif(trim(r->>'p_email'), ''));
    v_task_external_id := nullif(trim(r->>'p_task_external_id'), '');

    if v_email is null then
      raise exception 'task row is missing p_email';
    end if;
    if v_task_external_id is null then
      raise exception 'task row for % is missing p_task_external_id', v_email;
    end if;
    if nullif(trim(r->>'p_project_slug'), '') is null then
      raise exception 'task % is missing p_project_slug', v_task_external_id;
    end if;

    v_row_key := lower(v_email) || '|' || lower(v_task_external_id);

    insert into public.task_event_sync_stage (
      source_key,
      sync_run_id,
      row_key,
      payload,
      staged_at
    ) values (
      p_source_key,
      p_sync_run_id,
      v_row_key,
      r || jsonb_build_object(
        'p_email', v_email,
        'p_task_external_id', v_task_external_id,
        'p_source_key', p_source_key,
        'p_sync_run_id', p_sync_run_id,
        'p_allow_missing_assignment', false
      ),
      now()
    )
    on conflict (source_key, sync_run_id, row_key) do update
    set payload = excluded.payload,
        staged_at = excluded.staged_at;

    out_task_external_id := v_task_external_id;
    out_status := 'ok';
    out_message := null;
    return next;
  end loop;
end;
$$;

-- This is the unlocked implementation used by the serialized public wrapper.
-- Inactive events remain available for reconciliation but never contribute to
-- portal totals.
create or replace function public.refresh_task_metrics_from_events_unlocked(
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
  with targets as (
    select distinct event.assignment_id
    from public.task_events event
    where event.active
      and (
        p_assignment_ids is null
        or event.assignment_id = any(p_assignment_ids)
      )

    union

    select distinct metric.assignment_id
    from public.task_metrics metric
    where metric.metric_kind = 'event'
      and (
        p_assignment_ids is null
        or metric.assignment_id = any(p_assignment_ids)
      )

    union

    select assignment.id
    from public.assignments assignment
    where p_assignment_ids is not null
      and assignment.id = any(p_assignment_ids)
  ), aggregates as (
    select
      target.assignment_id,
      count(event.id)::integer as submitted,
      count(event.id) filter (where event.status = 'accepted')::integer
        as accepted,
      count(event.id) filter (where event.status = 'rejected')::integer
        as rejected,
      count(event.id) filter (where event.status = 'rework')::integer
        as rework,
      count(event.id) filter (
        where event.status = 'evaluation_pending'
      )::integer as evaluation_pending,
      string_agg(distinct event.source_sheet, ' | ')
        filter (where event.id is not null) as source_sheet
    from targets target
    left join public.task_events event
      on event.assignment_id = target.assignment_id
     and event.active
    group by target.assignment_id
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
      'event'
    from aggregates aggregate
    on conflict (assignment_id, as_of) do update
    set submitted = excluded.submitted,
        accepted = excluded.accepted,
        rejected = excluded.rejected,
        rework = excluded.rework,
        evaluation_pending = excluded.evaluation_pending,
        source_sheet = coalesce(
          excluded.source_sheet,
          public.task_metrics.source_sheet
        ),
        metric_kind = excluded.metric_kind
    returning assignment_id
  )
  select count(*) into v_refreshed from upserted;

  return v_refreshed;
end;
$$;

create or replace function public.finalize_task_event_snapshot(
  p_source_key text,
  p_sync_run_id text,
  p_expected_count integer,
  p_allow_missing_assignments boolean default false
)
returns table(
  out_source_key text,
  out_status text,
  out_message text,
  out_expected_count integer,
  out_active_count integer,
  out_deactivated_count integer,
  out_skipped_count integer
)
language plpgsql
security definer
set search_path = public
set statement_timeout = '180s'
as $$
declare
  v_rows jsonb;
  v_result record;
  v_staged_count integer;
  v_processed_count integer := 0;
  v_skipped_count integer := 0;
  v_updated_count integer;
  v_active_count integer;
  v_deactivated_count integer := 0;
  v_affected_assignment_ids uuid[];
begin
  perform pg_advisory_xact_lock(
    hashtextextended('candidate-portal:assignment-sync', 0)
  );

  p_source_key := nullif(trim(p_source_key), '');
  p_sync_run_id := nullif(trim(p_sync_run_id), '');

  if p_source_key is null then
    raise exception 'source_key is required';
  end if;
  if p_sync_run_id is null then
    raise exception 'sync_run_id is required';
  end if;
  if p_expected_count is null or p_expected_count <= 0 then
    raise exception 'expected_count must be greater than zero';
  end if;

  select
    count(*),
    jsonb_agg(
      stage.payload || jsonb_build_object(
        'p_allow_missing_assignment',
        coalesce(p_allow_missing_assignments, false)
      )
      order by stage.row_key
    )
  into v_staged_count, v_rows
  from public.task_event_sync_stage stage
  where stage.source_key = p_source_key
    and stage.sync_run_id = p_sync_run_id;

  if v_staged_count <> p_expected_count then
    raise exception
      'task snapshot % staged % rows; expected %',
      p_source_key,
      v_staged_count,
      p_expected_count;
  end if;

  for v_result in
    select *
    from public.upsert_task_events_batch_unlocked(v_rows)
  loop
    if v_result.out_status = 'skipped'
      and coalesce(p_allow_missing_assignments, false) then
      v_skipped_count := v_skipped_count + 1;
      continue;
    end if;
    if v_result.out_status is distinct from 'ok' then
      raise exception
        'task snapshot % rejected %: %',
        p_source_key,
        coalesce(v_result.out_task_external_id, '<unknown>'),
        coalesce(v_result.out_message, v_result.out_status);
    end if;
    v_processed_count := v_processed_count + 1;
  end loop;

  if not coalesce(p_allow_missing_assignments, false)
    and v_processed_count <> p_expected_count then
    raise exception
      'task snapshot % processed % rows; expected %',
      p_source_key,
      v_processed_count,
      p_expected_count;
  end if;
  if coalesce(p_allow_missing_assignments, false)
    and v_processed_count + v_skipped_count <> p_expected_count then
    raise exception
      'task snapshot % accounted for % rows; expected %',
      p_source_key,
      v_processed_count + v_skipped_count,
      p_expected_count;
  end if;
  if v_processed_count = 0 then
    raise exception
      'task snapshot % resolved no active assignments',
      p_source_key;
  end if;

  with input_rows as (
    select
      lower(trim(stage.payload->>'p_email')) as email,
      trim(stage.payload->>'p_task_external_id') as task_external_id,
      coalesce(
        nullif(trim(stage.payload->>'p_client'), ''),
        'Snorkel'
      ) as client_name,
      nullif(trim(stage.payload->>'p_vertical'), '') as vertical_name,
      trim(stage.payload->>'p_project_slug') as project_name
    from public.task_event_sync_stage stage
    where stage.source_key = p_source_key
      and stage.sync_run_id = p_sync_run_id
  ), resolved as (
    select input.task_external_id, assignment.id as assignment_id
    from input_rows input
    join public.candidates candidate
      on candidate.email = input.email
    join public.assignments assignment
      on assignment.candidate_id = candidate.id
    join public.subprojects project
      on project.id = assignment.subproject_id
     and project.active
    join public.verticals vertical
      on vertical.id = project.vertical_id
    join public.clients client
      on client.id = vertical.client_id
    where lower(client.display_name) = lower(input.client_name)
      and (
        regexp_replace(lower(project.slug), '[^a-z0-9]+', '', 'g') =
          regexp_replace(lower(input.project_name), '[^a-z0-9]+', '', 'g')
        or regexp_replace(lower(project.display_name), '[^a-z0-9]+', '', 'g') =
          regexp_replace(lower(input.project_name), '[^a-z0-9]+', '', 'g')
      )
      and (
        input.vertical_name is null
        or lower(vertical.display_name) = lower(input.vertical_name)
      )
  )
  update public.task_events event
  set source_key = p_source_key,
      last_seen_run_id = p_sync_run_id,
      last_seen_at = now(),
      active = true,
      updated_at = now()
  from resolved
  where event.assignment_id = resolved.assignment_id
    and lower(trim(event.task_external_id)) =
      lower(trim(resolved.task_external_id));

  get diagnostics v_updated_count = row_count;
  if v_updated_count <> v_processed_count then
    raise exception
      'task snapshot % resolved % rows; expected %',
      p_source_key,
      v_updated_count,
      v_processed_count;
  end if;

  select array_agg(distinct event.assignment_id)
  into v_affected_assignment_ids
  from public.task_events event
  where event.source_key = p_source_key;

  update public.task_events event
  set active = false,
      updated_at = now()
  where event.source_key = p_source_key
    and event.active
    and event.last_seen_run_id is distinct from p_sync_run_id;

  get diagnostics v_deactivated_count = row_count;

  select count(*)
  into v_active_count
  from public.task_events event
  where event.source_key = p_source_key
    and event.active
    and event.last_seen_run_id = p_sync_run_id;

  if v_active_count <> v_processed_count then
    raise exception
      'task snapshot % left % active rows; expected %',
      p_source_key,
      v_active_count,
      v_processed_count;
  end if;

  if cardinality(coalesce(v_affected_assignment_ids, array[]::uuid[])) > 0 then
    perform public.refresh_task_metrics_from_events_unlocked(
      v_affected_assignment_ids
    );
  end if;

  delete from public.task_event_sync_stage stage
  where stage.source_key = p_source_key
    and (
      stage.sync_run_id = p_sync_run_id
      or stage.staged_at < now() - interval '7 days'
    );

  out_source_key := p_source_key;
  out_status := 'ok';
  out_message := null;
  out_expected_count := p_expected_count;
  out_active_count := v_active_count;
  out_deactivated_count := v_deactivated_count;
  out_skipped_count := v_skipped_count;
  return next;
end;
$$;

drop policy if exists task_events_self_read on public.task_events;
create policy task_events_self_read
  on public.task_events
  for select
  to authenticated
  using (
    active
    and assignment_id in (
      select assignment.id
      from public.assignments assignment
      join public.candidates candidate
        on candidate.id = assignment.candidate_id
      where candidate.auth_user_id = auth.uid()
    )
  );

revoke all on function public.stage_task_event_snapshot_batch(text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.stage_task_event_snapshot_batch(text, text, jsonb)
  to service_role;

revoke all on function public.finalize_task_event_snapshot(text, text, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.finalize_task_event_snapshot(text, text, integer, boolean)
  to service_role;

revoke all on function public.refresh_task_metrics_from_events_unlocked(uuid[])
  from public, anon, authenticated, service_role;
