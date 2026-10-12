-- DEPTSYNC-SECTION-ROTATION-005 — Operator-approved weekly bay capacity
--
-- Additive: durable store/week/associate capacity approvals + fingerprint.
-- Replaces upsert_sunday_bay_assignments_with_capacity to enforce:
--   * per-person approved capacity (0–3)
--   * shared target = sum of valid (non-stale) approvals
--   * missing / stale approval fail-closed
--   * advisory lock preserved (CAPACITY-GUARD-002/003)
--
-- LOCAL / REVIEW ONLY in this tranche — do NOT apply to production here.
-- Does NOT activate Sunday auto-stage or dual-department staging.
-- Does NOT mutate Operational Sections.

begin;

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. Durable approvals
-- ---------------------------------------------------------------------------

create table if not exists public.store_week_capacity_approvals (
  id uuid primary key default gen_random_uuid(),
  store_number text not null,
  week_label text not null,
  week_starting date not null,
  specialist_id text not null,
  approved_capacity integer not null
    check (approved_capacity >= 0 and approved_capacity <= 3),
  schedule_fingerprint text not null,
  approved_by_specialist_id text not null,
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_week_capacity_approvals_week_label_check
    check (week_label ~ '^[0-9]{4}-W[0-9]{2}$'),
  constraint store_week_capacity_approvals_fingerprint_nonempty_check
    check (char_length(trim(schedule_fingerprint)) > 0),
  constraint store_week_capacity_approvals_unique_person_week
    unique (store_number, week_label, specialist_id)
);

comment on table public.store_week_capacity_approvals is
  'SECTION-ROTATION-005: operator-approved weekly bay capacity (0–3) per roster associate. Not section stewardship.';

comment on column public.store_week_capacity_approvals.schedule_fingerprint is
  'Hash of that associate''s associate_shift_days rows for the ISO week; stale on schedule change.';

comment on column public.store_week_capacity_approvals.approved_by_specialist_id is
  'Roster id of MasterAdmin (or authorized actor) who confirmed capacity — not client role text.';

create index if not exists store_week_capacity_approvals_store_week_idx
  on public.store_week_capacity_approvals (store_number, week_starting);

create index if not exists store_week_capacity_approvals_specialist_idx
  on public.store_week_capacity_approvals (specialist_id);

alter table public.store_week_capacity_approvals enable row level security;

revoke all on table public.store_week_capacity_approvals from public, anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.store_week_capacity_approvals from authenticated;
grant select on table public.store_week_capacity_approvals to authenticated;

drop policy if exists "Authenticated read week capacity approvals"
  on public.store_week_capacity_approvals;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise notice 'store_week_capacity_approvals: skipping RLS (authenticated absent)';
    return;
  end if;

  if to_regprocedure('public.jwt_matches_store(text)') is null then
    raise notice 'store_week_capacity_approvals: jwt_matches_store missing — authenticated SELECT denied';
    execute $policy$
      create policy "Authenticated read week capacity approvals"
        on public.store_week_capacity_approvals
        for select
        to authenticated
        using (false)
    $policy$;
  else
    execute $policy$
      create policy "Authenticated read week capacity approvals"
        on public.store_week_capacity_approvals
        for select
        to authenticated
        using (public.jwt_matches_store(store_week_capacity_approvals.store_number))
    $policy$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Schedule fingerprint (per associate / week)
-- ---------------------------------------------------------------------------

create or replace function public.associate_week_schedule_fingerprint(
  p_store_number text,
  p_specialist_id text,
  p_week_starting date
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    md5(
      string_agg(
        concat_ws(
          '|',
          work_date::text,
          coalesce(status, ''),
          case when is_scheduled_today then '1' else '0' end,
          case when is_call_out then '1' else '0' end,
          coalesce(start_time, ''),
          coalesce(end_time, '')
        ),
        ';'
        order by work_date
      )
    ),
    md5('empty:' || btrim(coalesce(p_specialist_id, '')))
  )
  from public.associate_shift_days
  where store_number = btrim(coalesce(p_store_number, ''))
    and specialist_id = btrim(coalesce(p_specialist_id, ''))
    and work_date >= p_week_starting
    and work_date < (p_week_starting + 7);
$$;

revoke all on function public.associate_week_schedule_fingerprint(text, text, date)
  from public, anon;
grant execute on function public.associate_week_schedule_fingerprint(text, text, date)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Approval writer (same store-week advisory lock as assignments)
-- ---------------------------------------------------------------------------

create or replace function public.upsert_store_week_capacity_approvals(
  p_store_number text,
  p_week_label text,
  p_week_starting date,
  p_approved_by_specialist_id text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store text := btrim(coalesce(p_store_number, ''));
  v_week text := btrim(coalesce(p_week_label, ''));
  v_by text := btrim(coalesce(p_approved_by_specialist_id, ''));
  v_item jsonb;
  v_sid text;
  v_cap integer;
  v_fp text;
  v_live_fp text;
  v_owned integer;
  v_written integer := 0;
  v_role text;
  v_jwt_store text;
begin
  if v_store = '' or v_week = '' or p_week_starting is null or v_by = '' then
    raise exception 'CAPACITY_APPROVAL_INPUT: store, week, week_starting, approved_by required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'CAPACITY_APPROVAL_INPUT: p_items must be a JSON array';
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
      raise exception 'CAPACITY_STORE_FORBIDDEN: JWT store does not match approval store';
    end if;
  else
    raise exception 'CAPACITY_STORE_FORBIDDEN: role % cannot approve capacity', v_role;
  end if;

  perform pg_advisory_xact_lock(
    hashtext('store_week_capacity:' || v_store || ':' || p_week_starting::text)
  );

  for v_item in
    select value from jsonb_array_elements(p_items)
  loop
    v_sid := btrim(coalesce(v_item ->> 'specialist_id', ''));
    begin
      v_cap := (v_item ->> 'approved_capacity')::integer;
    exception
      when others then
        raise exception 'CAPACITY_APPROVAL_INPUT: approved_capacity must be integer 0–3';
    end;
    v_fp := btrim(coalesce(v_item ->> 'schedule_fingerprint', ''));

    if v_sid = '' or v_fp = '' then
      raise exception 'CAPACITY_APPROVAL_INPUT: specialist_id and schedule_fingerprint required';
    end if;
    if v_cap is null or v_cap < 0 or v_cap > 3 then
      raise exception 'CAPACITY_APPROVAL_RANGE: capacity must be 0–3 (got %)', v_cap;
    end if;

    v_live_fp := public.associate_week_schedule_fingerprint(v_store, v_sid, p_week_starting);
    if v_live_fp is distinct from v_fp then
      raise exception
        'CAPACITY_APPROVAL_STALE: schedule changed for associate % — refresh and re-approve',
        v_sid
        using errcode = 'P0001';
    end if;

    select count(*)::integer into v_owned
    from public.sunday_bay_assignments s
    where s.store_number = v_store
      and s.week_starting = p_week_starting
      and coalesce(s.status, '') <> 'cleared'
      and btrim(coalesce(s.roster_specialist_id, '')) = v_sid;

    if v_cap < coalesce(v_owned, 0) then
      raise exception
        'CAPACITY_APPROVAL_BELOW_OWNED: associate % has % committed assignments; cannot approve %',
        v_sid, v_owned, v_cap
        using errcode = 'P0001';
    end if;

    insert into public.store_week_capacity_approvals (
      store_number,
      week_label,
      week_starting,
      specialist_id,
      approved_capacity,
      schedule_fingerprint,
      approved_by_specialist_id,
      approved_at,
      updated_at
    ) values (
      v_store,
      v_week,
      p_week_starting,
      v_sid,
      v_cap,
      v_fp,
      v_by,
      now(),
      now()
    )
    on conflict (store_number, week_label, specialist_id)
    do update set
      approved_capacity = excluded.approved_capacity,
      schedule_fingerprint = excluded.schedule_fingerprint,
      approved_by_specialist_id = excluded.approved_by_specialist_id,
      approved_at = now(),
      week_starting = excluded.week_starting,
      updated_at = now();

    v_written := v_written + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'written', v_written,
    'store_number', v_store,
    'week_label', v_week,
    'week_starting', p_week_starting
  );
end;
$$;

comment on function public.upsert_store_week_capacity_approvals(text, text, date, text, jsonb) is
  'SECTION-ROTATION-005: advisory-locked capacity approval upsert with fingerprint + owned-floor checks.';

revoke all on function public.upsert_store_week_capacity_approvals(text, text, date, text, jsonb)
  from public, anon;
grant execute on function public.upsert_store_week_capacity_approvals(text, text, date, text, jsonb)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Assignment writer — approved individual + shared = sum(valid approvals)
-- ---------------------------------------------------------------------------

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
    'approved_capacity_enforced', true
  );
end;
$$;

comment on function public.upsert_sunday_bay_assignments_with_capacity(
  text, date, integer, integer, jsonb, boolean, boolean
) is
  'CAPACITY-GUARD-002/003 + SECTION-ROTATION-005: advisory-locked upsert enforcing approved weekly capacities.';

revoke all on function public.upsert_sunday_bay_assignments_with_capacity(
  text, date, integer, integer, jsonb, boolean, boolean
) from public, anon;

grant execute on function public.upsert_sunday_bay_assignments_with_capacity(
  text, date, integer, integer, jsonb, boolean, boolean
) to authenticated, service_role;

-- Keep direct table mutation closed (CAPACITY-GUARD-003).
revoke insert, update, delete, truncate, references, trigger
  on table public.sunday_bay_assignments
  from anon, authenticated;
revoke select on table public.sunday_bay_assignments from anon;
grant select on table public.sunday_bay_assignments to authenticated;

commit;
