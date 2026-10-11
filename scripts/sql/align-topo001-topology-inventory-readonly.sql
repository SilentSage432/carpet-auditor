-- DEPTSYNC-ALIGN-TOPO-001
-- Read-only production topology inventory
--
-- PURPOSE: Operator-executed inspection of department + location topology
-- metadata for two-department reconciliation design. Does NOT mutate data.
--
-- SAFETY:
--   * No INSERT / UPDATE / DELETE / DDL / TRUNCATE
--   * No SELECT of personal names, PINs, note bodies, or message text
--   * Aggregates and identifiers only (UUIDs / codes / counts)
--
-- HOW TO RUN (operator):
--   Supabase SQL Editor → paste → Run
--   Or: psql "$DATABASE_URL" -f scripts/sql/align-topo001-topology-inventory-readonly.sql
--
-- Repository fixtures are NOT production truth.
-- Do not treat this script's absence of rows as proof of empty production.

-- ---------------------------------------------------------------------------
-- 1) Departments for the store (codes, names, active flags, targets)
-- ---------------------------------------------------------------------------
select
  d.id as department_id,
  d.store_id,
  d.code,
  d.name,
  d.is_active,
  d.weekly_bay_target,
  d.created_at
from public.departments d
order by d.code;

-- ---------------------------------------------------------------------------
-- 2) Location surface counts by department
-- ---------------------------------------------------------------------------
select
  d.code as department_code,
  d.name as department_name,
  d.is_active as department_is_active,
  count(*)::int as surface_rows,
  count(*) filter (where sl.is_active)::int as active_surfaces,
  count(*) filter (where not sl.is_active)::int as inactive_surfaces,
  count(distinct (sl.aisle, sl.bay))::int as physical_bay_keys,
  count(*) filter (where sl.type = 'SELLING')::int as selling_rows,
  count(*) filter (where sl.type = 'TOPSTOCK')::int as topstock_rows
from public.store_locations sl
join public.departments d on d.id = sl.department_id
group by d.code, d.name, d.is_active
order by surface_rows desc, d.code;

-- ---------------------------------------------------------------------------
-- 3) Aisle inventory by department (no bay-level PII; structural only)
-- ---------------------------------------------------------------------------
select
  d.code as department_code,
  sl.aisle,
  count(*)::int as surface_rows,
  count(distinct sl.bay)::int as distinct_bays,
  min(sl.bay)::int as bay_min,
  max(sl.bay)::int as bay_max,
  count(*) filter (where sl.is_active)::int as active_surfaces,
  count(*) filter (where not sl.is_active)::int as inactive_surfaces
from public.store_locations sl
join public.departments d on d.id = sl.department_id
group by d.code, sl.aisle
order by d.code, sl.aisle;

-- ---------------------------------------------------------------------------
-- 4) Home Decor code presence check
-- ---------------------------------------------------------------------------
select
  exists (
    select 1 from public.departments d
    where lower(d.code) in ('home_decor', 'homedecor', 'd23h', 'decor')
       or lower(d.name) like '%home decor%'
  ) as home_decor_like_department_exists,
  (
    select count(*)::int from public.departments d where d.code = 'flooring'
  ) as flooring_department_rows,
  (
    select d.name from public.departments d where d.code = 'flooring' limit 1
  ) as flooring_display_name;

-- ---------------------------------------------------------------------------
-- 5) Rotation / history pressure on locations (counts only)
-- ---------------------------------------------------------------------------
-- If a relation is missing in an older DB, skip that block and continue.
select
  'weekly_rotations' as artifact,
  count(*)::int as row_count,
  count(distinct location_id)::int as distinct_locations
from public.weekly_rotations;

-- Optional: active (non-superseded) rotations — skip if column absent
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'weekly_rotations'
      and column_name = 'superseded_at'
  ) then
    raise notice 'weekly_rotations non-superseded: % rows / % locations',
      (select count(*) from public.weekly_rotations where superseded_at is null),
      (select count(distinct location_id) from public.weekly_rotations where superseded_at is null);
  else
    raise notice 'weekly_rotations.superseded_at absent — skipped active-plan count';
  end if;
end $$;

select
  'completion_attempts' as artifact,
  count(*)::int as row_count,
  count(distinct wr.location_id)::int as distinct_locations
from public.weekly_rotation_completion_attempts a
join public.weekly_rotations wr on wr.id = a.weekly_rotation_id;

select
  'bay_service_logs' as artifact,
  count(*)::int as row_count,
  count(distinct location_id)::int as distinct_locations
from public.bay_service_logs;

select
  'operational_context_location_relevance' as artifact,
  count(*)::int as row_count,
  count(distinct location_id)::int as distinct_locations
from public.operational_context_location_relevance;

select
  'sunday_bay_assignments' as artifact,
  count(*)::int as row_count,
  count(distinct bay_id)::int as distinct_locations
from public.sunday_bay_assignments;

-- ---------------------------------------------------------------------------
-- 6) Locations referenced by history that would block or lose evidence on delete
-- ---------------------------------------------------------------------------
select
  count(distinct sl.id)::int as locations_with_any_rotation,
  count(distinct sl.id) filter (
    where exists (
      select 1
      from public.weekly_rotations wr
      join public.weekly_rotation_completion_attempts a
        on a.weekly_rotation_id = wr.id
      where wr.location_id = sl.id
    )
  )::int as locations_with_completion_attempts,
  count(distinct sl.id) filter (
    where exists (
      select 1 from public.bay_service_logs b where b.location_id = sl.id
    )
  )::int as locations_with_service_logs
from public.store_locations sl;

-- ---------------------------------------------------------------------------
-- 7) Active-scope signal: non-flooring departments that still have active surfaces
-- ---------------------------------------------------------------------------
select
  d.code,
  d.name,
  d.is_active as department_is_active,
  count(*) filter (where sl.is_active)::int as active_surfaces
from public.departments d
left join public.store_locations sl on sl.department_id = d.id
where d.code is distinct from 'flooring'
group by d.code, d.name, d.is_active
having count(*) filter (where sl.is_active) > 0
   or d.is_active is true
order by active_surfaces desc nulls last, d.code;

-- ---------------------------------------------------------------------------
-- 8) Roster department code aggregates (no names / phones / pins)
-- ---------------------------------------------------------------------------
select
  coalesce(nullif(trim(assigned_department), ''), '(null)') as assigned_department,
  count(*)::int as members
from public.store_specialists
group by 1
order by members desc;

select
  coalesce(nullif(trim(home_department), ''), '(null)') as home_department,
  count(*)::int as members
from public.store_specialists
group by 1
order by members desc;

-- accessible_departments is text[]; unnest aggregates only
select
  coalesce(nullif(trim(code), ''), '(null)') as accessible_code,
  count(*)::int as member_grants
from public.store_specialists s
cross join lateral unnest(
  coalesce(s.accessible_departments, array[]::text[])
) as code
group by 1
order by member_grants desc;

-- End of align-topo001-topology-inventory-readonly.sql
