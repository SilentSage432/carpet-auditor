-- Disposable harness notes for OPERATIONAL-011 local RPC validation.
-- NOT for production. Apply 20261018_operational_011_section_ownership.sql
-- against a local DB that already has CAPACITY-GUARD + RD-3 tables.
--
-- Expected exception codes from upsert_sunday_bay_assignments_with_capacity:
--   SECTION_OWNERSHIP_MISSING
--   SECTION_OWNERSHIP_MISMATCH
--   SECTION_OWNERSHIP_AMBIGUOUS
-- Capacity exceptions remain unchanged.
--
-- Manual checks (service_role):
-- 1) Assign bay outside assignee's section → SECTION_OWNERSHIP_MISMATCH
-- 2) Assign bay with no membership → SECTION_OWNERSHIP_MISSING
-- 3) Same-owner idempotent rewrite still requires live ownership match
-- 4) Cleared assignments skip ownership checks
-- 5) Approved capacity safeguards still fire after ownership passes

select 'operational-011 harness loaded' as status;
