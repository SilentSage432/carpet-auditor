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
  created_at timestamptz not null default now()
);

create index if not exists carpet_audits_created_at_idx
  on public.carpet_audits (created_at desc);

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

-- Migration for existing projects
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists carpet_remnants_status_idx on public.carpet_remnants (status);
create index if not exists carpet_remnants_tag_idx on public.carpet_remnants (tag_number);

-- RLS
alter table public.carpet_audits enable row level security;
alter table public.carpet_catalog enable row level security;
alter table public.carpet_remnants enable row level security;

drop policy if exists "Allow anon read carpet_audits" on public.carpet_audits;
drop policy if exists "Allow anon insert carpet_audits" on public.carpet_audits;
drop policy if exists "Allow anon delete carpet_audits" on public.carpet_audits;
drop policy if exists "Allow anon all carpet_catalog" on public.carpet_catalog;
drop policy if exists "Allow anon all carpet_remnants" on public.carpet_remnants;

create policy "Allow anon read carpet_audits"
  on public.carpet_audits for select to anon using (true);
create policy "Allow anon insert carpet_audits"
  on public.carpet_audits for insert to anon with check (true);
create policy "Allow anon delete carpet_audits"
  on public.carpet_audits for delete to anon using (true);

create policy "Allow anon all carpet_catalog"
  on public.carpet_catalog for all to anon using (true) with check (true);

create policy "Allow anon all carpet_remnants"
  on public.carpet_remnants for all to anon using (true) with check (true);
