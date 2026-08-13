-- Store project-scoped payment lines so the portal can show an exact total
-- while retaining each source payment component for the candidate breakdown.
alter table public.payments
  add column if not exists source_key text,
  add column if not exists source_sheet text,
  add column if not exists sync_run_id text,
  add column if not exists component_key text,
  add column if not exists component_label text,
  add column if not exists quantity numeric,
  add column if not exists rate_amount numeric,
  add column if not exists rate_currency text,
  add column if not exists gross_amount numeric,
  add column if not exists tds_amount numeric,
  add column if not exists breakdown jsonb not null default '[]'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists payments_assignment_source_reference_uidx
  on public.payments (assignment_id, source_key, reference)
  where source_key is not null;

create index if not exists payments_source_sync_idx
  on public.payments (source_key, sync_run_id);

create or replace function public.sync_project_july_2026_payments(p_rows jsonb)
returns table(
  out_email text,
  out_project text,
  out_component text,
  out_status text,
  out_message text,
  out_amount numeric
)
language plpgsql
security definer
set search_path = public
set statement_timeout = '120s'
as $$
declare
  r jsonb;
  v_candidate_id uuid;
  v_assignment_id uuid;
  v_assignment_count integer;
  v_sync_run_id text;
  v_source_key constant text := 'project-payments-july-2026';
  v_projects text[];
  v_components text[];
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'p_rows must be a non-empty JSON array';
  end if;

  select array_agg(project_name order by project_name)
  into v_projects
  from (
    select distinct lower(trim(value->>'p_project')) as project_name
    from jsonb_array_elements(p_rows)
  ) projects;

  if not v_projects <@ array['mojave', 'otter', 'sentinel ultra', 'terminus']::text[] then
    raise exception 'unexpected project in payment snapshot: %',
      v_projects;
  end if;

  select array_agg(component_name order by component_name)
  into v_components
  from (
    select distinct lower(trim(component.value)) as component_name
    from jsonb_array_elements_text(p_rows->0->'p_observed_components') component(value)
  ) components;

  if v_components is distinct from array[
    'assessment', 'fixable', 'mojave_total', 'non_fixable',
    'review', 'task', 'workflow_a', 'workflow_b'
  ]::text[] then
    raise exception 'payment source snapshot is incomplete: %', v_components;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows)
    where value->'p_observed_components' is distinct from p_rows->0->'p_observed_components'
  ) then
    raise exception 'payment rows disagree about observed source components';
  end if;

  select min(nullif(trim(value->>'p_sync_run_id'), ''))
  into v_sync_run_id
  from jsonb_array_elements(p_rows);

  if v_sync_run_id is null or exists (
    select 1
    from jsonb_array_elements(p_rows)
    where nullif(trim(value->>'p_sync_run_id'), '') is distinct from v_sync_run_id
  ) then
    raise exception 'every payment row must contain the same non-empty sync run id';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows)
    where lower(trim(value->>'p_source_key')) <> v_source_key
       or lower(trim(value->>'p_client')) <> 'snorkel'
       or lower(trim(value->>'p_currency')) <> 'inr'
       or lower(trim(value->>'p_status')) not in ('disbursed', 'processing', 'failed')
       or nullif(trim(value->>'p_email'), '') is null
       or nullif(trim(value->>'p_reference'), '') is null
       or nullif(trim(value->>'p_component_label'), '') is null
       or coalesce(nullif(trim(value->>'p_amount'), '')::numeric, 0) <= 0
       or jsonb_typeof(coalesce(value->'p_breakdown', '[]'::jsonb)) <> 'array'
  ) then
    raise exception 'one or more project payment rows failed snapshot validation';
  end if;

  if jsonb_array_length(p_rows) <> (
    select count(distinct concat_ws(
      '|',
      lower(trim(value->>'p_email')),
      lower(trim(value->>'p_project')),
      lower(trim(value->>'p_component_key'))
    ))
    from jsonb_array_elements(p_rows)
  ) then
    raise exception 'duplicate email/project/component rows must be aggregated before sync';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    out_email := lower(trim(r->>'p_email'));
    out_project := trim(r->>'p_project');
    out_component := trim(r->>'p_component_key');
    out_amount := (r->>'p_amount')::numeric;

    select candidate.id
    into v_candidate_id
    from public.candidates candidate
    where lower(candidate.email) = out_email;

    if v_candidate_id is null then
      out_status := 'skipped';
      out_message := 'candidate is not in the portal roster';
      return next;
      continue;
    end if;

    select count(*)
    into v_assignment_count
    from public.assignments assignment
    join public.subprojects project on project.id = assignment.subproject_id
    join public.verticals vertical on vertical.id = project.vertical_id
    join public.clients client on client.id = vertical.client_id
    where assignment.candidate_id = v_candidate_id
      and project.active
      and lower(client.display_name) = 'snorkel'
      and lower(vertical.display_name) = lower(trim(r->>'p_vertical'))
      and lower(project.display_name) = lower(out_project);

    if v_assignment_count = 0 then
      out_status := 'skipped';
      out_message := 'candidate has no matching active project assignment';
      return next;
      continue;
    end if;

    if v_assignment_count > 1 then
      raise exception 'ambiguous Snorkel/%/% assignment for %',
        r->>'p_vertical', out_project, out_email;
    end if;

    select assignment.id
    into v_assignment_id
    from public.assignments assignment
    join public.subprojects project on project.id = assignment.subproject_id
    join public.verticals vertical on vertical.id = project.vertical_id
    join public.clients client on client.id = vertical.client_id
    where assignment.candidate_id = v_candidate_id
      and project.active
      and lower(client.display_name) = 'snorkel'
      and lower(vertical.display_name) = lower(trim(r->>'p_vertical'))
      and lower(project.display_name) = lower(out_project);

    insert into public.payments (
      assignment_id,
      period_start,
      period_end,
      amount,
      currency,
      status,
      paid_on,
      reference,
      source_key,
      source_sheet,
      sync_run_id,
      component_key,
      component_label,
      quantity,
      rate_amount,
      rate_currency,
      gross_amount,
      tds_amount,
      breakdown,
      created_at,
      updated_at
    ) values (
      v_assignment_id,
      date '2026-07-01',
      date '2026-07-31',
      out_amount,
      'INR',
      lower(trim(r->>'p_status')),
      nullif(trim(r->>'p_paid_on'), '')::date,
      trim(r->>'p_reference'),
      v_source_key,
      nullif(trim(r->>'p_source_sheet'), ''),
      v_sync_run_id,
      out_component,
      trim(r->>'p_component_label'),
      nullif(trim(r->>'p_quantity'), '')::numeric,
      nullif(trim(r->>'p_rate_amount'), '')::numeric,
      nullif(trim(r->>'p_rate_currency'), ''),
      nullif(trim(r->>'p_gross_amount'), '')::numeric,
      nullif(trim(r->>'p_tds_amount'), '')::numeric,
      coalesce(r->'p_breakdown', '[]'::jsonb),
      now(),
      now()
    )
    on conflict (assignment_id, source_key, reference)
      where source_key is not null
    do update set
      period_start = excluded.period_start,
      period_end = excluded.period_end,
      amount = excluded.amount,
      currency = excluded.currency,
      status = excluded.status,
      paid_on = excluded.paid_on,
      source_sheet = excluded.source_sheet,
      sync_run_id = excluded.sync_run_id,
      component_key = excluded.component_key,
      component_label = excluded.component_label,
      quantity = excluded.quantity,
      rate_amount = excluded.rate_amount,
      rate_currency = excluded.rate_currency,
      gross_amount = excluded.gross_amount,
      tds_amount = excluded.tds_amount,
      breakdown = excluded.breakdown,
      updated_at = now();

    out_status := 'ok';
    out_message := null;
    return next;
  end loop;

  delete from public.payments payment
  where payment.source_key = v_source_key
    and payment.sync_run_id is distinct from v_sync_run_id;

  -- The new Mojave workbook is authoritative. Remove the aggregate imported
  -- from the previous source even when the current sheet has no Final Amt rows.
  delete from public.payments payment
  where payment.source_key is null
    and payment.reference = 'Mojave / July 2026';
end;
$$;

revoke all on function public.sync_project_july_2026_payments(jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_project_july_2026_payments(jsonb)
  to service_role;
