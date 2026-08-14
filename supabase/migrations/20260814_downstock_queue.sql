-- Downstock / packdown queue (Zebra overhead pulls)
-- Depends on JWT store/department helpers when present (20260812_jwt_rls_policies.sql)

create extension if not exists "pgcrypto";

create table if not exists public.downstock_queue (
  id uuid primary key default gen_random_uuid(),
  store_number text not null,
  department text not null default 'flooring',
  assigned_week text not null,
  rotation_id text not null,
  location_id text,
  note text not null default '',
  flagged_by text,
  flagged_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_number, department, assigned_week, rotation_id)
);

create index if not exists downstock_queue_store_week_idx
  on public.downstock_queue (store_number, assigned_week)
  where resolved_at is null;

comment on table public.downstock_queue is
  'Zebra downstock/packdown flags (rotation_id = weekly_rotations.id)';

alter table public.downstock_queue enable row level security;

drop policy if exists "Enforce Store and Department Isolation"
  on public.downstock_queue;

do $$
begin
  if exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'jwt_matches_store'
  ) then
    execute $policy$
      create policy "Enforce Store and Department Isolation"
        on public.downstock_queue
        for all
        to authenticated
        using (
          public.jwt_matches_store(downstock_queue.store_number)
          and public.jwt_matches_department_code(downstock_queue.department)
        )
        with check (
          public.jwt_matches_store(downstock_queue.store_number)
          and public.jwt_matches_department_code(downstock_queue.department)
        )
    $policy$;
  else
    execute $policy$
      create policy "Enforce Store and Department Isolation"
        on public.downstock_queue
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
