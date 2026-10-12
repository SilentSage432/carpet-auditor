-- DEPTSYNC-TOPOLOGY-REGISTRY-002
-- Additive physical aisle / named-zone registry (store_aisles).
--
-- WHY: store_locations is bay-row-only (bay INTEGER NOT NULL). Operators cannot
-- document CARPET-WALL / showrooms before bays exist without inventing fake bays.
-- This table records location existence independently; soft-join to bay rows by
-- (department_id, normalize_store_aisle(aisle)).
--
-- PRESERVES: store_locations PKs, aisle values, bay NOT NULL, uniqueness, history,
-- section memberships, assignments. No FK from store_locations → store_aisles.
-- No placeholder bays. No hierarchy rewrite.
--
-- WRITES: service_role only (application API after MasterAdmin checks in REGISTRY-003).
-- READS: authenticated SELECT store-scoped via jwt_matches_store (RD-3 pattern).
--
-- BACKFILL: idempotent INSERT … ON CONFLICT DO NOTHING from distinct aisles.
-- Active iff any bay surface is active; fully retired aisles stay retired.
--
-- DO NOT apply to production in this tranche without a separate operator authorization.

begin;

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Normalize: trim → upper → collapse whitespace; digit-only codes collapse
-- leading zeros to match app locationDedupeAisleKey / Number(code) string form.
-- Named zones (SHOW-L, CARPET-WALL) are never numeric-collapsed.
-- ---------------------------------------------------------------------------
create or replace function public.normalize_store_aisle(raw text)
returns text
language sql
immutable
as $$
  select case
    when v = '' then ''
    when v ~ '^\d+$' then (v::numeric)::bigint::text
    else v
  end
  from (
    select regexp_replace(
      upper(trim(both from coalesce(raw, ''))),
      '\s+',
      ' ',
      'g'
    ) as v
  ) normalized;
$$;

comment on function public.normalize_store_aisle(text) is
  'REGISTRY-002 aisle/zone normalize — matches app normalizeAisle + digit dedupe.';

-- ---------------------------------------------------------------------------
-- Registry table
-- ---------------------------------------------------------------------------
create table if not exists public.store_aisles (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    references public.stores (id)
    on delete cascade,
  department_id uuid not null
    references public.departments (id)
    on delete restrict,
  aisle text not null,
  display_name text null,
  is_active boolean not null default true,
  retired_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_aisles_aisle_nonempty_check
    check (char_length(trim(aisle)) > 0),
  constraint store_aisles_retire_consistency_check
    check (
      (is_active = true and retired_at is null)
      or (is_active = false and retired_at is not null)
    ),
  constraint store_aisles_department_aisle_key
    unique (department_id, aisle)
);

comment on table public.store_aisles is
  'REGISTRY-002 physical aisle/zone registry. May have zero bays. Soft-join to store_locations by department_id + normalize_store_aisle(aisle).';

comment on column public.store_aisles.aisle is
  'Canonical aisle/zone code after normalize_store_aisle (e.g. 41, SHOW-L, CARPET-WALL).';

comment on column public.store_aisles.display_name is
  'Optional human label (e.g. Carpet Wall). Null → app formatAisleDisplayLabel(aisle).';

comment on column public.store_aisles.is_active is
  'Soft-retire empty or fully retired locations. Independent of individual bay is_active.';

-- Expression unique index also blocks case/whitespace/padding equivalents if
-- trigger ever bypassed (defense in depth; plain UNIQUE also on normalized aisle).
create unique index if not exists store_aisles_dept_aisle_norm_uidx
  on public.store_aisles (
    department_id,
    (public.normalize_store_aisle(aisle))
  );

create index if not exists store_aisles_store_active_idx
  on public.store_aisles (store_id, is_active);

create index if not exists store_aisles_department_idx
  on public.store_aisles (department_id);

-- ---------------------------------------------------------------------------
-- Triggers: normalize aisle; enforce store_id matches department.store_id;
-- touch updated_at
-- ---------------------------------------------------------------------------
create or replace function public.store_aisles_normalize_aisle()
returns trigger
language plpgsql
as $$
begin
  new.aisle := public.normalize_store_aisle(new.aisle);
  if char_length(new.aisle) = 0 then
    raise exception 'store_aisles.aisle must be non-empty after normalize';
  end if;
  if new.display_name is not null then
    new.display_name := nullif(btrim(new.display_name), '');
  end if;
  return new;
end;
$$;

drop trigger if exists store_aisles_normalize_aisle on public.store_aisles;
create trigger store_aisles_normalize_aisle
  before insert or update of aisle, display_name
  on public.store_aisles
  for each row
  execute function public.store_aisles_normalize_aisle();

create or replace function public.store_aisles_enforce_store_department()
returns trigger
language plpgsql
as $$
declare
  v_dept_store uuid;
begin
  select d.store_id into v_dept_store
  from public.departments d
  where d.id = new.department_id;

  if v_dept_store is null then
    raise exception 'store_aisles.department_id % not found', new.department_id;
  end if;

  if v_dept_store is distinct from new.store_id then
    raise exception
      'store_aisles.store_id (%) must match departments.store_id (%) for department %',
      new.store_id,
      v_dept_store,
      new.department_id;
  end if;

  return new;
end;
$$;

drop trigger if exists store_aisles_enforce_store_department on public.store_aisles;
create trigger store_aisles_enforce_store_department
  before insert or update of store_id, department_id
  on public.store_aisles
  for each row
  execute function public.store_aisles_enforce_store_department();

create or replace function public.store_aisles_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists store_aisles_touch_updated_at on public.store_aisles;
create trigger store_aisles_touch_updated_at
  before update on public.store_aisles
  for each row
  execute function public.store_aisles_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Idempotent backfill from existing bay rows (does not rewrite store_locations)
-- ---------------------------------------------------------------------------
insert into public.store_aisles (
  store_id,
  department_id,
  aisle,
  display_name,
  is_active,
  retired_at
)
select
  coalesce(sl.store_id, d.store_id) as store_id,
  sl.department_id,
  public.normalize_store_aisle(sl.aisle) as aisle,
  null::text as display_name,
  bool_or(sl.is_active is distinct from false) as is_active,
  case
    when bool_or(sl.is_active is distinct from false) then null
    else coalesce(max(sl.updated_at), now())
  end as retired_at
from public.store_locations sl
inner join public.departments d
  on d.id = sl.department_id
where char_length(trim(both from coalesce(sl.aisle, ''))) > 0
  and public.normalize_store_aisle(sl.aisle) <> ''
group by
  coalesce(sl.store_id, d.store_id),
  sl.department_id,
  public.normalize_store_aisle(sl.aisle)
on conflict (department_id, aisle) do nothing;

-- ---------------------------------------------------------------------------
-- RLS — RD-3 pattern: authenticated store-scoped SELECT; no client writes
-- ---------------------------------------------------------------------------
alter table public.store_aisles enable row level security;

drop policy if exists "Authenticated read store aisles" on public.store_aisles;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise notice 'store_aisles: skipping RLS policies (authenticated role absent)';
    return;
  end if;

  -- Prefer store-scoped policy when jwt helper exists (production).
  if to_regprocedure('public.jwt_matches_store(text)') is null then
    raise notice
      'store_aisles: jwt_matches_store missing — authenticated SELECT denied (fail-closed)';
    -- Fail-closed: do not open using(true). Authenticated gets no usable policy.
    return;
  end if;

  execute $policy$
    create policy "Authenticated read store aisles"
      on public.store_aisles
      for select
      to authenticated
      using (
        exists (
          select 1
          from public.stores s
          where s.id = store_aisles.store_id
            and public.jwt_matches_store(s.store_number)
        )
      )
  $policy$;
end $$;

-- Explicit privilege posture (idempotent where roles exist).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.store_aisles from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke insert, update, delete, truncate, references, trigger on table public.store_aisles from authenticated';
    execute 'grant select on table public.store_aisles to authenticated';
  end if;
end $$;

-- No authenticated INSERT/UPDATE/DELETE policies — service_role after API actor checks.

notify pgrst, 'reload schema';

commit;
