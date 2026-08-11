create table if not exists public.project_payment_templates (
  id uuid primary key default gen_random_uuid(),
  subproject_id uuid not null references public.subprojects (id) on delete cascade,
  payment_key text not null,
  label text not null,
  amount numeric,
  minimum_amount numeric,
  maximum_amount numeric,
  currency text not null default 'INR',
  unit text,
  is_assignment_rate boolean not null default false,
  is_specified boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint project_payment_templates_amount_shape check (
    amount is null or (minimum_amount is null and maximum_amount is null)
  ),
  constraint project_payment_templates_range_shape check (
    (minimum_amount is null and maximum_amount is null)
    or (
      minimum_amount is not null
      and maximum_amount is not null
      and minimum_amount <= maximum_amount
    )
  ),
  unique (subproject_id, payment_key)
);

create table if not exists public.assignment_payment_terms (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  template_id uuid references public.project_payment_templates (id) on delete set null,
  payment_key text not null,
  label text not null,
  amount numeric,
  minimum_amount numeric,
  maximum_amount numeric,
  currency text not null default 'INR',
  unit text,
  is_assignment_rate boolean not null default false,
  is_specified boolean not null default true,
  is_manual_override boolean not null default false,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint assignment_payment_terms_amount_shape check (
    amount is null or (minimum_amount is null and maximum_amount is null)
  ),
  constraint assignment_payment_terms_range_shape check (
    (minimum_amount is null and maximum_amount is null)
    or (
      minimum_amount is not null
      and maximum_amount is not null
      and minimum_amount <= maximum_amount
    )
  ),
  unique (assignment_id, payment_key)
);

create index if not exists assignment_payment_terms_assignment_id_idx
  on public.assignment_payment_terms (assignment_id, display_order);

alter table public.assignment_payment_terms enable row level security;

grant select on public.assignment_payment_terms to anon, authenticated;

drop policy if exists assignment_payment_terms_self_read
  on public.assignment_payment_terms;

create policy assignment_payment_terms_self_read
  on public.assignment_payment_terms
  for select
  using (
    assignment_id in (
      select a.id
      from public.assignments a
      join public.candidates c on c.id = a.candidate_id
      where c.auth_user_id = auth.uid()
    )
  );

create or replace function public.sync_assignment_payment_terms()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.assignment_payment_terms (
    assignment_id,
    template_id,
    payment_key,
    label,
    amount,
    minimum_amount,
    maximum_amount,
    currency,
    unit,
    is_assignment_rate,
    is_specified,
    display_order
  )
  select
    new.id,
    template.id,
    template.payment_key,
    template.label,
    case when template.is_assignment_rate then new.rate_amount else template.amount end,
    case when template.is_assignment_rate then null else template.minimum_amount end,
    case when template.is_assignment_rate then null else template.maximum_amount end,
    case when template.is_assignment_rate then coalesce(new.rate_currency, template.currency) else template.currency end,
    case when template.is_assignment_rate then coalesce(new.rate_unit, template.unit) else template.unit end,
    template.is_assignment_rate,
    template.is_specified,
    template.display_order
  from public.project_payment_templates template
  where template.subproject_id = new.subproject_id
  on conflict (assignment_id, payment_key) do update
  set
    template_id = excluded.template_id,
    label = excluded.label,
    amount = excluded.amount,
    minimum_amount = excluded.minimum_amount,
    maximum_amount = excluded.maximum_amount,
    currency = excluded.currency,
    unit = excluded.unit,
    is_assignment_rate = excluded.is_assignment_rate,
    is_specified = excluded.is_specified,
    display_order = excluded.display_order
  where not public.assignment_payment_terms.is_manual_override;

  return new;
end;
$$;

drop trigger if exists assignments_sync_payment_terms
  on public.assignments;

create trigger assignments_sync_payment_terms
after insert or update of subproject_id, rate_amount, rate_currency, rate_unit
on public.assignments
for each row
execute function public.sync_assignment_payment_terms();

with coding_vertical as (
  select vertical.id
  from public.verticals vertical
  join public.clients client on client.id = vertical.client_id
  where client.display_name = 'Snorkel'
    and vertical.display_name = 'Coding'
  order by (
    select count(*)
    from public.subprojects subproject
    where subproject.vertical_id = vertical.id
      and subproject.active
  ) desc, vertical.id
  limit 1
)
insert into public.subprojects (vertical_id, slug, display_name, active)
select coding_vertical.id, project.slug, project.display_name, true
from coding_vertical
cross join (
  values
    ('suite-life', 'SuiteLife'),
    ('rudder', 'Rudder')
) as project(slug, display_name)
where not exists (
  select 1
  from public.subprojects existing
  where existing.vertical_id = coding_vertical.id
    and lower(existing.display_name) = lower(project.display_name)
);

update public.assignments assignment
set
  subproject_id = (
    select target.id
    from public.subprojects target
    join public.verticals target_vertical on target_vertical.id = target.vertical_id
    join public.clients target_client on target_client.id = target_vertical.client_id
    where target_client.display_name = 'Snorkel'
      and target_vertical.display_name = 'Coding'
      and target.display_name = 'Otter'
    limit 1
  ),
  rate_amount = 8000,
  rate_currency = 'INR',
  rate_unit = 'Workflow A'
where assignment.id in (
  select a.id
  from public.assignments a
  join public.candidates candidate on candidate.id = a.candidate_id
  join public.subprojects current_project on current_project.id = a.subproject_id
  join public.verticals current_vertical on current_vertical.id = current_project.vertical_id
  join public.clients current_client on current_client.id = current_vertical.client_id
  where lower(candidate.email) in ('faisal@crossinghurdles.com', 'sankalp@crossinghurdles.com')
    and current_client.display_name = 'Snorkel'
    and current_vertical.display_name = 'Coding'
    and current_project.display_name = 'Paper'
);

with coding_vertical as (
  select vertical.id
  from public.verticals vertical
  join public.clients client on client.id = vertical.client_id
  where client.display_name = 'Snorkel'
    and vertical.display_name = 'Coding'
  order by (
    select count(*)
    from public.subprojects subproject
    where subproject.vertical_id = vertical.id
      and subproject.active
  ) desc, vertical.id
  limit 1
)
update public.assignments assignment
set
  rate_amount = case
    when exists (
      select 1
      from public.candidates candidate
      where candidate.id = assignment.candidate_id
        and lower(candidate.email) = 'faisal@crossinghurdles.com'
    ) then 8000
    else 7000
  end,
  rate_currency = 'INR',
  rate_unit = 'Approved Task'
where assignment.id in (
  select a.id
  from public.assignments a
  join public.candidates candidate on candidate.id = a.candidate_id
  join public.subprojects project on project.id = a.subproject_id
  join coding_vertical on coding_vertical.id = project.vertical_id
  where lower(candidate.email) in ('faisal@crossinghurdles.com', 'sankalp@crossinghurdles.com')
    and project.display_name = 'Terminus'
);

with template_values as (
  select *
  from (
    values
      ('STEM', 'Riga', 'per_approved_task', 'Per approved task', null::numeric, null::numeric, null::numeric, 'INR', 'Approved Task', true, true, 1),
      ('STEM', 'Rainier', 'per_approved_task', 'Per approved task', null::numeric, null::numeric, null::numeric, 'INR', 'Approved Task', true, true, 1),
      ('STEM', 'Starfish', 'per_approved_task', 'Per approved task', null::numeric, null::numeric, null::numeric, 'INR', 'Approved Task', true, true, 1),
      ('STEM', 'Sequoia', 'per_approved_task', 'Per approved task', null::numeric, null::numeric, null::numeric, 'INR', 'Approved Task', true, true, 1),
      ('Mojave', 'Mojave', 'per_approved_task', 'Per approved task', null::numeric, null::numeric, null::numeric, 'INR', 'Approved Task', true, true, 1),
      ('Mojave', 'Mojave', 'review', 'Review', null::numeric, null::numeric, null::numeric, 'INR', null::text, false, false, 2),
      ('Mojave', 'Mojave', 'review_bonus', 'Review bonus', null::numeric, null::numeric, null::numeric, 'INR', null::text, false, false, 3),
      ('Coding', 'Terminus', 'per_approved_task', 'Per approved task', null::numeric, 7000::numeric, 8000::numeric, 'INR', null::text, false, true, 1),
      ('Coding', 'Terminus', 'review', 'Review', 1000::numeric, null::numeric, null::numeric, 'INR', null::text, false, true, 2),
      ('Coding', 'Otter', 'workflow_a', 'Workflow A', 8000::numeric, null::numeric, null::numeric, 'INR', null::text, false, true, 1),
      ('Coding', 'Otter', 'workflow_b', 'Workflow B', 1800::numeric, null::numeric, null::numeric, 'INR', null::text, false, true, 2),
      ('Coding', 'Sentinel Ultra', 'fixable', 'Fixable', 5200::numeric, null::numeric, null::numeric, 'INR', null::text, false, true, 1),
      ('Coding', 'Sentinel Ultra', 'non_fixable', 'Non Fixable', 1800::numeric, null::numeric, null::numeric, 'INR', null::text, false, true, 2),
      ('Coding', 'Sentinel Ultra', 'review', 'Review', 1000::numeric, null::numeric, null::numeric, 'INR', null::text, false, true, 3),
      ('Coding', 'Sentinel Ultra', 'assessment', 'Assessment', 700::numeric, null::numeric, null::numeric, 'INR', null::text, false, true, 4),
      ('Coding', 'SuiteLife', 'not_specified', 'Payment details', null::numeric, null::numeric, null::numeric, 'INR', null::text, false, false, 1),
      ('Coding', 'Rudder', 'not_specified', 'Payment details', null::numeric, null::numeric, null::numeric, 'INR', null::text, false, false, 1)
  ) as values_list(vertical_name, project_name, payment_key, label, amount, minimum_amount, maximum_amount, currency, unit, is_assignment_rate, is_specified, display_order)
)
insert into public.project_payment_templates (
  subproject_id,
  payment_key,
  label,
  amount,
  minimum_amount,
  maximum_amount,
  currency,
  unit,
  is_assignment_rate,
  is_specified,
  display_order
)
select
  subproject.id,
  template_values.payment_key,
  template_values.label,
  template_values.amount,
  template_values.minimum_amount,
  template_values.maximum_amount,
  template_values.currency,
  template_values.unit,
  template_values.is_assignment_rate,
  template_values.is_specified,
  template_values.display_order
from template_values
join public.verticals vertical on vertical.display_name = template_values.vertical_name
join public.clients client
  on client.id = vertical.client_id
  and client.display_name = 'Snorkel'
join public.subprojects subproject
  on subproject.vertical_id = vertical.id
  and subproject.display_name = template_values.project_name
on conflict (subproject_id, payment_key) do update
set
  label = excluded.label,
  amount = excluded.amount,
  minimum_amount = excluded.minimum_amount,
  maximum_amount = excluded.maximum_amount,
  currency = excluded.currency,
  unit = excluded.unit,
  is_assignment_rate = excluded.is_assignment_rate,
  is_specified = excluded.is_specified,
  display_order = excluded.display_order;

insert into public.assignment_payment_terms (
  assignment_id,
  template_id,
  payment_key,
  label,
  amount,
  minimum_amount,
  maximum_amount,
  currency,
  unit,
  is_assignment_rate,
  is_specified,
  display_order
)
select
  assignment.id,
  template.id,
  template.payment_key,
  template.label,
  case when template.is_assignment_rate then assignment.rate_amount else template.amount end,
  case when template.is_assignment_rate then null else template.minimum_amount end,
  case when template.is_assignment_rate then null else template.maximum_amount end,
  case when template.is_assignment_rate then coalesce(assignment.rate_currency, template.currency) else template.currency end,
  case when template.is_assignment_rate then coalesce(assignment.rate_unit, template.unit) else template.unit end,
  template.is_assignment_rate,
  template.is_specified,
  template.display_order
from public.assignments assignment
join public.project_payment_templates template
  on template.subproject_id = assignment.subproject_id
where not coalesce(assignment.is_offboarded_heuristic, false)
on conflict (assignment_id, payment_key) do update
set
  template_id = excluded.template_id,
  label = excluded.label,
  amount = excluded.amount,
  minimum_amount = excluded.minimum_amount,
  maximum_amount = excluded.maximum_amount,
  currency = excluded.currency,
  unit = excluded.unit,
  is_assignment_rate = excluded.is_assignment_rate,
  is_specified = excluded.is_specified,
  display_order = excluded.display_order
where not public.assignment_payment_terms.is_manual_override;

with obsolete_projects as (
  select sp.id
  from public.subprojects sp
  join public.verticals v on v.id = sp.vertical_id
  join public.clients c on c.id = v.client_id
  where c.display_name = 'Snorkel'
    and (
      (v.display_name = 'Coding' and sp.display_name in ('Paper', 'Riga', 'Sequoia'))
     or (v.display_name = 'Mojave' and sp.display_name = 'Mojave Pilot')
     or (
       v.display_name = 'STEM'
       and sp.display_name in ('Rainier', 'Starfish')
       and not exists (
         select 1
         from public.assignments a
         where a.subproject_id = sp.id
       )
     )
    )
)
update public.subprojects
set active = false
where id in (select id from obsolete_projects);
