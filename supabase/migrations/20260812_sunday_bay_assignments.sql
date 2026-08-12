-- Phase 2 — Sunday specialist bay assignments (durable, JWT-scoped)
-- Depends on: 20260809_store_operations_rbac (profiles), 20260812_jwt_rls_policies helpers

create extension if not exists "pgcrypto";

create table if not exists public.sunday_bay_assignments (
  id uuid primary key default gen_random_uuid(),
  store_number text not null,
  department text not null,
  week_starting date not null,
  bay_id text not null,
  assigned_specialist_id uuid references public.profiles (id) on delete set null,
  -- Hub roster bridge (store_specialists.id) — UI assigns by roster until Auth profile linked
  roster_specialist_id text,
  specialist_name text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'assigned', 'completed', 'cleared')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_number, department, week_starting, bay_id)
);

create index if not exists sunday_bay_assignments_store_week_idx
  on public.sunday_bay_assignments (store_number, week_starting);

create index if not exists sunday_bay_assignments_dept_idx
  on public.sunday_bay_assignments (store_number, department, week_starting);

create index if not exists sunday_bay_assignments_specialist_idx
  on public.sunday_bay_assignments (assigned_specialist_id);

create index if not exists sunday_bay_assignments_roster_idx
  on public.sunday_bay_assignments (roster_specialist_id);

create or replace function public.sunday_bay_assignments_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sunday_bay_assignments_set_updated_at
  on public.sunday_bay_assignments;
create trigger sunday_bay_assignments_set_updated_at
  before update on public.sunday_bay_assignments
  for each row
  execute function public.sunday_bay_assignments_set_updated_at();

comment on table public.sunday_bay_assignments is
  'Sunday Flooring cycle audit specialist↔bay assignments (bay_id = weekly_rotations.id)';

comment on column public.sunday_bay_assignments.bay_id is
  'weekly_rotations.id (text) for the staged bay row';

comment on column public.sunday_bay_assignments.roster_specialist_id is
  'store_specialists.id used by hub roster UI; assigned_specialist_id set when profiles.specialist_id matches';

alter table public.sunday_bay_assignments enable row level security;

drop policy if exists "Enforce Store and Department Isolation"
  on public.sunday_bay_assignments;

create policy "Enforce Store and Department Isolation"
  on public.sunday_bay_assignments
  for all
  to authenticated
  using (
    store_number = (auth.jwt() -> 'app_metadata' ->> 'store_number')
    and (
      department = (auth.jwt() -> 'app_metadata' ->> 'department')
      or (auth.jwt() -> 'app_metadata' ->> 'role') in ('master_admin', 'store_manager', 'super_admin')
    )
  )
  with check (
    store_number = (auth.jwt() -> 'app_metadata' ->> 'store_number')
    and (
      department = (auth.jwt() -> 'app_metadata' ->> 'department')
      or (auth.jwt() -> 'app_metadata' ->> 'role') in ('master_admin', 'store_manager', 'super_admin')
    )
  );
