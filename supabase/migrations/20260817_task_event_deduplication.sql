-- The task identity migration initially preserved old rows with legacy UUID
-- keys. A later sync then inserted the same task under its source key, which
-- made the portal count and render most tasks twice. The portal's task unit is
-- one task ID on one candidate assignment; submission details remain attached
-- to the newest row for that task.
with ranked_events as (
  select
    event.id,
    row_number() over (
      partition by
        event.assignment_id,
        lower(trim(event.task_external_id))
      order by
        case when event.source_event_key like 'legacy:%' then 1 else 0 end,
        coalesce(
          event.submitted_at_source,
          event.created_at_source,
          event.updated_at
        ) desc nulls last,
        event.updated_at desc nulls last,
        event.id desc
    ) as identity_rank
  from public.task_events event
)
delete from public.task_events event
using ranked_events ranked
where event.id = ranked.id
  and ranked.identity_rank > 1;

-- Canonical keys make all current and future writers converge on the same row,
-- even if separate workflow branches provide different source/submission keys.
update public.task_events event
set source_event_key = concat_ws(
      '|',
      'task-event',
      event.assignment_id::text,
      lower(trim(event.task_external_id))
    ),
    task_external_id = trim(event.task_external_id),
    updated_at = now();

create unique index if not exists task_events_assignment_task_identity_key
  on public.task_events (
    assignment_id,
    (lower(trim(task_external_id)))
  );

create or replace function public.canonicalize_task_event_identity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.assignment_id is null then
    raise exception 'assignment_id is required';
  end if;
  if nullif(trim(new.task_external_id), '') is null then
    raise exception 'task_external_id is required';
  end if;

  new.task_external_id := trim(new.task_external_id);
  new.source_event_key := concat_ws(
    '|',
    'task-event',
    new.assignment_id::text,
    lower(new.task_external_id)
  );

  return new;
end;
$$;

drop trigger if exists task_events_canonical_identity
  on public.task_events;

create trigger task_events_canonical_identity
before insert or update of assignment_id, task_external_id, source_event_key
on public.task_events
for each row
execute function public.canonicalize_task_event_identity();

revoke all on function public.canonicalize_task_event_identity()
  from public, anon, authenticated;

-- Recalculate today's portal metrics from the now-canonical event rows.
select public.refresh_task_metrics_from_events(null);
