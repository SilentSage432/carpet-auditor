-- carpet_audits table for Carpet Cycle Count Auditor
-- Run this in the Supabase SQL editor.

create extension if not exists "pgcrypto";

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

alter table public.carpet_audits enable row level security;

-- Idempotent policy recreate for fresh projects
drop policy if exists "Allow anon read carpet_audits" on public.carpet_audits;
drop policy if exists "Allow anon insert carpet_audits" on public.carpet_audits;
drop policy if exists "Allow anon delete carpet_audits" on public.carpet_audits;

create policy "Allow anon read carpet_audits"
  on public.carpet_audits for select
  to anon
  using (true);

create policy "Allow anon insert carpet_audits"
  on public.carpet_audits for insert
  to anon
  with check (true);

create policy "Allow anon delete carpet_audits"
  on public.carpet_audits for delete
  to anon
  using (true);

-- Migration helper if an older schema already exists:
-- alter table public.carpet_audits rename column location to location_type;
-- alter table public.carpet_audits rename column fraction to measurement_fraction;
-- alter table public.carpet_audits rename column clf to calculated_clf;
-- alter table public.carpet_audits rename column whole_inches to measurement_inches;
-- alter table public.carpet_audits add column if not exists carpet_name text not null default '';
