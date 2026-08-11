with coding_vertical as (
  select v.id
  from public.verticals v
  join public.clients c on c.id = v.client_id
  where c.display_name = 'Snorkel'
    and v.display_name = 'Coding'
  order by (
    select count(*)
    from public.subprojects sp
    where sp.vertical_id = v.id
      and sp.active
  ) desc, v.id
  limit 1
)
insert into public.subprojects (vertical_id, slug, display_name, active)
select coding_vertical.id, 'paperbench', 'PaperBench', true
from coding_vertical
where not exists (
  select 1
  from public.subprojects existing
  where existing.vertical_id = coding_vertical.id
    and lower(existing.display_name) = 'paperbench'
);

insert into public.project_payment_templates (
  subproject_id,
  payment_key,
  label,
  currency,
  is_assignment_rate,
  is_specified,
  display_order
)
select
  sp.id,
  'not_specified',
  'Payment details',
  'INR',
  false,
  false,
  1
from public.subprojects sp
join public.verticals v on v.id = sp.vertical_id
join public.clients c on c.id = v.client_id
where c.display_name = 'Snorkel'
  and v.display_name = 'Coding'
  and sp.display_name = 'PaperBench'
on conflict (subproject_id, payment_key) do update
set
  label = excluded.label,
  currency = excluded.currency,
  is_assignment_rate = excluded.is_assignment_rate,
  is_specified = excluded.is_specified,
  display_order = excluded.display_order;
