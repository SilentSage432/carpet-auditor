-- carpet_audits table for Carpet Roll Auditor
-- Run this in the Supabase SQL editor.

create extension if not exists "pgcrypto";

create table if not exists public.carpet_audits (
  id uuid primary key default gen_random_uuid(),
  sku text not null,
  location text not null check (location in ('sales_floor', 'top_stock')),
  whole_inches integer not null check (whole_inches >= 0),
  fraction numeric(4, 3) not null check (fraction >= 0 and fraction < 1),
  measurement_inches numeric(8, 3) not null,
  rounds integer not null check (rounds > 0),
  clf numeric(12, 4) not null,
  created_at timestamptz not null default now()
);

create index if not exists carpet_audits_created_at_idx
  on public.carpet_audits (created_at desc);

alter table public.carpet_audits enable row level security;

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
