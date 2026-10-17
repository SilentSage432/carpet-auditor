-- DEPTSYNC-ROTATION-AUTO-003 — supervisor edit lock for automatic publication safety.
-- LOCAL PREPARE ONLY — do not apply to production in this tranche.
--
-- When supervisor_locked is true, scheduled auto-publish must not change that
-- bay_id for the store-week (including cleared-but-held empties).

alter table public.sunday_bay_assignments
  add column if not exists supervisor_locked boolean not null default false;

comment on column public.sunday_bay_assignments.supervisor_locked is
  'ROTATION-AUTO-003: supervisor intentionally edited this bay; automatic weekly publication must not overwrite';

create index if not exists sunday_bay_assignments_supervisor_locked_idx
  on public.sunday_bay_assignments (store_number, week_starting, supervisor_locked)
  where supervisor_locked = true;
