-- DEPTSYNC-RD-3-DB-PREFLIGHT
-- Read-only production inspection + post-migration verification for
-- supabase/migrations/20261011_operational_sections.sql
--
-- SAFETY:
--   * No INSERT / UPDATE / DELETE / DDL
--   * No operational row contents (section names, members, roster PINs)
--   * Catalog / pg_catalog inspection only
--
-- HOW TO RUN (operator):
--   Supabase SQL Editor on project fmeinlwhixngednabhgy → paste → Run
--
-- Application vitest results do NOT prove database-level uniqueness.

-- ============================================================================
-- A) Preflight — prerequisites (run BEFORE migration)
-- ============================================================================

-- A1) FK targets exist with expected PK types
select
  c.relname as table_name,
  a.attname as column_name,
  format_type(a.atttypid, a.atttypmod) as data_type
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid
where n.nspname = 'public'
  and c.relkind = 'r'
  and (
    (c.relname = 'stores' and a.attname in ('id', 'store_number'))
    or (c.relname = 'departments' and a.attname = 'id')
    or (c.relname = 'store_specialists' and a.attname = 'id')
  )
  and a.attnum > 0
  and not a.attisdropped
order by c.relname, a.attname;

-- A2) jwt_matches_store(text) present (named arg p_store_number is fine)
select
  p.oid::regprocedure as procedure_identity,
  pg_get_function_identity_arguments(p.oid) as identity_args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'jwt_matches_store';

-- A3) authenticated role + pgcrypto / gen_random_uuid
select
  exists (select 1 from pg_roles where rolname = 'authenticated') as authenticated_role_exists,
  exists (select 1 from pg_extension where extname = 'pgcrypto') as pgcrypto_installed,
  to_regprocedure('pg_catalog.gen_random_uuid()') is not null as gen_random_uuid_available;

-- A4) RD-3 objects must be ABSENT before first apply
select
  to_regclass('public.operational_sections') as operational_sections,
  to_regclass('public.operational_section_members') as operational_section_members,
  to_regclass('public.operational_section_events') as operational_section_events,
  to_regprocedure('public.normalize_operational_section_aisle()')
    as normalize_operational_section_aisle,
  exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'operational_section_members_one_bay_idx'
  ) as one_bay_idx_exists;

-- Expect: all null/false before migration.

-- ============================================================================
-- B) Post-migration verification (run AFTER migration — still read-only)
-- ============================================================================

-- B1) Tables + RLS enabled; no authenticated write policies
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in (
    'operational_sections',
    'operational_section_members',
    'operational_section_events'
  )
order by c.relname;

select
  tablename,
  policyname,
  cmd,
  roles,
  qual
from pg_policies
where schemaname = 'public'
  and tablename in (
    'operational_sections',
    'operational_section_members',
    'operational_section_events'
  )
order by tablename, policyname;

-- Expect: SELECT-only policies; qual references jwt_matches_store(store_number).
-- Expect: zero INSERT/UPDATE/DELETE policies for authenticated.

-- B2) Aisle normalize trigger present
select
  t.tgname as trigger_name,
  p.proname as function_name,
  pg_get_triggerdef(t.oid) as trigger_def
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
where n.nspname = 'public'
  and c.relname = 'operational_section_members'
  and not t.tgisinternal
  and t.tgname = 'operational_section_members_normalize_aisle';

-- B3) Unique expression index matches app normalizeAisle
--     (trim → upper → collapse whitespace)
select
  i.relname as index_name,
  pg_get_indexdef(i.oid) as index_def,
  ix.indisunique as is_unique
from pg_index ix
join pg_class i on i.oid = ix.indexrelid
join pg_class t on t.oid = ix.indrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
  and t.relname = 'operational_section_members'
  and i.relname = 'operational_section_members_one_bay_idx';

-- Expect index_def contains:
--   regexp_replace(upper(trim(BOTH FROM aisle)), '\s+', ' ', 'g')
--   unique on (department_id, <expr>, bay)

-- B4) Active name uniqueness + event type check
select
  conname,
  pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = 'public.operational_section_events'::regclass
  and contype = 'c'
order by conname;

select
  i.relname as index_name,
  pg_get_indexdef(i.oid) as index_def
from pg_index ix
join pg_class i on i.oid = ix.indexrelid
join pg_class t on t.oid = ix.indrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
  and t.relname = 'operational_sections'
  and i.relname = 'operational_sections_active_name_idx';

-- B5) Empty after first apply (sanity — counts only)
select
  (select count(*) from public.operational_sections) as sections,
  (select count(*) from public.operational_section_members) as members,
  (select count(*) from public.operational_section_events) as events;

-- ============================================================================
-- C) Database uniqueness proof — DEFINITION ONLY on production
-- ============================================================================
-- Do NOT INSERT conflict pairs into production to prove uniqueness.
-- Catalog proof (B2 + B3) is the authorized production check.
--
-- Live INSERT conflict proof belongs on a non-production clone, or later
-- during an operator-authorized smoke that creates then retires a disposable
-- section through the API (not raw SQL writes of duplicate bays).
--
-- Expression equivalence (app normalizeAisle):
--   upper(trim(raw)).replace(/\s+/g, ' ')
-- SQL:
--   regexp_replace(upper(trim(both from aisle)), '\s+', ' ', 'g')
