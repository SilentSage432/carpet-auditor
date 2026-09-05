-- Specialty / roster parity M1 — additive only.
--
-- App contract: lib/specialists.ts SELECT includes home_department;
-- assigned_department remains canonical (lib/types.ts specialistHomeDepartment).
-- home_department is an optional grouping / Lowe's home-department preference.
-- Writes already set both; reads fall back to assigned_department when null.
--
-- NO backfill. Existing rows stay NULL until a future authorized write.

alter table public.store_specialists
  add column if not exists home_department text;

comment on column public.store_specialists.home_department is
  'Optional Lowe''s home / roster-grouping department. assigned_department remains canonical workforce workspace; Hub reads fall back to assigned_department when this is null. Not an independent authority source.';
