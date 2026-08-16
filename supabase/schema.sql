-- Carpet Management Hub schema
-- Run in the Supabase SQL editor.

create extension if not exists "pgcrypto";

-- Cycle audits
create table if not exists public.carpet_audits (
  id uuid primary key default gen_random_uuid(),
  sku text not null,
  carpet_name text not null default '',
  location_type text not null check (location_type in ('sales_floor', 'top_stock')),
  measurement_inches numeric(8, 3) not null check (measurement_inches >= 0),
  measurement_fraction numeric(4, 3) not null check (measurement_fraction >= 0 and measurement_fraction < 1),
  rounds integer not null check (rounds > 0),
  calculated_clf numeric(12, 4) not null,
  system_clf numeric(12, 4),
  variance_clf numeric(12, 4),
  audited_by text not null default '',
  created_at timestamptz not null default now()
);

alter table public.carpet_audits add column if not exists system_clf numeric(12, 4);
alter table public.carpet_audits add column if not exists variance_clf numeric(12, 4);
alter table public.carpet_audits add column if not exists audited_by text not null default '';

create index if not exists carpet_audits_created_at_idx
  on public.carpet_audits (created_at desc);
create index if not exists carpet_audits_audited_by_idx
  on public.carpet_audits (audited_by);

-- Master wall catalog
create table if not exists public.carpet_catalog (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  carpet_name text not null,
  vendor text not null default '',
  roll_width_ft numeric(6, 2) not null default 12.00,
  upc_barcode text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.carpet_catalog
  add column if not exists upc_barcode text;

create index if not exists carpet_catalog_sku_idx on public.carpet_catalog (sku);
create index if not exists carpet_catalog_upc_barcode_idx
  on public.carpet_catalog (upc_barcode)
  where upc_barcode is not null;

-- Remnant rack inventory
create table if not exists public.carpet_remnants (
  id uuid primary key default gen_random_uuid(),
  sku text not null default '',
  carpet_name text not null default '',
  tag_number text not null,
  width_ft numeric(8, 3) not null default 12,
  length_ft numeric(8, 3) not null,
  square_feet numeric(12, 4) not null,
  square_yards numeric(12, 4) not null,
  location text not null default '',
  notes text not null default '',
  status text not null default 'available'
    check (status in ('available', 'reserved', 'sold')),
  reserved_for text not null default '',
  logged_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.carpet_remnants
  add column if not exists logged_by text not null default '';

create index if not exists carpet_remnants_status_idx on public.carpet_remnants (status);
create index if not exists carpet_remnants_tag_idx on public.carpet_remnants (tag_number);

-- Floor specialists
create table if not exists public.store_specialists (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  role text not null default 'Associate'
    check (role in ('Associate', 'Supervisor', 'MasterAdmin', 'Specialist')),
  pin_code text,
  created_at timestamptz not null default now()
);

alter table public.store_specialists
  add column if not exists pin_code text;

-- Prefer Associate/Supervisor roles going forward
update public.store_specialists
set role = 'Associate'
where lower(role) in ('specialist', 'associate');

-- Remove old demo placeholder names if present
delete from public.store_specialists
where lower(name) in ('alex', 'dave', 'sales specialist 1', 'sales specialist 2');

-- Seed a single Flooring Supervisor (default PIN 1234) if none exists
insert into public.store_specialists (name, role, pin_code)
select 'Flooring Supervisor', 'Supervisor', '1234'
where not exists (
  select 1 from public.store_specialists where role = 'Supervisor'
);

-- Deduplicate generic Department Supervisor rows only (keep newest).
-- Do NOT collapse all Supervisor roles — department supervisors coexist.
delete from public.store_specialists s
using public.store_specialists keep
where lower(s.name) in ('department supervisor', 'dept supervisor')
  and lower(keep.name) in ('department supervisor', 'dept supervisor')
  and s.id <> keep.id
  and s.created_at < keep.created_at;

-- Normalize surviving generic supervisor display name
update public.store_specialists
set name = 'Flooring Supervisor', role = 'Supervisor'
where lower(name) in ('department supervisor', 'dept supervisor');

-- Multi-store context
alter table public.carpet_audits
  add column if not exists store_number text not null default '1234';
alter table public.carpet_catalog
  add column if not exists store_number text not null default '1234';
alter table public.carpet_remnants
  add column if not exists store_number text not null default '1234';
alter table public.store_specialists
  add column if not exists store_number text not null default '1234';

create index if not exists carpet_audits_store_number_idx
  on public.carpet_audits (store_number);
create index if not exists carpet_catalog_store_number_idx
  on public.carpet_catalog (store_number);
create index if not exists carpet_remnants_store_number_idx
  on public.carpet_remnants (store_number);
create index if not exists store_specialists_store_number_idx
  on public.store_specialists (store_number);

-- Catalog uniqueness per store (drop global sku unique if present)
alter table public.carpet_catalog drop constraint if exists carpet_catalog_sku_key;
create unique index if not exists carpet_catalog_store_sku_uidx
  on public.carpet_catalog (store_number, sku);

-- Specialist uniqueness per store
alter table public.store_specialists drop constraint if exists store_specialists_name_key;
create unique index if not exists store_specialists_store_name_uidx
  on public.store_specialists (store_number, name);

-- Manager markdown fields on remnants
alter table public.carpet_remnants
  add column if not exists estimated_value numeric(12, 2);
alter table public.carpet_remnants
  add column if not exists markdown_percent numeric(6, 2);
alter table public.carpet_remnants
  add column if not exists markdown_price numeric(12, 2);
alter table public.carpet_remnants
  add column if not exists markdown_notes text not null default '';
alter table public.carpet_remnants
  add column if not exists markdown_by text not null default '';
alter table public.carpet_remnants
  add column if not exists markdown_at timestamptz;

-- Multi-category flooring + SIMS location tags
-- Tables keep carpet_* names; app treats them as flooring_audits / SIMS catalog.
alter table public.carpet_catalog
  add column if not exists category text not null default 'Carpet';
alter table public.carpet_catalog
  add column if not exists sub_category text not null default '';
alter table public.carpet_catalog
  add column if not exists default_sims_location text not null default '';
alter table public.carpet_catalog
  add column if not exists sqft_per_box numeric(12, 4);

alter table public.carpet_audits
  add column if not exists category text not null default 'Carpet';
alter table public.carpet_audits
  add column if not exists sub_category text not null default '';
alter table public.carpet_audits
  add column if not exists sims_location text not null default '';
alter table public.carpet_audits
  add column if not exists box_count numeric(12, 3);
alter table public.carpet_audits
  add column if not exists calculated_sqft numeric(12, 4);

-- Allow rounds = 0 for carton / unit audits (roll goods still use rounds > 0 in app)
alter table public.carpet_audits
  drop constraint if exists carpet_audits_rounds_check;

alter table public.carpet_audits
  add constraint carpet_audits_rounds_check check (rounds >= 0);

alter table public.carpet_remnants
  add column if not exists category text not null default 'Carpet';

create index if not exists carpet_catalog_category_idx
  on public.carpet_catalog (category);
create index if not exists carpet_catalog_sub_category_idx
  on public.carpet_catalog (category, sub_category);
create index if not exists carpet_catalog_sims_location_idx
  on public.carpet_catalog (default_sims_location);
create index if not exists carpet_audits_sims_location_idx
  on public.carpet_audits (sims_location);
create index if not exists carpet_audits_category_idx
  on public.carpet_audits (category);
create index if not exists carpet_audits_sub_category_idx
  on public.carpet_audits (category, sub_category);
create index if not exists carpet_audits_sku_idx
  on public.carpet_audits (sku);

-- Department-scoped RBAC columns (before dept-aware seeds)
alter table public.store_specialists
  drop constraint if exists store_specialists_role_check;

alter table public.store_specialists
  add constraint store_specialists_role_check
  check (role in ('Associate', 'Supervisor', 'MasterAdmin', 'Specialist'));

alter table public.store_specialists
  add column if not exists username text;

alter table public.store_specialists
  add column if not exists assigned_department text;

alter table public.store_specialists
  add column if not exists must_change_credentials boolean not null default false;

alter table public.store_specialists
  add column if not exists is_active boolean not null default true;

update public.store_specialists
set is_active = true
where is_active is null;

create index if not exists store_specialists_is_active_idx
  on public.store_specialists (store_number, is_active);

-- Normalize legacy Department Supervisor → Flooring Supervisor
update public.store_specialists
set
  name = 'Flooring Supervisor',
  assigned_department = coalesce(assigned_department, 'flooring')
where role = 'Supervisor'
  and lower(name) in ('department supervisor', 'dept supervisor', 'flooring supervisor');

-- Seed Flooring Supervisor for default store if missing
insert into public.store_specialists (
  name, role, pin_code, store_number, assigned_department, must_change_credentials
)
select 'Flooring Supervisor', 'Supervisor', '1234', '1234', 'flooring', false
where not exists (
  select 1 from public.store_specialists
  where role = 'Supervisor' and store_number = '1234'
    and coalesce(assigned_department, 'flooring') = 'flooring'
);

-- Seed Master Admin
insert into public.store_specialists (
  name, role, pin_code, store_number, username, assigned_department, must_change_credentials
)
select 'Master Admin', 'MasterAdmin', '1234', '1234', 'master_admin', 'all', false
where not exists (
  select 1 from public.store_specialists
  where role = 'MasterAdmin' and store_number = '1234'
);

-- Seed Amber (Appliances Supervisor) with first-login credential force
insert into public.store_specialists (
  name, role, pin_code, store_number, username, assigned_department, must_change_credentials
)
select
  'Amber',
  'Supervisor',
  'ChangeMe123',
  '1234',
  'amber_appliance',
  'appliances',
  true
where not exists (
  select 1 from public.store_specialists
  where store_number = '1234'
    and (
      lower(username) = 'amber_appliance'
      or (role = 'Supervisor' and coalesce(assigned_department, '') = 'appliances')
    )
);

create index if not exists store_specialists_username_idx
  on public.store_specialists (store_number, username);

-- RLS
alter table public.carpet_audits enable row level security;
alter table public.carpet_catalog enable row level security;
alter table public.carpet_remnants enable row level security;
alter table public.store_specialists enable row level security;

drop policy if exists "Allow anon read carpet_audits" on public.carpet_audits;
drop policy if exists "Allow anon insert carpet_audits" on public.carpet_audits;
drop policy if exists "Allow anon delete carpet_audits" on public.carpet_audits;
drop policy if exists "Allow anon all carpet_audits" on public.carpet_audits;
drop policy if exists "Allow anon all carpet_catalog" on public.carpet_catalog;
drop policy if exists "Allow anon all carpet_remnants" on public.carpet_remnants;
drop policy if exists "Allow anon all store_specialists" on public.store_specialists;
drop policy if exists "Allow delete and update for store_specialists" on public.store_specialists;

-- Hub currently filters by store_number in the client (.eq).
-- Policies remain open for anon until per-store JWT claims are introduced.
create policy "Allow anon all carpet_audits"
  on public.carpet_audits for all to anon using (true) with check (true);

create policy "Allow anon all carpet_catalog"
  on public.carpet_catalog for all to anon using (true) with check (true);

create policy "Allow anon all carpet_remnants"
  on public.carpet_remnants for all to anon using (true) with check (true);

create policy "Allow anon all store_specialists"
  on public.store_specialists for all to anon using (true) with check (true);

-- Explicit update/delete coverage for soft-delete + hard-delete fallbacks
create policy "Allow delete and update for store_specialists"
  on public.store_specialists for all to anon using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Store Operations (multi-dept map + weekly rotations + auth.users RBAC)
-- Apply: supabase/migrations/20260809_store_operations_rbac.sql
-- Web Push: supabase/migrations/20260809_push_notifications.sql
-- Weekly cron targets: supabase/migrations/20260809_weekly_rotation_cron.sql
-- Verification exceptions: supabase/migrations/20260809_rotation_verification.sql
-- Supervisor invite: supabase/migrations/20260810_supervisor_invite.sql
-- Roster invite hash + status: supabase/migrations/20260815_roster_invite_onboarding.sql
-- ---------------------------------------------------------------------------

alter table public.store_specialists
  add column if not exists invite_token uuid;

alter table public.store_specialists
  add column if not exists invite_token_expires_at timestamptz;

alter table public.store_specialists
  add column if not exists must_change_pin boolean not null default false;

alter table public.store_specialists
  add column if not exists temp_pin_hash text;

alter table public.store_specialists
  add column if not exists phone_number text;

create unique index if not exists store_specialists_invite_token_uidx
  on public.store_specialists (invite_token)
  where invite_token is not null;

alter table public.store_specialists
  add column if not exists status text not null default 'active';

alter table public.store_specialists
  add column if not exists invite_token_hash text;

alter table public.store_specialists
  add column if not exists invite_consumed_at timestamptz;

alter table public.store_specialists
  add column if not exists auth_token_hash text;

alter table public.store_specialists
  add column if not exists auth_token_expires_at timestamptz;

alter table public.store_specialists
  add column if not exists pin_hash text;

alter table public.store_specialists
  add column if not exists pin_updated_at timestamptz;

update public.store_specialists
set pin_updated_at = coalesce(pin_updated_at, created_at, now())
where pin_updated_at is null
  and (
    pin_hash is not null
    or (pin_code is not null and btrim(pin_code) <> '')
  );

create unique index if not exists store_specialists_invite_token_hash_uidx
  on public.store_specialists (invite_token_hash)
  where invite_token_hash is not null;


-- ---------------------------------------------------------------------------
-- Appliance catalog + floor scans (separate ownership from carpet_*)
-- Apply: supabase/migrations/20260810_appliance_catalog_scans.sql
-- ---------------------------------------------------------------------------

create table if not exists public.appliance_catalog (
  id uuid primary key default gen_random_uuid(),
  store_number text not null default '0000',
  item_number text not null,
  upc text,
  description text not null default '',
  category text not null default 'Laundry',
  sub_category text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists appliance_catalog_store_item_uidx
  on public.appliance_catalog (store_number, item_number);

create index if not exists appliance_catalog_upc_idx
  on public.appliance_catalog (upc)
  where upc is not null;

create index if not exists appliance_catalog_category_idx
  on public.appliance_catalog (category, sub_category);

create table if not exists public.appliance_scans (
  id uuid primary key default gen_random_uuid(),
  store_number text not null default '0000',
  item_number text not null,
  serial_number text not null default '',
  location text not null default '',
  category text not null default 'Laundry',
  sub_category text not null default '',
  scanned_by text not null default '',
  scanned_at timestamptz not null default now()
);

create index if not exists appliance_scans_scanned_at_idx
  on public.appliance_scans (scanned_at desc);

create index if not exists appliance_scans_store_idx
  on public.appliance_scans (store_number, scanned_at desc);

create index if not exists appliance_scans_item_idx
  on public.appliance_scans (item_number);

create index if not exists appliance_scans_category_idx
  on public.appliance_scans (category, sub_category);

alter table public.appliance_catalog enable row level security;
alter table public.appliance_scans enable row level security;

drop policy if exists "anon_all_appliance_catalog" on public.appliance_catalog;
create policy "anon_all_appliance_catalog"
  on public.appliance_catalog for all to anon using (true) with check (true);

drop policy if exists "anon_all_appliance_scans" on public.appliance_scans;
create policy "anon_all_appliance_scans"
  on public.appliance_scans for all to anon using (true) with check (true);

-- P0 list-path composite indexes (see supabase/migrations/20260813_p0_query_indexes.sql)
create index if not exists carpet_audits_store_created_at_idx
  on public.carpet_audits (store_number, created_at desc);
create index if not exists carpet_remnants_store_updated_at_idx
  on public.carpet_remnants (store_number, updated_at desc);
