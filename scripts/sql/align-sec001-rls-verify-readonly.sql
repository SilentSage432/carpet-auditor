-- DEPTSYNC-ALIGN-SEC-001
-- Read-only production RLS verification script
--
-- PURPOSE: Operator-executed inspection of RLS enablement and policy posture
-- against the canonical Supabase project. Does NOT mutate data or roles.
--
-- SAFETY:
--   * No INSERT / UPDATE / DELETE / DDL
--   * No SELECT of operational row contents (bays, rotations, notes, PINs)
--   * No secret material
--
-- HOW TO RUN (operator):
--   Supabase SQL Editor → paste → Run
--   Or: psql "$DATABASE_URL" -f scripts/sql/align-sec001-rls-verify-readonly.sql
--
-- Repository evidence alone does NOT prove production RLS state.

-- ---------------------------------------------------------------------------
-- 1) RLS enablement on security-sensitive / Store Ops tables
-- ---------------------------------------------------------------------------
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in (
    'store_specialists',
    'profiles',
    'stores',
    'departments',
    'store_locations',
    'weekly_rotations',
    'weekly_rotation_completion_attempts',
    'sunday_bay_assignments',
    'rotation_exceptions',
    'manager_notes',
    'associate_shift_days',
    'shift_walk_tasks',
    'downstock_queue',
    'bay_service_logs',
    'bay_audit_logs',
    'operational_contexts',
    'operational_context_department_relevance',
    'operational_context_location_relevance',
    'appliance_catalog',
    'appliance_scans',
    'carpet_audits',
    'carpet_catalog',
    'carpet_remnants'
  )
order by c.relname;

-- ---------------------------------------------------------------------------
-- 2) Effective policies (definitions only — no row data)
-- ---------------------------------------------------------------------------
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'store_specialists',
    'profiles',
    'stores',
    'departments',
    'store_locations',
    'weekly_rotations',
    'weekly_rotation_completion_attempts',
    'sunday_bay_assignments',
    'rotation_exceptions',
    'manager_notes',
    'associate_shift_days',
    'shift_walk_tasks',
    'downstock_queue',
    'bay_service_logs',
    'bay_audit_logs',
    'appliance_catalog',
    'appliance_scans',
    'carpet_audits',
    'carpet_catalog',
    'carpet_remnants'
  )
order by tablename, policyname;

-- ---------------------------------------------------------------------------
-- 3) Potentially permissive policies (USING/WITH CHECK true, or anon ALL)
--    Review each hit — presence is a signal, not automatic confirmation of risk.
-- ---------------------------------------------------------------------------
select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and (
    coalesce(qual, '') in ('true', '(true)')
    or coalesce(with_check, '') in ('true', '(true)')
    or (
      'anon' = any (roles)
      and cmd in ('ALL', 'SELECT', 'INSERT', 'UPDATE', 'DELETE')
    )
  )
order by tablename, policyname;

-- ---------------------------------------------------------------------------
-- 4) Tables in public with RLS disabled (broad inventory — names only)
-- ---------------------------------------------------------------------------
select
  c.relname as table_name_rls_disabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relrowsecurity = false
order by c.relname;

-- End of ALIGN-SEC-001 read-only RLS verification.
