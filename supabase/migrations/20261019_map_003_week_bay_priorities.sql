-- DEPTSYNC-MAP-003 — Supervisory bay priority for weekly rotation
--
-- Additive: week-scoped supervisor intent that a physical bay should receive
-- preferential consideration in an ownership-bound weekly proposal.
--
-- Semantics:
--   * NOT an assignment
--   * does NOT increase approved capacity
--   * does NOT transfer Operational Section ownership
--   * does NOT create Zebra tasks
--   * does NOT silently carry into other weeks
--
-- LOCAL / REVIEW ONLY in this tranche — do NOT apply to production here.
-- Does NOT activate Sunday auto-stage.

begin;

create extension if not exists "pgcrypto";

create table if not exists public.store_week_bay_priorities (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    references public.stores (id)
    on delete cascade,
  store_number text not null,
  week_label text not null,
  week_starting date not null,
  department_id uuid not null
    references public.departments (id)
    on delete restrict,
  aisle text not null,
  bay integer not null check (bay >= 0),
  -- Ownership snapshot at prioritize time (inspectable provenance; not a transfer).
  section_id uuid null
    references public.operational_sections (id)
    on delete set null,
  section_name text null,
  owner_specialist_id text null,
  prioritized_by_specialist_id text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz null,
  revoked_by_specialist_id text null,
  constraint store_week_bay_priorities_week_label_check
    check (week_label ~ '^[0-9]{4}-W[0-9]{2}$'),
  constraint store_week_bay_priorities_aisle_nonempty_check
    check (char_length(trim(aisle)) > 0),
  constraint store_week_bay_priorities_revoke_consistency_check
    check (
      (revoked_at is null and revoked_by_specialist_id is null)
      or (revoked_at is not null)
    )
);

comment on table public.store_week_bay_priorities is
  'MAP-003: week-scoped supervisory intent that a bay receive preferential consideration in weekly rotation proposals. Not an assignment.';

comment on column public.store_week_bay_priorities.owner_specialist_id is
  'Operational Section primary owner resolved at prioritize time. Proposal still re-resolves live ownership.';

comment on column public.store_week_bay_priorities.prioritized_by_specialist_id is
  'Roster id of Supervisor/Master who set the priority.';

-- Persist aisle identity matching app normalizeAisle.
create or replace function public.normalize_store_week_bay_priority_aisle()
returns trigger
language plpgsql
as $$
begin
  new.aisle := regexp_replace(upper(trim(both from new.aisle)), '\s+', ' ', 'g');
  if char_length(new.aisle) = 0 then
    raise exception 'store_week_bay_priorities.aisle must be non-empty after normalize';
  end if;
  return new;
end;
$$;

drop trigger if exists store_week_bay_priorities_normalize_aisle
  on public.store_week_bay_priorities;
create trigger store_week_bay_priorities_normalize_aisle
  before insert or update of aisle
  on public.store_week_bay_priorities
  for each row
  execute function public.normalize_store_week_bay_priority_aisle();

-- One active (non-revoked) priority per store/week/physical bay.
drop index if exists store_week_bay_priorities_active_unique_idx;
create unique index store_week_bay_priorities_active_unique_idx
  on public.store_week_bay_priorities (
    store_number,
    week_label,
    department_id,
    (regexp_replace(upper(trim(both from aisle)), '\s+', ' ', 'g')),
    bay
  )
  where revoked_at is null;

create index if not exists store_week_bay_priorities_store_week_idx
  on public.store_week_bay_priorities (store_number, week_label)
  where revoked_at is null;

create index if not exists store_week_bay_priorities_department_idx
  on public.store_week_bay_priorities (department_id);

alter table public.store_week_bay_priorities enable row level security;

revoke all on table public.store_week_bay_priorities from public, anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.store_week_bay_priorities from authenticated;
grant select on table public.store_week_bay_priorities to authenticated;

drop policy if exists "Authenticated read week bay priorities"
  on public.store_week_bay_priorities;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise notice 'store_week_bay_priorities: skipping RLS (authenticated absent)';
    return;
  end if;

  if to_regprocedure('public.jwt_matches_store(text)') is null then
    raise notice 'store_week_bay_priorities: jwt_matches_store missing — authenticated SELECT denied';
    execute $policy$
      create policy "Authenticated read week bay priorities"
        on public.store_week_bay_priorities
        for select
        to authenticated
        using (false)
    $policy$;
  else
    execute $policy$
      create policy "Authenticated read week bay priorities"
        on public.store_week_bay_priorities
        for select
        to authenticated
        using (public.jwt_matches_store(store_week_bay_priorities.store_number))
    $policy$;
  end if;
end $$;

commit;
