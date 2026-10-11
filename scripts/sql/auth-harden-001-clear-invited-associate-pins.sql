-- DEPTSYNC-AUTH-HARDEN-001 — targeted invited-associate plaintext PIN clear
-- LOCAL / STAGED ONLY. Do NOT execute against production without explicit release auth.
--
-- Intent (SEC-OPS-003):
--   Two invited Associate rows still carry unused digit plaintext PIN values
--   (id prefixes 6f79f577… and 2d65fa60…). Clear pin material only.
--   Do not change invitation status, role, or account identity.
--
-- Canonical project (reference only): fmeinlwhixngednabhgy
--
-- PRE-CHECK (read-only) — confirm exactly two rows before any authorized run:
--
--   select id, employee_id, role, status, invite_status,
--          store_number,
--          length(coalesce(pin_code, '')) as pin_len,
--          (pin_code ~ '^[0-9]{4,8}$') as looks_plaintext
--   from public.store_specialists
--   where (
--       id::text like '6f79f577%'
--       or id::text like '2d65fa60%'
--     )
--     and lower(coalesce(role, '')) = 'associate'
--     and lower(coalesce(status, '')) = 'invited'
--     and pin_code ~ '^[0-9]{4,8}$';

begin;

-- Bound to the two SEC-OPS-003 invited associate identity prefixes.
-- Guards: Associate + invited status + digit plaintext only.
update public.store_specialists
set
  pin_code = null,
  pin_hash = null,
  pin_updated_at = now()
where (
    id::text like '6f79f577%'
    or id::text like '2d65fa60%'
  )
  and lower(coalesce(role, '')) = 'associate'
  and lower(coalesce(status, '')) = 'invited'
  and pin_code ~ '^[0-9]{4,8}$'
returning id, employee_id, role, status, store_number,
          pin_code is null as pin_cleared;

-- Review returning rows (expect 2). Then COMMIT only under release authorization.
-- This file ends in ROLLBACK so accidental runs are non-mutating.
rollback;
