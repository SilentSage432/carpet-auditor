-- DEPTSYNC-TOPOLOGY-REGISTRY-002 — Production preflight (READ-ONLY)
-- Canonical project: fmeinlwhixngednabhgy · Store 2587
-- Do NOT run DML/DDL from this file. Operator executes SELECT checks only
-- before a separately authorized migration apply.

-- 1) Project / store presence
select id, store_number
from public.stores
where store_number = '2587';

-- 2) store_aisles must not already exist (or report if it does)
select to_regclass('public.store_aisles') as store_aisles_regclass;

-- 3) Bay table still requires bay NOT NULL
select
  c.column_name,
  c.is_nullable,
  c.data_type
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name = 'store_locations'
  and c.column_name in ('aisle', 'bay', 'store_id', 'department_id')
order by c.column_name;

-- 4) Distinct aisle inventory for backfill expectation
select
  count(*) as location_rows,
  count(distinct department_id) as departments_with_locations,
  count(distinct (department_id, upper(trim(aisle)))) as approx_dept_aisle_pairs
from public.store_locations
where char_length(trim(coalesce(aisle, ''))) > 0;

-- 5) Ambiguous digit-padding pairs (same dept, codes that normalize together)
-- Operator reviews before apply; migration collapses to one registry row.
with normalized as (
  select
    department_id,
    aisle as raw_aisle,
    case
      when regexp_replace(upper(trim(aisle)), '\s+', ' ', 'g') ~ '^\d+$'
        then (regexp_replace(upper(trim(aisle)), '\s+', ' ', 'g')::numeric)::bigint::text
      else regexp_replace(upper(trim(aisle)), '\s+', ' ', 'g')
    end as norm_aisle,
    bool_or(is_active is distinct from false) as any_active
  from public.store_locations
  where char_length(trim(coalesce(aisle, ''))) > 0
  group by 1, 2, 3
)
select
  department_id,
  norm_aisle,
  array_agg(distinct raw_aisle order by raw_aisle) as raw_variants,
  count(*) as variant_count
from normalized
group by department_id, norm_aisle
having count(*) > 1
order by department_id, norm_aisle;

-- 6) jwt helper present (required for store-scoped SELECT policy)
select to_regprocedure('public.jwt_matches_store(text)') as jwt_matches_store;

-- 7) Role presence
select rolname
from pg_roles
where rolname in ('anon', 'authenticated', 'service_role')
order by rolname;
