-- RD-3 Operational Sections overlay.
-- Stewardship groupings of physical bays (department_id, aisle, bay).
-- Writes via service role after Supervisor/Master API auth.
-- Authenticated SELECT is store-scoped. No authenticated write policies.
-- Soft-retire sections; membership history preserved. No hard cascades to rotations.

create extension if not exists "pgcrypto";

create table if not exists public.operational_sections (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    references public.stores (id)
    on delete cascade,
  department_id uuid not null
    references public.departments (id)
    on delete restrict,
  name text not null,
  description text null,
  primary_owner_specialist_id uuid null
    references public.store_specialists (id)
    on delete set null,
  is_active boolean not null default true,
  retired_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operational_sections_name_nonempty_check
    check (char_length(trim(name)) > 0),
  constraint operational_sections_retire_consistency_check
    check (
      (is_active = true and retired_at is null)
      or (is_active = false and retired_at is not null)
    )
);

comment on table public.operational_sections is
  'RD-3 named stewardship overlay of physical bays. Not weekly assignment. Soft-retire via is_active.';

comment on column public.operational_sections.primary_owner_specialist_id is
  'Optional roster steward (store_specialists.id). Independent of sunday_bay_assignments.';

comment on column public.operational_sections.department_id is
  'Constitution Art. V-A: section lives within one department. Member bays must match.';

-- Active membership only. Retire/remove moves rows to history.
create table if not exists public.operational_section_members (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null
    references public.operational_sections (id)
    on delete cascade,
  store_id uuid not null
    references public.stores (id)
    on delete cascade,
  department_id uuid not null
    references public.departments (id)
    on delete restrict,
  aisle text not null,
  bay integer not null check (bay >= 0),
  created_at timestamptz not null default now(),
  constraint operational_section_members_aisle_nonempty_check
    check (char_length(trim(aisle)) > 0),
  constraint operational_section_members_unique_in_section
    unique (section_id, department_id, aisle, bay)
);

comment on table public.operational_section_members is
  'Active physical-bay membership for operational sections. Key = (department_id, aisle, bay).';

-- Persist aisle identity matching app normalizeAisle: trim → upper → collapse whitespace.
create or replace function public.normalize_operational_section_aisle()
returns trigger
language plpgsql
as $$
begin
  new.aisle := regexp_replace(upper(trim(both from new.aisle)), '\s+', ' ', 'g');
  if char_length(new.aisle) = 0 then
    raise exception 'operational_section_members.aisle must be non-empty after normalize';
  end if;
  return new;
end;
$$;

drop trigger if exists operational_section_members_normalize_aisle
  on public.operational_section_members;
create trigger operational_section_members_normalize_aisle
  before insert or update of aisle
  on public.operational_section_members
  for each row
  execute function public.normalize_operational_section_aisle();

-- One active membership per physical bay after aisle normalization (DB invariant).
-- Expression index also blocks case/whitespace equivalents if trigger ever bypassed.
drop index if exists operational_section_members_one_bay_idx;
create unique index operational_section_members_one_bay_idx
  on public.operational_section_members (
    department_id,
    (regexp_replace(upper(trim(both from aisle)), '\s+', ' ', 'g')),
    bay
  );

create index if not exists operational_sections_store_active_idx
  on public.operational_sections (store_id, is_active);

create index if not exists operational_sections_department_idx
  on public.operational_sections (department_id);

create index if not exists operational_section_members_section_idx
  on public.operational_section_members (section_id);

create index if not exists operational_section_members_store_idx
  on public.operational_section_members (store_id);

-- History for remove / retire / ownership changes (append-only).
create table if not exists public.operational_section_events (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null
    references public.operational_sections (id)
    on delete cascade,
  store_id uuid not null
    references public.stores (id)
    on delete cascade,
  event_type text not null,
  department_id uuid null,
  aisle text null,
  bay integer null,
  previous_owner_specialist_id uuid null,
  next_owner_specialist_id uuid null,
  acted_by_specialist_id text null,
  detail text null,
  created_at timestamptz not null default now(),
  constraint operational_section_events_type_check
    check (
      event_type in (
        'created',
        'renamed',
        'owner_changed',
        'member_added',
        'member_removed',
        'retired',
        'reactivated'
      )
    )
);

comment on table public.operational_section_events is
  'RD-3 append-only section stewardship events. Does not drive rotation.';

create index if not exists operational_section_events_section_idx
  on public.operational_section_events (section_id, created_at desc);

create index if not exists operational_section_events_store_idx
  on public.operational_section_events (store_id, created_at desc);

-- Unique active name per department (retired names may be reused).
create unique index if not exists operational_sections_active_name_idx
  on public.operational_sections (store_id, department_id, lower(trim(name)))
  where is_active = true;

alter table public.operational_sections enable row level security;
alter table public.operational_section_members enable row level security;
alter table public.operational_section_events enable row level security;

drop policy if exists "Authenticated read operational sections"
  on public.operational_sections;
drop policy if exists "Authenticated read operational section members"
  on public.operational_section_members;
drop policy if exists "Authenticated read operational section events"
  on public.operational_section_events;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise notice 'operational_sections: skipping RLS policies (authenticated role absent)';
    return;
  end if;

  if to_regprocedure('public.jwt_matches_store(text)') is null then
    raise notice 'operational_sections: jwt_matches_store missing — open authenticated SELECT';
    execute $policy$
      create policy "Authenticated read operational sections"
        on public.operational_sections
        for select
        to authenticated
        using (true)
    $policy$;
    execute $policy$
      create policy "Authenticated read operational section members"
        on public.operational_section_members
        for select
        to authenticated
        using (true)
    $policy$;
    execute $policy$
      create policy "Authenticated read operational section events"
        on public.operational_section_events
        for select
        to authenticated
        using (true)
    $policy$;
    return;
  end if;

  execute $policy$
    create policy "Authenticated read operational sections"
      on public.operational_sections
      for select
      to authenticated
      using (
        exists (
          select 1
          from public.stores s
          where s.id = operational_sections.store_id
            and public.jwt_matches_store(s.store_number)
        )
      )
  $policy$;

  execute $policy$
    create policy "Authenticated read operational section members"
      on public.operational_section_members
      for select
      to authenticated
      using (
        exists (
          select 1
          from public.stores s
          where s.id = operational_section_members.store_id
            and public.jwt_matches_store(s.store_number)
        )
      )
  $policy$;

  execute $policy$
    create policy "Authenticated read operational section events"
      on public.operational_section_events
      for select
      to authenticated
      using (
        exists (
          select 1
          from public.stores s
          where s.id = operational_section_events.store_id
            and public.jwt_matches_store(s.store_number)
        )
      )
  $policy$;
end $$;

-- No authenticated INSERT/UPDATE/DELETE — service role after API actor checks.

notify pgrst, 'reload schema';
