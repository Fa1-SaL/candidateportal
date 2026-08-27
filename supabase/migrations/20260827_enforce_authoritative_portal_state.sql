-- Keep roster membership, assignment visibility, and task visibility aligned
-- even when independently scheduled workflow branches overlap.

begin;

set local lock_timeout = '180s';
set local statement_timeout = '300s';

select pg_advisory_xact_lock(
  hashtextextended('candidate-portal:assignment-sync', 0)
);
select pg_advisory_xact_lock(
  hashtextextended('candidate-portal:task-event-sync', 0)
);

create or replace function public.enforce_assignment_membership_state()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  new.contract_status := case lower(btrim(coalesce(new.contract_status, '')))
    when 'unmapped:not shared' then 'not_signed'
    when 'unmapped:revised signed' then 'signed'
    else new.contract_status
  end;

  if exists (
    select 1
    from public.portal_assignment_memberships membership
    where membership.assignment_id = new.id
  ) then
    new.is_offboarded_heuristic := not exists (
      select 1
      from public.portal_assignment_memberships membership
      where membership.assignment_id = new.id
        and membership.active
    );
  end if;

  return new;
end;
$$;

drop trigger if exists assignments_enforce_membership_state
  on public.assignments;
create trigger assignments_enforce_membership_state
before insert or update on public.assignments
for each row
execute function public.enforce_assignment_membership_state();

create or replace function public.sync_assignment_from_membership()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_assignment_id uuid;
  v_should_be_offboarded boolean;
begin
  if tg_op = 'DELETE' then
    v_assignment_id := old.assignment_id;
  else
    v_assignment_id := new.assignment_id;
  end if;

  select not exists (
    select 1
    from public.portal_assignment_memberships membership
    where membership.assignment_id = v_assignment_id
      and membership.active
  )
  into v_should_be_offboarded;

  update public.assignments assignment
  set is_offboarded_heuristic = v_should_be_offboarded,
      updated_at = now()
  where assignment.id = v_assignment_id
    and assignment.is_offboarded_heuristic is distinct from
      v_should_be_offboarded;

  return null;
end;
$$;

drop trigger if exists memberships_sync_assignment_state
  on public.portal_assignment_memberships;
create trigger memberships_sync_assignment_state
after insert or update or delete on public.portal_assignment_memberships
for each row
execute function public.sync_assignment_from_membership();

create or replace function public.prevent_tasks_on_offboarded_assignment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.active and exists (
    select 1
    from public.assignments assignment
    where assignment.id = new.assignment_id
      and assignment.is_offboarded_heuristic
  ) then
    new.active := false;
  end if;

  return new;
end;
$$;

drop trigger if exists task_events_require_active_assignment
  on public.task_events;
create trigger task_events_require_active_assignment
before insert or update on public.task_events
for each row
execute function public.prevent_tasks_on_offboarded_assignment();

create or replace function public.deactivate_tasks_after_offboarding()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.task_events event
  set active = false,
      updated_at = now()
  where event.assignment_id = new.id
    and event.active;

  return null;
end;
$$;

drop trigger if exists assignments_deactivate_tasks_after_offboarding
  on public.assignments;
create trigger assignments_deactivate_tasks_after_offboarding
after update of is_offboarded_heuristic on public.assignments
for each row
when (
  new.is_offboarded_heuristic
  and old.is_offboarded_heuristic is distinct from
    new.is_offboarded_heuristic
)
execute function public.deactivate_tasks_after_offboarding();

revoke all on function public.enforce_assignment_membership_state()
  from public, anon, authenticated, service_role;
revoke all on function public.sync_assignment_from_membership()
  from public, anon, authenticated, service_role;
revoke all on function public.prevent_tasks_on_offboarded_assignment()
  from public, anon, authenticated, service_role;
revoke all on function public.deactivate_tasks_after_offboarding()
  from public, anon, authenticated, service_role;

-- Reconcile existing rows once. Future writes are protected by the triggers.
update public.assignments assignment
set is_offboarded_heuristic = not exists (
      select 1
      from public.portal_assignment_memberships membership
      where membership.assignment_id = assignment.id
        and membership.active
    ),
    updated_at = now()
where exists (
    select 1
    from public.portal_assignment_memberships membership
    where membership.assignment_id = assignment.id
  )
  and assignment.is_offboarded_heuristic is distinct from not exists (
    select 1
    from public.portal_assignment_memberships membership
    where membership.assignment_id = assignment.id
      and membership.active
  );

update public.assignments assignment
set contract_status = case lower(btrim(assignment.contract_status))
      when 'unmapped:not shared' then 'not_signed'
      when 'unmapped:revised signed' then 'signed'
      else assignment.contract_status
    end,
    updated_at = now()
where lower(btrim(coalesce(assignment.contract_status, ''))) in (
  'unmapped:not shared',
  'unmapped:revised signed'
);

update public.task_events event
set active = false,
    updated_at = now()
where event.active
  and (
    exists (
      select 1
      from public.assignments assignment
      where assignment.id = event.assignment_id
        and assignment.is_offboarded_heuristic
    )
    or (
      event.source_sheet = 'manual_test_seed'
      and event.task_external_id like 'manual-test-task-%'
    )
  );

select public.refresh_task_metrics_from_events_unlocked(null);

do $verification$
begin
  if exists (
    select 1
    from public.assignments assignment
    where exists (
        select 1
        from public.portal_assignment_memberships membership
        where membership.assignment_id = assignment.id
      )
      and assignment.is_offboarded_heuristic is distinct from not exists (
        select 1
        from public.portal_assignment_memberships membership
        where membership.assignment_id = assignment.id
          and membership.active
      )
  ) then
    raise exception 'assignment membership reconciliation failed';
  end if;

  if exists (
    select 1
    from public.task_events event
    join public.assignments assignment on assignment.id = event.assignment_id
    where event.active
      and assignment.is_offboarded_heuristic
  ) then
    raise exception 'offboarded assignments still have active task events';
  end if;

  if exists (
    select 1
    from public.task_events event
    where event.active
      and event.status not in (
        'accepted', 'rejected', 'rework', 'evaluation_pending'
      )
  ) then
    raise exception 'unsupported active task status remains';
  end if;

  if exists (
    select 1
    from public.assignments assignment
    where not assignment.is_offboarded_heuristic
      and (
        assignment.contract_status like 'unmapped:%'
        or assignment.remofirst_status like 'unmapped:%'
      )
  ) then
    raise exception 'unmapped active assignment status remains';
  end if;
end;
$verification$;

commit;
