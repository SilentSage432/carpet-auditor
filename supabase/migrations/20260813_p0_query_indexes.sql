-- P0 query indexes for mobile cold-start / high-frequency list paths.
-- Safe to re-run. Does not change RLS or table ownership.
--
-- Column map (schema.sql + migrations — do not assume store_number everywhere):
--   carpet_audits     store_number, created_at
--                     Original CREATE has no store column; schema.sql ALTER adds
--                     store_number. There is no store_id on this table.
--   carpet_remnants   store_number, updated_at
--                     Same: no store_id.
--   store_locations   store_id, department_id, aisle, bay
--                     (20260809_multi_store.sql). JWT RLS may also add store_number;
--                     Store Map GET filters on store_id.
--   weekly_rotations  store_id, assigned_week, department_id
--                     (20260809_multi_store.sql). Original CREATE has department_id only.
--   manager_notes     Phase 2 (20260812_manager_notes.sql):
--                       store_number, is_archived, department, created_at
--                     Legacy (20260811_manager_notes.sql):
--                       store_id, department_code, created_at
--                     App list path: store_number + is_archived + department.

-- ---------------------------------------------------------------------------
-- Helper: CREATE INDEX only when the table and every named column exist.
-- Dropped at the end of this script (also dropped first so re-runs are clean).
-- ---------------------------------------------------------------------------
drop function if exists public._p0_index_if_columns(text, text, text, text[], text);

create function public._p0_index_if_columns(
  p_index_name text,
  p_schema text,
  p_table text,
  p_columns text[],
  p_index_sql text
)
returns void
language plpgsql
as $$
declare
  rel regclass;
  missing text;
begin
  rel := to_regclass(format('%I.%I', p_schema, p_table));
  if rel is null then
    raise notice 'P0 skip % — table %.% does not exist',
      p_index_name, p_schema, p_table;
    return;
  end if;

  select c.col
  into missing
  from unnest(p_columns) as c(col)
  where not exists (
    select 1
    from pg_attribute a
    where a.attrelid = rel
      and a.attnum > 0
      and not a.attisdropped
      and a.attname = c.col
  )
  limit 1;

  if missing is not null then
    raise notice 'P0 skip % — column %.%.% does not exist',
      p_index_name, p_schema, p_table, missing;
    return;
  end if;

  execute p_index_sql;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. carpet_audits — hub cycle log (.eq store_number, order created_at desc)
-- Live DBs created from the original CREATE TABLE lack store_number (42703).
-- Do not invent a store_id — this table never had one. Do not backfill a
-- guessed store number; existing rows stay NULL until the hub writes them.
-- ---------------------------------------------------------------------------
alter table public.carpet_audits
  add column if not exists store_number text;

select public._p0_index_if_columns(
  'carpet_audits_store_created_at_idx',
  'public',
  'carpet_audits',
  array['store_number', 'created_at'],
  $sql$
    create index if not exists carpet_audits_store_created_at_idx
      on public.carpet_audits (store_number, created_at desc)
  $sql$
);

-- ---------------------------------------------------------------------------
-- 2. carpet_remnants — remnant rack (.eq store_number, order updated_at desc)
-- ---------------------------------------------------------------------------
alter table public.carpet_remnants
  add column if not exists store_number text;

select public._p0_index_if_columns(
  'carpet_remnants_store_updated_at_idx',
  'public',
  'carpet_remnants',
  array['store_number', 'updated_at'],
  $sql$
    create index if not exists carpet_remnants_store_updated_at_idx
      on public.carpet_remnants (store_number, updated_at desc)
  $sql$
);

-- ---------------------------------------------------------------------------
-- 3. store_locations — Store Map GET (.eq store_id, order aisle/bay)
-- Prefer store_id (canonical UUID). Also index store_number when JWT RLS
-- added it and multi_store was never applied.
-- ---------------------------------------------------------------------------
select public._p0_index_if_columns(
  'store_locations_store_aisle_bay_idx',
  'public',
  'store_locations',
  array['store_id', 'aisle', 'bay'],
  $sql$
    create index if not exists store_locations_store_aisle_bay_idx
      on public.store_locations (store_id, aisle, bay)
  $sql$
);

select public._p0_index_if_columns(
  'store_locations_store_dept_aisle_bay_idx',
  'public',
  'store_locations',
  array['store_id', 'department_id', 'aisle', 'bay'],
  $sql$
    create index if not exists store_locations_store_dept_aisle_bay_idx
      on public.store_locations (store_id, department_id, aisle, bay)
  $sql$
);

select public._p0_index_if_columns(
  'store_locations_store_number_aisle_bay_idx',
  'public',
  'store_locations',
  array['store_number', 'aisle', 'bay'],
  $sql$
    create index if not exists store_locations_store_number_aisle_bay_idx
      on public.store_locations (store_number, aisle, bay)
  $sql$
);

-- ---------------------------------------------------------------------------
-- 4. weekly_rotations — this-week checklist
-- ---------------------------------------------------------------------------
select public._p0_index_if_columns(
  'weekly_rotations_store_week_dept_idx',
  'public',
  'weekly_rotations',
  array['store_id', 'assigned_week', 'department_id'],
  $sql$
    create index if not exists weekly_rotations_store_week_dept_idx
      on public.weekly_rotations (store_id, assigned_week, department_id)
  $sql$
);

select public._p0_index_if_columns(
  'weekly_rotations_store_number_week_dept_idx',
  'public',
  'weekly_rotations',
  array['store_number', 'assigned_week', 'department_id'],
  $sql$
    create index if not exists weekly_rotations_store_number_week_dept_idx
      on public.weekly_rotations (store_number, assigned_week, department_id)
  $sql$
);

-- ---------------------------------------------------------------------------
-- 5. manager_notes — Floor Pad list
-- Phase 2: store_number + department. Legacy: store_id + department_code.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.manager_notes') is null then
    raise notice 'P0 skip manager_notes — table does not exist';
    return;
  end if;
  alter table public.manager_notes
    add column if not exists is_archived boolean not null default false;
end $$;

select public._p0_index_if_columns(
  'manager_notes_store_archived_dept_created_idx',
  'public',
  'manager_notes',
  array['store_number', 'is_archived', 'department', 'created_at'],
  $sql$
    create index if not exists manager_notes_store_archived_dept_created_idx
      on public.manager_notes (store_number, is_archived, department, created_at desc)
  $sql$
);

select public._p0_index_if_columns(
  'manager_notes_store_id_archived_dept_created_idx',
  'public',
  'manager_notes',
  array['store_id', 'is_archived', 'department_code', 'created_at'],
  $sql$
    create index if not exists manager_notes_store_id_archived_dept_created_idx
      on public.manager_notes (store_id, is_archived, department_code, created_at desc)
  $sql$
);

drop function if exists public._p0_index_if_columns(text, text, text, text[], text);
