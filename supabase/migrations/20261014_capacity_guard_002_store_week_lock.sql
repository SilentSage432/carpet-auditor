-- DEPTSYNC-CAPACITY-GUARD-002 / 003
-- Atomic store-week capacity-gated sunday_bay_assignments writer.
--
-- WHY: PostgREST auto-commits each statement. Application check-then-upsert
-- across concurrent Vercel invocations cannot hold a lock. Capacity validation
-- and upsert must share one PostgreSQL transaction with pg_advisory_xact_lock.
--
-- AUTHORIZATION (CAPACITY-GUARD-003 harden):
--   * service_role — full writer; may pass allow_over_* for explicit +1 API
--   * authenticated — JWT store must match; allow_over_* forced false
--   * anon / other — rejected
--   * Direct INSERT/UPDATE/DELETE revoked from anon/authenticated
--     (writes must use this SECURITY DEFINER RPC; SELECT + RLS remain)
--
-- HARD PREREQUISITE before deploying app writers that fail-closed on this RPC.
-- Does NOT mutate roster, topology, rotations, or existing assignment rows.
-- Does NOT activate dual-department auto-stage.

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
  v_quota integer := greatest(0, coalesce(p_quota_per_person, 3));
  v_shared integer := greatest(0, coalesce(p_shared_target, 0));
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
  v_written integer := 0;
  v_skipped integer := 0;
  v_role text;
  v_jwt_store text;
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
    -- Cron / Next.js service-role writers. Overrides honored when explicitly set.
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
    -- Browser / JWT callers cannot elevate past base shared capacity via flags.
    v_allow_over_base := false;
    v_allow_over_shared := false;
  else
    raise exception 'CAPACITY_STORE_FORBIDDEN: role % cannot write assignments', v_role;
  end if;

  perform pg_advisory_xact_lock(
    hashtext('store_week_capacity:' || v_store || ':' || p_week_starting::text)
  );

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

    -- Clear path: always allowed (frees capacity).
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

    -- Idempotent same-owner rewrite: no capacity change.
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

    -- Person count across ALL departments for this store-week (exclude this bay).
    select count(*)::integer into v_person_count
    from public.sunday_bay_assignments s
    where s.store_number = v_store
      and s.week_starting = p_week_starting
      and coalesce(s.status, '') <> 'cleared'
      and btrim(coalesce(s.roster_specialist_id, '')) = v_roster_id
      and s.bay_id is distinct from v_bay_id;

    if not v_allow_over_base and v_person_count >= v_quota then
      raise exception
        'CAPACITY_PERSON_EXCEEDED: associate % already has % of % base assignments',
        v_roster_id, v_person_count, v_quota
        using errcode = 'P0001';
    end if;

    -- Shared store-week total: new ownership only (reassignment keeps total).
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
          'CAPACITY_SHARED_EXCEEDED: store-week already has % of % shared assignments',
          v_total_count, v_shared
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
    'quota_per_person', v_quota,
    'allow_over_base', v_allow_over_base,
    'allow_over_shared', v_allow_over_shared,
    'caller_role', v_role
  );
end;
$$;

comment on function public.upsert_sunday_bay_assignments_with_capacity(
  text, date, integer, integer, jsonb, boolean, boolean
) is
  'CAPACITY-GUARD-002/003: advisory-locked store-week capacity upsert. Overrides service_role only.';

revoke all on function public.upsert_sunday_bay_assignments_with_capacity(
  text, date, integer, integer, jsonb, boolean, boolean
) from public, anon;

grant execute on function public.upsert_sunday_bay_assignments_with_capacity(
  text, date, integer, integer, jsonb, boolean, boolean
) to authenticated, service_role;

-- Close direct table mutation bypass for client roles. SECURITY DEFINER RPC
-- and service_role retain write authority. Authenticated SELECT + RLS remain.
revoke insert, update, delete, truncate, references, trigger
  on table public.sunday_bay_assignments
  from anon, authenticated;
revoke select on table public.sunday_bay_assignments from anon;
grant select on table public.sunday_bay_assignments to authenticated;

commit;
