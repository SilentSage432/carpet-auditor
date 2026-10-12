-- DEPTSYNC-OPERATIONAL-011 — Strict Operational Section ownership at write boundary.
-- Smallest safe replacement of upsert_sunday_bay_assignments_with_capacity:
-- preserve approved-capacity + advisory-lock safeguards; reject cross-section
-- and missing/ambiguous ownership. Does not mutate section/membership data.

begin;

create or replace function public.upsert_sunday_bay_assignments_with_capacity(
  p_store_number text,
  p_week_starting date,
  p_shared_target integer,
  p_quota_per_person integer,
  p_items jsonb,
  p_allow_over_base boolean default false,
  p_allow_over_shared boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store text := btrim(coalesce(p_store_number, ''));
  v_quota_ceiling integer := greatest(0, least(3, coalesce(p_quota_per_person, 3)));
  v_shared_caller integer := greatest(0, coalesce(p_shared_target, 0));
  v_allow_over_base boolean := coalesce(p_allow_over_base, false);
  v_allow_over_shared boolean := coalesce(p_allow_over_shared, false);
  v_item jsonb;
  v_department text;
  v_bay_id text;
  v_roster_id text;
  v_profile_id uuid;
  v_name text;
  v_status text;
  v_carried boolean;
  v_existing public.sunday_bay_assignments%rowtype;
  v_was_owned boolean;
  v_prev_roster text;
  v_person_count integer;
  v_total_count integer;
  v_person_quota integer;
  v_shared integer;
  v_fp text;
  v_live_fp text;
  v_written integer := 0;
  v_skipped integer := 0;
  v_role text;
  v_jwt_store text;
  v_store_id uuid;
  v_loc_department_id uuid;
  v_loc_aisle text;
  v_loc_bay integer;
  v_owner_count integer;
  v_section_owner text;
  v_section_id uuid;
begin
  if v_store = '' or p_week_starting is null then
    raise exception 'CAPACITY_INPUT: store_number and week_starting are required';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'CAPACITY_INPUT: p_items must be a JSON array';
  end if;

  begin
    v_role := coalesce(auth.role(), '');
  exception
    when others then
      v_role := '';
  end;

  if v_role = 'service_role' then
    null;
  elsif v_role = 'authenticated' then
    begin
      v_jwt_store := btrim(coalesce(auth.jwt() -> 'app_metadata' ->> 'store_number', ''));
    exception
      when others then
        v_jwt_store := '';
    end;
    if v_jwt_store = '' or v_jwt_store <> v_store then
      raise exception 'CAPACITY_STORE_FORBIDDEN: JWT store does not match writer store';
    end if;
    v_allow_over_base := false;
    v_allow_over_shared := false;
  else
    raise exception 'CAPACITY_STORE_FORBIDDEN: role % cannot write assignments', v_role;
  end if;

  select s.id into v_store_id
  from public.stores s
  where s.store_number = v_store
  limit 1;

  if v_store_id is null then
    raise exception 'CAPACITY_INPUT: unknown store_number %', v_store;
  end if;

  perform pg_advisory_xact_lock(
    hashtext('store_week_capacity:' || v_store || ':' || p_week_starting::text)
  );

  -- Shared ceiling = sum of non-stale approved capacities (authoritative).
  select coalesce(sum(a.approved_capacity), 0)::integer into v_shared
  from public.store_week_capacity_approvals a
  where a.store_number = v_store
    and a.week_starting = p_week_starting
    and a.schedule_fingerprint = public.associate_week_schedule_fingerprint(
      v_store, a.specialist_id, p_week_starting
    );

  -- Caller cannot inflate shared above approved sum; may pass lower for staged draws.
  if v_shared_caller < v_shared then
    v_shared := v_shared_caller;
  end if;

  for v_item in
    select value from jsonb_array_elements(p_items)
  loop
    v_department := lower(btrim(coalesce(v_item ->> 'department', '')));
    v_bay_id := btrim(coalesce(v_item ->> 'bay_id', ''));
    v_roster_id := btrim(coalesce(v_item ->> 'roster_specialist_id', ''));
    v_name := coalesce(v_item ->> 'specialist_name', '');
    v_status := lower(btrim(coalesce(v_item ->> 'status', 'assigned')));
    v_carried := coalesce((v_item ->> 'is_carried_over')::boolean, false);

    begin
      v_profile_id := nullif(btrim(coalesce(v_item ->> 'assigned_specialist_id', '')), '')::uuid;
    exception
      when others then
        v_profile_id := null;
    end;

    if v_department = '' or v_bay_id = '' then
      raise exception 'CAPACITY_INPUT: each item requires department and bay_id';
    end if;

    if v_status = 'cleared' or v_roster_id = '' then
      insert into public.sunday_bay_assignments (
        store_number,
        department,
        week_starting,
        bay_id,
        assigned_specialist_id,
        roster_specialist_id,
        specialist_name,
        status,
        is_carried_over,
        updated_at
      ) values (
        v_store,
        v_department,
        p_week_starting,
        v_bay_id,
        null,
        null,
        '',
        'cleared',
        false,
        now()
      )
      on conflict (store_number, department, week_starting, bay_id)
      do update set
        assigned_specialist_id = null,
        roster_specialist_id = null,
        specialist_name = '',
        status = 'cleared',
        is_carried_over = false,
        updated_at = now();
      v_written := v_written + 1;
      continue;
    end if;

    -- OPERATIONAL-011: resolve physical bay + enforce section ownership.
    begin
      select
        sl.department_id,
        regexp_replace(upper(trim(both from sl.aisle::text)), '\s+', ' ', 'g'),
        sl.bay
      into v_loc_department_id, v_loc_aisle, v_loc_bay
      from public.weekly_rotations wr
      join public.store_locations sl on sl.id = wr.location_id
      where wr.id = v_bay_id::uuid
      limit 1;
    exception
      when others then
        v_loc_department_id := null;
    end;

    if v_loc_department_id is null then
      raise exception
        'SECTION_OWNERSHIP_MISSING: bay_id % has no weekly_rotations/store_locations evidence',
        v_bay_id
        using errcode = 'P0001';
    end if;

    select
      count(*)::integer,
      min(os.primary_owner_specialist_id::text),
      (array_agg(os.id))[1]
    into v_owner_count, v_section_owner, v_section_id
    from public.operational_section_members osm
    join public.operational_sections os
      on os.id = osm.section_id
    where os.store_id = v_store_id
      and os.is_active = true
      and osm.department_id = v_loc_department_id
      and osm.aisle = v_loc_aisle
      and osm.bay = v_loc_bay;

    if v_owner_count = 0 then
      raise exception
        'SECTION_OWNERSHIP_MISSING: no active Operational Section membership for bay %',
        v_bay_id
        using errcode = 'P0001';
    end if;

    if v_owner_count > 1 then
      raise exception
        'SECTION_OWNERSHIP_AMBIGUOUS: overlapping Operational Section membership for bay %',
        v_bay_id
        using errcode = 'P0001';
    end if;

    if v_section_owner is null or btrim(v_section_owner) = '' then
      raise exception
        'SECTION_OWNERSHIP_MISSING: Operational Section % has no primary owner',
        v_section_id
        using errcode = 'P0001';
    end if;

    if btrim(v_section_owner) <> v_roster_id then
      raise exception
        'SECTION_OWNERSHIP_MISMATCH: associate % is not the owner of bay % (owner %)',
        v_roster_id, v_bay_id, v_section_owner
        using errcode = 'P0001';
    end if;

    select * into v_existing
    from public.sunday_bay_assignments s
    where s.store_number = v_store
      and s.department = v_department
      and s.week_starting = p_week_starting
      and s.bay_id = v_bay_id;

    v_was_owned := false;
    v_prev_roster := null;
    if found
       and coalesce(v_existing.status, '') <> 'cleared'
       and btrim(coalesce(v_existing.roster_specialist_id, '')) <> '' then
      v_was_owned := true;
      v_prev_roster := btrim(v_existing.roster_specialist_id);
    end if;

    if v_was_owned and v_prev_roster = v_roster_id then
      insert into public.sunday_bay_assignments (
        store_number,
        department,
        week_starting,
        bay_id,
        assigned_specialist_id,
        roster_specialist_id,
        specialist_name,
        status,
        is_carried_over,
        updated_at
      ) values (
        v_store,
        v_department,
        p_week_starting,
        v_bay_id,
        v_profile_id,
        v_roster_id,
        v_name,
        case
          when v_status in ('pending', 'assigned', 'completed', 'cleared') then v_status
          else 'assigned'
        end,
        v_carried,
        now()
      )
      on conflict (store_number, department, week_starting, bay_id)
      do update set
        assigned_specialist_id = excluded.assigned_specialist_id,
        roster_specialist_id = excluded.roster_specialist_id,
        specialist_name = excluded.specialist_name,
        status = excluded.status,
        is_carried_over = excluded.is_carried_over,
        updated_at = now();
      v_written := v_written + 1;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Resolve approved capacity for this associate (fail closed).
    select a.approved_capacity, a.schedule_fingerprint
      into v_person_quota, v_fp
    from public.store_week_capacity_approvals a
    where a.store_number = v_store
      and a.week_starting = p_week_starting
      and a.specialist_id = v_roster_id;

    if not found then
      raise exception
        'CAPACITY_APPROVAL_MISSING: no approved weekly capacity for associate %',
        v_roster_id
        using errcode = 'P0001';
    end if;

    v_live_fp := public.associate_week_schedule_fingerprint(
      v_store, v_roster_id, p_week_starting
    );
    if v_live_fp is distinct from v_fp then
      raise exception
        'CAPACITY_APPROVAL_STALE: approved capacity for % is stale — re-approve after schedule refresh',
        v_roster_id
        using errcode = 'P0001';
    end if;

    if v_person_quota is null or v_person_quota < 0 then
      raise exception 'CAPACITY_APPROVAL_MISSING: invalid approval for %', v_roster_id;
    end if;

    -- Hard ceiling: approved never above 3; allow_over cannot exceed approved.
    v_person_quota := least(v_person_quota, v_quota_ceiling, 3);

    if v_person_quota <= 0 then
      raise exception
        'CAPACITY_APPROVAL_ZERO: associate % has approved capacity 0',
        v_roster_id
        using errcode = 'P0001';
    end if;

    select count(*)::integer into v_person_count
    from public.sunday_bay_assignments s
    where s.store_number = v_store
      and s.week_starting = p_week_starting
      and coalesce(s.status, '') <> 'cleared'
      and btrim(coalesce(s.roster_specialist_id, '')) = v_roster_id
      and s.bay_id is distinct from v_bay_id;

    if not v_allow_over_base and v_person_count >= v_person_quota then
      raise exception
        'CAPACITY_PERSON_EXCEEDED: associate % already has % of % approved assignments',
        v_roster_id, v_person_count, v_person_quota
        using errcode = 'P0001';
    end if;

    -- Even service_role +1 cannot exceed approved individual capacity.
    if v_allow_over_base and v_person_count >= v_person_quota then
      raise exception
        'CAPACITY_PERSON_EXCEEDED: associate % already at approved capacity %',
        v_roster_id, v_person_quota
        using errcode = 'P0001';
    end if;

    if not v_was_owned then
      select count(*)::integer into v_total_count
      from public.sunday_bay_assignments s
      where s.store_number = v_store
        and s.week_starting = p_week_starting
        and coalesce(s.status, '') <> 'cleared'
        and btrim(coalesce(s.roster_specialist_id, '')) <> ''
        and s.bay_id is distinct from v_bay_id;

      if not v_allow_over_shared and v_total_count >= v_shared then
        raise exception
          'CAPACITY_SHARED_EXCEEDED: store-week already has % of % approved shared assignments',
          v_total_count, v_shared
          using errcode = 'P0001';
      end if;

      if v_allow_over_shared and v_total_count >= v_shared then
        raise exception
          'CAPACITY_SHARED_EXCEEDED: store-week already at approved shared capacity %',
          v_shared
          using errcode = 'P0001';
      end if;
    end if;

    insert into public.sunday_bay_assignments (
      store_number,
      department,
      week_starting,
      bay_id,
      assigned_specialist_id,
      roster_specialist_id,
      specialist_name,
      status,
      is_carried_over,
      updated_at
    ) values (
      v_store,
      v_department,
      p_week_starting,
      v_bay_id,
      v_profile_id,
      v_roster_id,
      v_name,
      case
        when v_status in ('pending', 'assigned', 'completed', 'cleared') then v_status
        else 'assigned'
      end,
      v_carried,
      now()
    )
    on conflict (store_number, department, week_starting, bay_id)
    do update set
      assigned_specialist_id = excluded.assigned_specialist_id,
      roster_specialist_id = excluded.roster_specialist_id,
      specialist_name = excluded.specialist_name,
      status = excluded.status,
      is_carried_over = excluded.is_carried_over,
      updated_at = now();

    v_written := v_written + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'written', v_written,
    'idempotent_same_owner', v_skipped,
    'store_number', v_store,
    'week_starting', p_week_starting,
    'shared_target', v_shared,
    'quota_per_person_ceiling', v_quota_ceiling,
    'allow_over_base', v_allow_over_base,
    'allow_over_shared', v_allow_over_shared,
    'caller_role', v_role,
    'approved_capacity_enforced', true,
    'section_ownership_enforced', true
  );
end;
$$;

comment on function public.upsert_sunday_bay_assignments_with_capacity(
  text, date, integer, integer, jsonb, boolean, boolean
) is
  'CAPACITY-GUARD-002/003 + SECTION-ROTATION-005 + OPERATIONAL-011: advisory-locked upsert enforcing approved capacity and Operational Section ownership.';

revoke all on function public.upsert_sunday_bay_assignments_with_capacity(
  text, date, integer, integer, jsonb, boolean, boolean
) from public, anon;

grant execute on function public.upsert_sunday_bay_assignments_with_capacity(
  text, date, integer, integer, jsonb, boolean, boolean
) to authenticated, service_role;

commit;
