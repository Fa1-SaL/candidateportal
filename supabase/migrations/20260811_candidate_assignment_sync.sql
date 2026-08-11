-- A single ingestion contract for candidate sources. Source rows must identify
-- the active Snorkel client, vertical, and project rather than relying on a
-- globally ambiguous project slug.
create or replace function public.upsert_candidate_assignments_batch(p_rows jsonb)
returns table(out_email text, out_status text, out_message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_candidate_id uuid;
  v_subproject_id uuid;
  v_email text;
  v_client_name text;
  v_vertical_name text;
  v_project_name text;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    begin
      v_email := lower(trim(coalesce(r->>'p_email', '')));
      v_client_name := coalesce(nullif(trim(r->>'p_client'), ''), 'Snorkel');
      v_vertical_name := nullif(trim(r->>'p_vertical'), '');
      v_project_name := nullif(trim(r->>'p_project'), '');

      if v_email = '' then
        raise exception 'email is required';
      end if;

      if v_vertical_name is null or v_project_name is null then
        raise exception 'vertical and project are required';
      end if;

      select sp.id
      into v_subproject_id
      from public.subprojects sp
      join public.verticals v on v.id = sp.vertical_id
      join public.clients c on c.id = v.client_id
      where sp.active
        and lower(c.display_name) = lower(v_client_name)
        and lower(v.display_name) = lower(v_vertical_name)
        and (
          lower(sp.display_name) = lower(v_project_name)
          or lower(sp.slug) = lower(v_project_name)
        )
      order by sp.id
      limit 1;

      if v_subproject_id is null then
        raise exception 'unknown active project "%.%.%"', v_client_name, v_vertical_name, v_project_name;
      end if;

      insert into public.candidates (source_uid, email, full_name, phone)
      values (
        gen_random_uuid(),
        v_email,
        nullif(trim(r->>'p_full_name'), ''),
        nullif(trim(r->>'p_phone'), '')
      )
      on conflict (email) do update
      set
        full_name = coalesce(nullif(excluded.full_name, ''), public.candidates.full_name),
        phone = coalesce(nullif(excluded.phone, ''), public.candidates.phone),
        updated_at = now()
      returning id into v_candidate_id;

      if nullif(trim(r->>'p_bgv_id_status'), '') is not null
        or nullif(trim(r->>'p_bgv_address_status'), '') is not null then
        insert into public.background_verification (candidate_id, id_status, address_status)
        values (
          v_candidate_id,
          nullif(trim(r->>'p_bgv_id_status'), ''),
          nullif(trim(r->>'p_bgv_address_status'), '')
        )
        on conflict (candidate_id) do update
        set
          id_status = coalesce(excluded.id_status, public.background_verification.id_status),
          address_status = coalesce(excluded.address_status, public.background_verification.address_status),
          updated_at = now();
      end if;

      insert into public.assignments (
        source_uid,
        candidate_id,
        subproject_id,
        domain,
        track,
        remofirst_status,
        pd_form_status,
        contract_status,
        credentials_status,
        training_status,
        platform_access_status,
        rate_amount,
        rate_currency,
        rate_unit,
        task_notes_raw,
        remarks_raw,
        is_offboarded_heuristic,
        offboard_evidence,
        source_sheet,
        source_row,
        last_seen_at
      )
      values (
        gen_random_uuid(),
        v_candidate_id,
        v_subproject_id,
        nullif(trim(r->>'p_domain'), ''),
        nullif(trim(r->>'p_track'), ''),
        nullif(trim(r->>'p_remofirst_status'), ''),
        nullif(trim(r->>'p_pd_form_status'), ''),
        nullif(trim(r->>'p_contract_status'), ''),
        nullif(trim(r->>'p_credentials_status'), ''),
        nullif(trim(r->>'p_training_status'), ''),
        nullif(trim(r->>'p_platform_access_status'), ''),
        nullif(trim(r->>'p_rate_amount'), '')::numeric,
        nullif(trim(r->>'p_rate_currency'), ''),
        nullif(trim(r->>'p_rate_unit'), ''),
        nullif(trim(r->>'p_task_notes_raw'), ''),
        nullif(trim(r->>'p_remarks_raw'), ''),
        coalesce(nullif(trim(r->>'p_is_offboarded_heuristic'), '')::boolean, false),
        nullif(trim(r->>'p_offboard_evidence'), ''),
        nullif(trim(r->>'p_source_sheet'), ''),
        nullif(trim(r->>'p_source_row'), '')::integer,
        now()
      )
      on conflict (candidate_id, subproject_id) do update
      set
        domain = coalesce(excluded.domain, public.assignments.domain),
        track = coalesce(excluded.track, public.assignments.track),
        remofirst_status = coalesce(excluded.remofirst_status, public.assignments.remofirst_status),
        pd_form_status = coalesce(excluded.pd_form_status, public.assignments.pd_form_status),
        contract_status = coalesce(excluded.contract_status, public.assignments.contract_status),
        credentials_status = coalesce(excluded.credentials_status, public.assignments.credentials_status),
        training_status = coalesce(excluded.training_status, public.assignments.training_status),
        platform_access_status = coalesce(excluded.platform_access_status, public.assignments.platform_access_status),
        rate_amount = coalesce(excluded.rate_amount, public.assignments.rate_amount),
        rate_currency = coalesce(excluded.rate_currency, public.assignments.rate_currency),
        rate_unit = coalesce(excluded.rate_unit, public.assignments.rate_unit),
        task_notes_raw = coalesce(excluded.task_notes_raw, public.assignments.task_notes_raw),
        remarks_raw = coalesce(excluded.remarks_raw, public.assignments.remarks_raw),
        is_offboarded_heuristic = excluded.is_offboarded_heuristic,
        offboard_evidence = coalesce(excluded.offboard_evidence, public.assignments.offboard_evidence),
        source_sheet = coalesce(excluded.source_sheet, public.assignments.source_sheet),
        source_row = coalesce(excluded.source_row, public.assignments.source_row),
        last_seen_at = now(),
        updated_at = now();

      out_email := v_email;
      out_status := 'ok';
      out_message := null;
      return next;
    exception when others then
      out_email := coalesce(v_email, r->>'p_email');
      out_status := 'error';
      out_message := sqlerrm;
      return next;
    end;
  end loop;
end;
$$;

revoke all on function public.upsert_candidate_assignments_batch(jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_candidate_assignments_batch(jsonb)
  to service_role;

-- Preserve the existing STEM n8n contract while resolving its project within
-- the active Snorkel/STEM catalog. This prevents a legacy inactive project
-- with the same slug from receiving a live source update.
create or replace function public.upsert_stem_assignment_batch(p_rows jsonb)
returns table(out_email text, out_status text, out_message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  select coalesce(
    jsonb_agg(
      source.item || jsonb_build_object(
        'p_client', 'Snorkel',
        'p_vertical', 'STEM',
        'p_project', source.item->>'p_project_slug'
      )
    ),
    '[]'::jsonb
  )
  into v_rows
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as source(item);

  return query
  select *
  from public.upsert_candidate_assignments_batch(v_rows);
end;
$$;
