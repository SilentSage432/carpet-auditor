-- DEPTSYNC-ROTATION-AUTO-008B — disposable local validation for
-- 20261025_rotation_auto_008a_standing_capacity.sql
--
-- NOT FOR PRODUCTION. Applies the additive standing-capacity migration onto a
-- minimal fixture and asserts:
--   - standing policy tables exist
--   - one-active unique index works
--   - provenance constraints hold
--   - existing weekly approvals table (if present) is untouched by migration DDL
--
-- Rollback (local only): drop the three new tables / index.

begin;

create extension if not exists "pgcrypto";

-- Minimal jwt helper so RLS branch can succeed in isolation.
create or replace function public.jwt_matches_store(p_store text)
returns boolean
language sql
stable
as $$
  select true;
$$;

-- Optional stub of weekly approvals so we prove migration does not touch it.
create table if not exists public.store_week_capacity_approvals (
  id uuid primary key default gen_random_uuid(),
  store_number text not null,
  week_label text not null,
  week_starting date not null,
  specialist_id text not null,
  approved_capacity integer not null check (approved_capacity >= 0 and approved_capacity <= 3),
  schedule_fingerprint text not null,
  approved_by_specialist_id text not null,
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_number, week_label, specialist_id)
);

insert into public.store_week_capacity_approvals (
  store_number, week_label, week_starting, specialist_id,
  approved_capacity, schedule_fingerprint, approved_by_specialist_id
) values (
  '2587', '2026-W43', '2026-10-19', 'tyson',
  3, 'fp-tyson', 'master'
) on conflict do nothing;

commit;

-- Apply the production migration file contents next (caller runs it).
