-- Disposable harness for SECTION-ROTATION-005 local DB validation.
-- NOT for production. Creates minimal parents for the approval + capacity RPC.

begin;

create extension if not exists "pgcrypto";

create schema if not exists auth;
create or replace function auth.role() returns text language sql as $$ select 'service_role'::text $$;
create or replace function auth.jwt() returns jsonb language sql as $$ select '{}'::jsonb $$;

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  store_number text not null unique
);

create table if not exists public.store_specialists (
  id text primary key,
  store_number text not null,
  name text not null,
  role text not null default 'Associate',
  is_active boolean not null default true
);

create table if not exists public.associate_shift_days (
  id uuid primary key default gen_random_uuid(),
  store_number text not null,
  specialist_id text not null,
  work_date date not null,
  start_time text,
  end_time text,
  is_scheduled_today boolean not null default true,
  is_call_out boolean not null default false,
  status text not null default 'ON_DUTY',
  unique (store_number, specialist_id, work_date)
);

create table if not exists public.sunday_bay_assignments (
  id uuid primary key default gen_random_uuid(),
  store_number text not null,
  department text not null,
  week_starting date not null,
  bay_id text not null,
  assigned_specialist_id uuid null,
  roster_specialist_id text null,
  specialist_name text not null default '',
  status text not null default 'assigned',
  is_carried_over boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (store_number, department, week_starting, bay_id)
);

do $$
begin
  if to_regprocedure('public.jwt_matches_store(text)') is null then
    execute $fn$
      create function public.jwt_matches_store(p_store text)
      returns boolean language sql stable as $body$
        select true
      $body$
    $fn$;
  end if;
end $$;

commit;
