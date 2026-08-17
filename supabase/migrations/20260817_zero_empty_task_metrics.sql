-- Keep portal task totals accurate when an assignment loses its final raw task.
-- Metrics produced from task_events are marked separately so a full refresh can
-- safely revisit empty event-backed assignments without overwriting aggregate
-- metrics that come directly from other source sheets.
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
  with targets as (
    select distinct event.assignment_id
    from public.task_events event
    where p_assignment_ids is null
       or event.assignment_id = any(p_assignment_ids)

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
      count(event.id) filter (
        where lower(trim(event.status)) in (
          'accepted',
          'approved',
          'provisionally accepted'
        )
      )::integer as accepted,
      count(event.id) filter (
        where lower(trim(event.status)) in ('rejected', 'invalid')
      )::integer as rejected,
      count(event.id) filter (
        where lower(trim(event.status)) in (
          'needs revision',
          'needs_revision',
          'rework',
          'requiring rework'
        )
      )::integer as rework,
      count(event.id) filter (
        where coalesce(lower(trim(event.status)), '') not in (
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
      string_agg(distinct event.source_sheet, ' | ')
        filter (where event.id is not null) as source_sheet
    from targets target
    left join public.task_events event
      on event.assignment_id = target.assignment_id
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

revoke all on function public.refresh_task_metrics_from_events(uuid[])
  from public, anon, authenticated;
grant execute on function public.refresh_task_metrics_from_events(uuid[])
  to service_role;

