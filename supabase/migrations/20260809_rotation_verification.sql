-- End-of-week verification exceptions + carried-over bay status
-- Depends on: store_operations_rbac + weekly_rotation_cron migrations

-- Add CARRIED_OVER to rotation_status (Postgres 15+ supports IF NOT EXISTS)
do $$ begin
  alter type public.rotation_status add value if not exists 'CARRIED_OVER';
exception
  when duplicate_object then null;
end $$;

create table if not exists public.rotation_exceptions (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete cascade,
  bay_id uuid not null references public.store_locations (id) on delete cascade,
  reason text not null,
  cycle_number integer not null default 1 check (cycle_number >= 1),
  assigned_week text,
  reported_by text,
  created_at timestamptz not null default now()
);

create index if not exists rotation_exceptions_department_idx
  on public.rotation_exceptions (department_id, created_at desc);

create index if not exists rotation_exceptions_week_idx
  on public.rotation_exceptions (assigned_week, department_id);

create index if not exists rotation_exceptions_bay_idx
  on public.rotation_exceptions (bay_id);

alter table public.rotation_exceptions enable row level security;

drop policy if exists "super_admin all rotation_exceptions" on public.rotation_exceptions;
drop policy if exists "supervisor read rotation_exceptions" on public.rotation_exceptions;
drop policy if exists "supervisor insert rotation_exceptions" on public.rotation_exceptions;

create policy "super_admin all rotation_exceptions"
  on public.rotation_exceptions for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

create policy "supervisor read rotation_exceptions"
  on public.rotation_exceptions for select
  to authenticated
  using (department_id = public.current_profile_department_id());

create policy "supervisor insert rotation_exceptions"
  on public.rotation_exceptions for insert
  to authenticated
  with check (department_id = public.current_profile_department_id());

-- Optional weekly verification stamp on departments (latest verify week)
alter table public.departments
  add column if not exists last_verified_week text;

alter table public.departments
  add column if not exists last_verified_at timestamptz;
