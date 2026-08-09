-- Web Push subscriptions for weekly rotation alerts on personal phones.
-- Depends on: supabase/migrations/20260809_store_operations_rbac.sql (profiles)

create extension if not exists "pgcrypto";

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete cascade,
  -- DeptSync hub bridge (PIN/roster auth) until Supabase Auth profiles are fully wired
  specialist_id text,
  department_code text,
  endpoint text not null unique,
  subscription_json jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);

create index if not exists push_subscriptions_specialist_id_idx
  on public.push_subscriptions (specialist_id);

create index if not exists push_subscriptions_department_code_idx
  on public.push_subscriptions (department_code);

alter table public.push_subscriptions enable row level security;

drop policy if exists "Users can manage their own push subscriptions"
  on public.push_subscriptions;

create policy "Users can manage their own push subscriptions"
  on public.push_subscriptions
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Service role (DeptSync API routes) bypasses RLS by default.
