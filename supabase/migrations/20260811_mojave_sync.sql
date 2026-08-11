-- Mojave source sheets include sensitive payroll and identity columns. The
-- ingestion functions below accept only portal-facing assignment, task, rate,
-- and payment fields.
create or replace function public.upsert_mojave_activity_batch(p_rows jsonb)
returns table(out_email text, out_status text, out_message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_assignment_status text;
  v_assignment_message text;
  v_metric_status text;
  v_metric_message text;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    begin
      select result.out_status, result.out_message
      into v_assignment_status, v_assignment_message
      from public.upsert_candidate_assignments_batch(
        jsonb_build_array(jsonb_build_object(
          'p_email', r->>'p_email',
          'p_full_name', r->>'p_full_name',
          'p_client', 'Snorkel',
          'p_vertical', 'Mojave',
          'p_project', 'Mojave',
          'p_domain', r->>'p_domain',
          'p_contract_status', r->>'p_contract_status',
          'p_is_offboarded_heuristic', false,
          'p_source_sheet', r->>'p_source_sheet'
        )
      )) as result
      limit 1;

      if v_assignment_status is distinct from 'ok' then
        raise exception '%', coalesce(v_assignment_message, 'could not upsert assignment');
      end if;

      select result.out_status, result.out_message
      into v_metric_status, v_metric_message
      from public.upsert_task_metrics_batch(
        jsonb_build_array(jsonb_build_object(
          'p_email', r->>'p_email',
          'p_project_slug', 'mojave',
          'p_as_of', r->>'p_as_of',
          'p_submitted', r->>'p_submitted',
          'p_accepted', r->>'p_accepted',
          'p_rejected', r->>'p_rejected',
          'p_rework', r->>'p_rework',
          'p_source_sheet', r->>'p_source_sheet',
          'p_metric_kind', 'cumulative'
        )
      )) as result
      limit 1;

      if v_metric_status is distinct from 'ok' then
        raise exception '%', coalesce(v_metric_message, 'could not upsert task metrics');
      end if;

      out_email := lower(trim(r->>'p_email'));
      out_status := 'ok';
      out_message := null;
      return next;
    exception when others then
      out_email := lower(trim(coalesce(r->>'p_email', '')));
      out_status := 'error';
      out_message := sqlerrm;
      return next;
    end;
  end loop;
end;
$$;

create or replace function public.upsert_mojave_compensation_batch(p_rows jsonb)
returns table(out_email text, out_status text, out_message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_assignment_status text;
  v_assignment_message text;
  v_assignment_id uuid;
  v_template_id uuid;
  v_payment_reference text;
  v_payment_amount numeric;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    begin
      select result.out_status, result.out_message
      into v_assignment_status, v_assignment_message
      from public.upsert_candidate_assignments_batch(
        jsonb_build_array(jsonb_build_object(
          'p_email', r->>'p_email',
          'p_full_name', r->>'p_full_name',
          'p_client', 'Snorkel',
          'p_vertical', 'Mojave',
          'p_project', 'Mojave',
          'p_contract_status', r->>'p_contract_status',
          'p_rate_amount', r->>'p_task_rate_amount',
          'p_rate_currency', r->>'p_currency',
          'p_rate_unit', 'Approved Task',
          'p_is_offboarded_heuristic', false,
          'p_source_sheet', r->>'p_source_sheet'
        )
      )) as result
      limit 1;

      if v_assignment_status is distinct from 'ok' then
        raise exception '%', coalesce(v_assignment_message, 'could not upsert compensation assignment');
      end if;

      select a.id
      into v_assignment_id
      from public.assignments a
      join public.candidates c on c.id = a.candidate_id
      join public.subprojects sp on sp.id = a.subproject_id
      join public.verticals v on v.id = sp.vertical_id
      join public.clients cl on cl.id = v.client_id
      where lower(c.email) = lower(trim(r->>'p_email'))
        and cl.display_name = 'Snorkel'
        and v.display_name = 'Mojave'
        and sp.display_name = 'Mojave'
      limit 1;

      if v_assignment_id is null then
        raise exception 'could not resolve Mojave assignment';
      end if;

      if nullif(trim(r->>'p_review_rate_amount'), '') is not null then
        select template.id
        into v_template_id
        from public.project_payment_templates template
        where template.subproject_id = (
          select subproject_id from public.assignments where id = v_assignment_id
        )
          and template.payment_key = 'review'
        limit 1;

        insert into public.assignment_payment_terms (
          assignment_id,
          template_id,
          payment_key,
          label,
          amount,
          currency,
          unit,
          is_assignment_rate,
          is_specified,
          is_manual_override,
          display_order
        )
        values (
          v_assignment_id,
          v_template_id,
          'review',
          'Review',
          nullif(trim(r->>'p_review_rate_amount'), '')::numeric,
          coalesce(nullif(trim(r->>'p_currency'), ''), 'USD'),
          'Approved Review',
          false,
          true,
          true,
          2
        )
        on conflict (assignment_id, payment_key) do update
        set
          template_id = excluded.template_id,
          label = excluded.label,
          amount = excluded.amount,
          currency = excluded.currency,
          unit = excluded.unit,
          is_assignment_rate = excluded.is_assignment_rate,
          is_specified = excluded.is_specified,
          is_manual_override = excluded.is_manual_override,
          display_order = excluded.display_order;
      end if;

      v_payment_amount := nullif(trim(r->>'p_payment_amount'), '')::numeric;
      v_payment_reference := nullif(trim(r->>'p_payment_reference'), '');

      if v_payment_amount is not null and v_payment_reference is not null then
        update public.payments
        set
          period_start = nullif(trim(r->>'p_period_start'), '')::date,
          period_end = nullif(trim(r->>'p_period_end'), '')::date,
          amount = v_payment_amount,
          currency = coalesce(nullif(trim(r->>'p_payment_currency'), ''), 'INR'),
          status = coalesce(nullif(trim(r->>'p_payment_status'), ''), 'pending'),
          paid_on = nullif(trim(r->>'p_paid_on'), '')::date
        where assignment_id = v_assignment_id
          and reference = v_payment_reference;

        if not found then
          insert into public.payments (
            assignment_id,
            period_start,
            period_end,
            amount,
            currency,
            status,
            paid_on,
            reference
          )
          values (
            v_assignment_id,
            nullif(trim(r->>'p_period_start'), '')::date,
            nullif(trim(r->>'p_period_end'), '')::date,
            v_payment_amount,
            coalesce(nullif(trim(r->>'p_payment_currency'), ''), 'INR'),
            coalesce(nullif(trim(r->>'p_payment_status'), ''), 'pending'),
            nullif(trim(r->>'p_paid_on'), '')::date,
            v_payment_reference
          );
        end if;
      end if;

      out_email := lower(trim(r->>'p_email'));
      out_status := 'ok';
      out_message := null;
      return next;
    exception when others then
      out_email := lower(trim(coalesce(r->>'p_email', '')));
      out_status := 'error';
      out_message := sqlerrm;
      return next;
    end;
  end loop;
end;
$$;

revoke all on function public.upsert_mojave_activity_batch(jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_mojave_activity_batch(jsonb)
  to service_role;

revoke all on function public.upsert_mojave_compensation_batch(jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_mojave_compensation_batch(jsonb)
  to service_role;
