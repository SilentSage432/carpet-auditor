-- DEPTSYNC-SEC-OPS-002 — Production RLS exposure containment
--
-- Removes confirmed open {public} ALL USING (true) policies on:
--   bay_service_logs
--   rotation_exceptions
-- Revokes anon table privileges on those tables.
-- Narrows authenticated bay_service_logs grants to SELECT (writes via service role).
-- Revokes client SELECT on secret credential columns (lockdown intent).
--
-- Does NOT modify operational row data, PINs, auth architecture, rotations,
-- topology, walkthroughs, or operational sections.
-- Preserves store-scoped authenticated policies already present.

begin;

-- ---------------------------------------------------------------------------
-- A) Drop open public ALL policies (exact production names from SEC-OPS-001)
-- ---------------------------------------------------------------------------
drop policy if exists "Allow all operations for authenticated and anon"
  on public.bay_service_logs;

drop policy if exists "Allow authenticated full access to rotation_exceptions"
  on public.rotation_exceptions;

-- ---------------------------------------------------------------------------
-- B) Anon: no table privileges on contained tables
-- ---------------------------------------------------------------------------
revoke all on table public.bay_service_logs from anon;
revoke all on table public.rotation_exceptions from anon;

-- ---------------------------------------------------------------------------
-- C) Authenticated: bay_service_logs SELECT only (store-scoped SELECT policy remains)
--    rotation_exceptions keeps DML grants for existing store+dept JWT ALL policy
-- ---------------------------------------------------------------------------
revoke all on table public.bay_service_logs from authenticated;
grant select on table public.bay_service_logs to authenticated;

-- Ensure authenticated retains intended access on rotation_exceptions
grant select, insert, update, delete on table public.rotation_exceptions
  to authenticated;

-- service_role privileges unchanged (bypass RLS; used after API authz)

-- ---------------------------------------------------------------------------
-- D) Secret column SELECT containment (store_specialists + profiles)
--    PostgreSQL table-level SELECT implies all columns; REVOKE SELECT (col)
--    alone is a no-op when attacl is null. Convert to column grants.
--    PIN verify / invite / bridge paths use service role — not client SELECT.
-- ---------------------------------------------------------------------------

-- Anon should not hold table privileges on roster (matches 20260817 lockdown)
revoke all on table public.store_specialists from anon;

-- Authenticated: keep DML; replace blanket SELECT with non-secret columns only
revoke select on table public.store_specialists from authenticated;
grant select (
  id,
  username,
  name,
  role,
  department_id,
  is_active,
  created_at,
  assigned_department,
  assigned_department_id,
  must_change_credentials,
  store_number,
  invite_token_expires_at,
  must_change_pin,
  phone_number,
  accessible_departments,
  status,
  invite_consumed_at,
  auth_token_expires_at,
  pin_updated_at,
  auth_user_id,
  email,
  floor_title,
  home_department
) on public.store_specialists to authenticated;

-- profiles: strip secret SELECT for client roles; keep non-secret SELECT
revoke select on table public.profiles from anon;
revoke select on table public.profiles from authenticated;
grant select (
  id,
  username,
  full_name,
  role,
  assigned_department_id,
  is_active,
  created_at,
  assigned_department,
  must_change_credentials,
  store_number,
  specialist_id,
  accessible_departments,
  is_cross_department,
  is_scheduled_today,
  is_call_out,
  shift_start_time,
  shift_end_time,
  scheduled_days,
  phone_number,
  status,
  auth_token_expires_at,
  pin_updated_at
) on public.profiles to authenticated;

-- Keep RLS enabled (no disable)
alter table public.bay_service_logs enable row level security;
alter table public.rotation_exceptions enable row level security;

commit;
