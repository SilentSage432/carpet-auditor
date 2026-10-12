-- Disposable harness for REGISTRY-002 local validation.
-- Creates minimal parent tables expected by 20261015_store_aisles_registry.sql.
-- NOT for production. Applied only to ephemeral local databases.

begin;

create extension if not exists "pgcrypto";

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  store_number text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  name text not null,
  code text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Minimal bay table (subset of production store_locations).
create table if not exists public.store_locations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete restrict,
  aisle text not null,
  bay integer not null check (bay >= 0),
  type text not null default 'SELLING',
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (department_id, aisle, bay, type)
);

commit;
