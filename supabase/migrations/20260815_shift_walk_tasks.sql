-- Floor-walk Copilot tasks dispatched to the shift board
-- Depends on JWT store/department helpers when present (20260812_jwt_rls_policies.sql)

create extension if not exists "pgcrypto";

create table if not exists public.shift_walk_tasks (
  id text primary key,
  store_number text not null,
  department text not null default 'flooring',
  assigned_week text not null,
  title text not null,
  location_tag text not null default 'General',
  category text not null default 'GENERAL',
  priority text not null default 'P3_ROUTINE',
  target_window text not null default 'POWER_HOURS',
  suggested_assignee text,
  assignee_id text,
  assignee_name text,
  status text not null default 'open',
  location_id text,
  rotation_id text,
  source text not null default 'voice_walk',
  transcript text,
  created_at timestamptz not null default now(),
  dispatched_at timestamptz,
  resolved_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists shift_walk_tasks_store_week_idx
  on public.shift_walk_tasks (store_number, assigned_week, department)
  where resolved_at is null;

comment on table public.shift_walk_tasks is
  'Voice / scratchpad floor-walk tasks dispatched onto the shift board';

alter table public.shift_walk_tasks enable row level security;

drop policy if exists "Enforce Store and Department Isolation"
  on public.shift_walk_tasks;

do $$
begin
  if exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'jwt_matches_store'
  ) then
    execute $policy$
      create policy "Enforce Store and Department Isolation"
        on public.shift_walk_tasks
        for all
        to authenticated
        using (
          public.jwt_matches_store(shift_walk_tasks.store_number)
          and public.jwt_matches_department_code(shift_walk_tasks.department)
        )
        with check (
          public.jwt_matches_store(shift_walk_tasks.store_number)
          and public.jwt_matches_department_code(shift_walk_tasks.department)
        )
    $policy$;
  else
    execute $policy$
      create policy "Enforce Store and Department Isolation"
        on public.shift_walk_tasks
        for all
        to authenticated
        using (
          store_number = (auth.jwt() -> 'app_metadata' ->> 'store_number')
        )
        with check (
          store_number = (auth.jwt() -> 'app_metadata' ->> 'store_number')
        )
    $policy$;
  end if;
end $$;
