-- DEPTSYNC-DB-CLEAN-001: Remove accidental Carb Buddy schema from DeptSync production.
--
-- Evidence (audit 2026-09-07):
--   - Zero references in carpet-auditor application/migrations/docs/types.
--   - Tables empty (0 rows each).
--   - Closed FK graph among these five tables only; no DeptSync inbound FKs.
--   - pair_code generator prefixes "CB-" (Carb Buddy branding).
--   - No views; supporting functions only serve family_units.
--
-- DO NOT rewrite historical migrations. Forward cleanup only.
-- Explicit DROP TABLE IF EXISTS — no CASCADE.
-- Does not touch legitimate DeptSync tables.

-- Leaf / dependent tables first (FK order).
drop table if exists public.correction_events;
drop table if exists public.caregiver_nudges;
drop table if exists public.family_events;
drop table if exists public.family_members;
drop table if exists public.family_units;

-- Trigger family_units_pair_code_tg is removed with family_units.
-- Pair-code helpers are Carb Buddy–only (generate codes like CB-****).
drop function if exists public.family_units_assign_pair_code();
drop function if exists public.generate_family_pair_code();

notify pgrst, 'reload schema';
