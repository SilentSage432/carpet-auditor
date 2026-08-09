-- Store Operations: multi-department locations, RBAC profiles, weekly rotations
-- Run after supabase/schema.sql (or apply via Supabase CLI migrations).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.user_role as enum ('super_admin', 'department_supervisor');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.location_type as enum ('SELLING', 'TOPSTOCK');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.rotation_status as enum ('PENDING', 'ASSIGNED', 'COMPLETED');
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- Departments (created before profiles FK)
-- ---------------------------------------------------------------------------
create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists departments_code_idx on public.departments (code);

-- Seed Lowe's operational departments (codes align with hub DepartmentScope)
insert into public.departments (name, code)
values
  ('Flooring', 'flooring'),
  ('Appliances', 'appliances'),
  ('Plumbing', 'plumbing'),
  ('Electrical', 'electrical'),
  ('Lawn & Garden', 'lawn_garden'),
  ('Paint', 'paint'),
  ('Millwork', 'millwork'),
  ('Building Materials', 'building_materials'),
  ('Hardware', 'hardware')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Profiles (Supabase Auth → RBAC)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  role public.user_role not null default 'department_supervisor',
  assigned_department_id uuid references public.departments (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists profiles_assigned_department_idx
  on public.profiles (assigned_department_id);

-- Auto-create profile row when a new auth user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email, updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Store locations (aisle / bay map)
-- ---------------------------------------------------------------------------
create table if not exists public.store_locations (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete cascade,
  aisle integer not null check (aisle >= 0),
  bay integer not null check (bay >= 0),
  type public.location_type not null,
  status public.rotation_status not null default 'PENDING',
  last_completed_at timestamptz,
  cycle_number integer not null default 1 check (cycle_number >= 1),
  -- Deactivate without deleting (bulk map toggle); excluded from rotation picks
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, aisle, bay, type)
);

create index if not exists store_locations_department_idx
  on public.store_locations (department_id);
create index if not exists store_locations_pending_pick_idx
  on public.store_locations (department_id, status, cycle_number, is_active);
create index if not exists store_locations_aisle_idx
  on public.store_locations (department_id, aisle, bay);

-- ---------------------------------------------------------------------------
-- Weekly rotations
-- ---------------------------------------------------------------------------
create table if not exists public.weekly_rotations (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete cascade,
  location_id uuid not null references public.store_locations (id) on delete cascade,
  assigned_week text not null, -- ISO week label e.g. "2026-W32"
  is_completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (location_id, assigned_week)
);

create index if not exists weekly_rotations_department_week_idx
  on public.weekly_rotations (department_id, assigned_week);
create index if not exists weekly_rotations_open_idx
  on public.weekly_rotations (department_id, assigned_week, is_completed);

-- ---------------------------------------------------------------------------
-- RLS helpers (security definer so policies can read own profile)
-- ---------------------------------------------------------------------------
create or replace function public.current_profile_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.current_profile_department_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select assigned_department_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'super_admin'
  );
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.departments enable row level security;
alter table public.profiles enable row level security;
alter table public.store_locations enable row level security;
alter table public.weekly_rotations enable row level security;

-- Departments
drop policy if exists "super_admin all departments" on public.departments;
drop policy if exists "supervisor read departments" on public.departments;
drop policy if exists "supervisor update departments" on public.departments;

create policy "super_admin all departments"
  on public.departments for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "supervisor read departments"
  on public.departments for select
  to authenticated
  using (
    id = public.current_profile_department_id()
    or public.is_super_admin()
  );

create policy "supervisor update departments"
  on public.departments for update
  to authenticated
  using (id = public.current_profile_department_id())
  with check (id = public.current_profile_department_id());

-- Profiles
drop policy if exists "super_admin all profiles" on public.profiles;
drop policy if exists "users read own profile" on public.profiles;
drop policy if exists "supervisor update own profile" on public.profiles;

create policy "super_admin all profiles"
  on public.profiles for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "users read own profile"
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or public.is_super_admin());

create policy "supervisor update own profile"
  on public.profiles for update
  to authenticated
  using (
    id = auth.uid()
    and public.current_profile_role() = 'department_supervisor'
  )
  with check (
    id = auth.uid()
    and role = 'department_supervisor'
    and assigned_department_id is not distinct from public.current_profile_department_id()
  );

-- Store locations
drop policy if exists "super_admin all store_locations" on public.store_locations;
drop policy if exists "supervisor read store_locations" on public.store_locations;
drop policy if exists "supervisor update store_locations" on public.store_locations;

create policy "super_admin all store_locations"
  on public.store_locations for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "supervisor read store_locations"
  on public.store_locations for select
  to authenticated
  using (department_id = public.current_profile_department_id());

create policy "supervisor update store_locations"
  on public.store_locations for update
  to authenticated
  using (department_id = public.current_profile_department_id())
  with check (department_id = public.current_profile_department_id());

-- Weekly rotations
drop policy if exists "super_admin all weekly_rotations" on public.weekly_rotations;
drop policy if exists "supervisor read weekly_rotations" on public.weekly_rotations;
drop policy if exists "supervisor update weekly_rotations" on public.weekly_rotations;

create policy "super_admin all weekly_rotations"
  on public.weekly_rotations for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "supervisor read weekly_rotations"
  on public.weekly_rotations for select
  to authenticated
  using (department_id = public.current_profile_department_id());

create policy "supervisor update weekly_rotations"
  on public.weekly_rotations for update
  to authenticated
  using (department_id = public.current_profile_department_id())
  with check (department_id = public.current_profile_department_id());

-- Service role bypasses RLS by default (used by DeptSync API route handlers).
