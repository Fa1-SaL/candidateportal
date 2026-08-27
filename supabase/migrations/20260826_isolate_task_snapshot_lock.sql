-- Authoritative task snapshots do not mutate candidate or assignment rows.
-- Give them their own advisory-lock lane so roster syncs cannot starve task
-- finalizers, while still serializing task-event and task-metric writes.

do $migration$
declare
  v_signature regprocedure;
  v_definition text;
begin
  foreach v_signature in array array[
    to_regprocedure(
      'public.stage_task_event_snapshot_batch(text,text,jsonb)'
    ),
    to_regprocedure(
      'public.finalize_task_event_snapshot(text,text,integer,boolean)'
    )
  ] loop
    if v_signature is null then
      raise exception 'authoritative task snapshot function is missing';
    end if;

    select pg_get_functiondef(v_signature)
    into v_definition;

    if strpos(v_definition, 'candidate-portal:assignment-sync') = 0 then
      raise exception
        'expected assignment-sync lock was not found in %',
        v_signature;
    end if;

    v_definition := replace(
      v_definition,
      'candidate-portal:assignment-sync',
      'candidate-portal:task-event-sync'
    );

    execute v_definition;
  end loop;
end;
$migration$;

alter function public.stage_task_event_snapshot_batch(text, text, jsonb)
  set lock_timeout = '170s';
alter function public.stage_task_event_snapshot_batch(text, text, jsonb)
  set statement_timeout = '300s';

alter function public.finalize_task_event_snapshot(text, text, integer, boolean)
  set lock_timeout = '170s';
alter function public.finalize_task_event_snapshot(text, text, integer, boolean)
  set statement_timeout = '300s';

do $verification$
begin
  if pg_get_functiondef(
      'public.stage_task_event_snapshot_batch(text,text,jsonb)'::regprocedure
    ) not like '%candidate-portal:task-event-sync%'
  then
    raise exception 'task snapshot staging lock was not isolated';
  end if;

  if pg_get_functiondef(
      'public.finalize_task_event_snapshot(text,text,integer,boolean)'::regprocedure
    ) not like '%candidate-portal:task-event-sync%'
  then
    raise exception 'task snapshot finalizer lock was not isolated';
  end if;
end;
$verification$;
