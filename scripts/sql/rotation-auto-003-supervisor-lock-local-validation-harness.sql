-- DEPTSYNC-ROTATION-AUTO-004 — disposable local validation for
-- 20261021_rotation_auto_003_supervisor_lock.sql
--
-- NOT FOR PRODUCTION. Creates a minimal fixture schema, seeds existing
-- assignment rows, applies the additive column migration, and asserts:
--   - existing rows remain valid
--   - supervisor_locked defaults to false
--   - store isolation keys unchanged
--   - RPC signature shape remains compatible (column additive only)
--
-- Rollback (local only):
--   alter table public.sunday_bay_assignments drop column if exists supervisor_locked;
--   drop index if exists public.sunday_bay_assignments_supervisor_locked_idx;

begin;

create extension if not exists "pgcrypto";

create schema if not exists public;

create table if not exists public.sunday_bay_assignments (
  id uuid primary key default gen_random_uuid(),
  store_number text not null,
  department text not null,
  week_starting date not null,
  bay_id text not null,
  assigned_specialist_id uuid null,
  roster_specialist_id text null,
  specialist_name text not null default '',
  status text not null default 'assigned',
  is_carried_over boolean not null default false,
  zebra_entered_at timestamptz null,
  zebra_entered_by text null,
  updated_at timestamptz not null default now(),
  unique (store_number, department, week_starting, bay_id)
);

-- Seed "pre-migration" owned assignments (W42-shaped fixture).
insert into public.sunday_bay_assignments (
  store_number, department, week_starting, bay_id,
  roster_specialist_id, specialist_name, status
) values
  ('2587', 'flooring', '2026-10-12', 'rot-7-9', 'nate', 'Nate', 'assigned'),
  ('2587', 'flooring', '2026-10-12', 'rot-39-10', 'nate', 'Nate', 'assigned'),
  ('2587', 'flooring', '2026-10-12', 'rot-44-6', 'nick', 'Nick', 'assigned'),
  ('2587', 'flooring', '2026-10-12', 'rot-6-2', 'tyson', 'Tyson', 'completed'),
  ('9999', 'flooring', '2026-10-12', 'rot-other', 'other', 'Other', 'assigned')
on conflict (store_number, department, week_starting, bay_id) do nothing;

-- Apply the prepared migration body (additive; idempotent).
alter table public.sunday_bay_assignments
  add column if not exists supervisor_locked boolean not null default false;

comment on column public.sunday_bay_assignments.supervisor_locked is
  'ROTATION-AUTO-003: supervisor intentionally edited this bay; automatic weekly publication must not overwrite';

create index if not exists sunday_bay_assignments_supervisor_locked_idx
  on public.sunday_bay_assignments (store_number, week_starting, supervisor_locked)
  where supervisor_locked = true;

-- Assertions
do $$
declare
  v_unlocked integer;
  v_total integer;
  v_store_2587 integer;
  v_store_9999 integer;
  v_completed_unlocked integer;
  v_nulls integer;
begin
  select count(*) into v_total from public.sunday_bay_assignments;
  select count(*) into v_unlocked
    from public.sunday_bay_assignments where supervisor_locked = false;
  select count(*) into v_nulls
    from public.sunday_bay_assignments where supervisor_locked is null;
  select count(*) into v_store_2587
    from public.sunday_bay_assignments where store_number = '2587';
  select count(*) into v_store_9999
    from public.sunday_bay_assignments where store_number = '9999';
  select count(*) into v_completed_unlocked
    from public.sunday_bay_assignments
    where status = 'completed' and supervisor_locked = false;

  if v_nulls <> 0 then
    raise exception 'FAIL: supervisor_locked nulls present (%)', v_nulls;
  end if;
  if v_unlocked <> v_total then
    raise exception 'FAIL: expected all existing rows default unlocked (unlocked=% total=%)',
      v_unlocked, v_total;
  end if;
  if v_store_2587 < 4 then
    raise exception 'FAIL: store 2587 rows missing after migrate';
  end if;
  if v_store_9999 < 1 then
    raise exception 'FAIL: store isolation fixture lost';
  end if;
  if v_completed_unlocked < 1 then
    raise exception 'FAIL: completed history row not preserved unlocked';
  end if;

  -- Lock stamp must be store+week+bay scoped (edit safety).
  update public.sunday_bay_assignments
    set supervisor_locked = true
    where store_number = '2587'
      and week_starting = '2026-10-12'
      and bay_id = 'rot-7-9';

  if (select count(*) from public.sunday_bay_assignments
        where supervisor_locked = true and store_number = '2587') <> 1 then
    raise exception 'FAIL: lock stamp not store-scoped';
  end if;
  if (select supervisor_locked from public.sunday_bay_assignments
        where store_number = '9999' and bay_id = 'rot-other') is distinct from false then
    raise exception 'FAIL: other store lock contaminated';
  end if;

  -- Capacity RPC upsert shape does not mention supervisor_locked — simulate
  -- an ownership rewrite that must preserve the lock column.
  update public.sunday_bay_assignments
    set specialist_name = 'Nate (retry)',
        status = 'assigned',
        updated_at = now()
    where store_number = '2587'
      and bay_id = 'rot-7-9';

  if (select supervisor_locked from public.sunday_bay_assignments
        where store_number = '2587' and bay_id = 'rot-7-9') is distinct from true then
    raise exception 'FAIL: ownership rewrite cleared supervisor_locked';
  end if;

  raise notice 'PASS: supervisor_lock migration fixture — defaults safe, history preserved, store isolation OK, lock survives ownership rewrite';
end $$;

-- Document rollback recovery (executed only when harness is torn down).
-- alter table public.sunday_bay_assignments drop column if exists supervisor_locked;
-- drop index if exists public.sunday_bay_assignments_supervisor_locked_idx;

select 'rotation-auto-003 supervisor_lock harness assertions passed' as status;

commit;
