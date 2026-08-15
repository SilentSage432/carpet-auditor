-- Daily associate shift board (schedule + call-out)
-- LocalStorage fallback lives in lib/store-ops/shift-status.ts until applied.

create extension if not exists "pgcrypto";

create table if not exists public.associate_shift_days (
  id uuid primary key default gen_random_uuid(),
  store_number text not null,
  specialist_id text not null,
  work_date date not null,
  start_time text,
  end_time text,
  is_scheduled_today boolean not null default true,
  is_call_out boolean not null default false,
  status text not null default 'ON_DUTY'
    check (status in ('ON_DUTY', 'ABSENT_CALLOUT', 'OFF')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_number, specialist_id, work_date)
);

create index if not exists associate_shift_days_store_date_idx
  on public.associate_shift_days (store_number, work_date);

comment on table public.associate_shift_days is
  'Per-day on-duty / call-out / shift clock for hub roster members';

alter table public.associate_shift_days enable row level security;

drop policy if exists "Enforce Store Isolation"
  on public.associate_shift_days;

do $$
begin
  if exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'jwt_matches_store'
  ) then
    execute $policy$
      create policy "Enforce Store Isolation"
        on public.associate_shift_days
        for all
        to authenticated
        using (public.jwt_matches_store(associate_shift_days.store_number))
        with check (public.jwt_matches_store(associate_shift_days.store_number));
    $policy$;
  else
    execute $policy$
      create policy "Enforce Store Isolation"
        on public.associate_shift_days
        for all
        to authenticated
        using (
          store_number = (auth.jwt() -> 'app_metadata' ->> 'store_number')
        )
        with check (
          store_number = (auth.jwt() -> 'app_metadata' ->> 'store_number')
        );
    $policy$;
  end if;
end $$;
