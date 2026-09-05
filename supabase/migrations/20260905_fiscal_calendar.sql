-- FS-001 Fiscal calendar foundation.
-- Parallel to ISO rotation weeks (weekly_rotations.assigned_week).
-- Authoritative imported FY/weeks only — does not invent missing periods.
-- Global shared reference data (not store-duplicated). Writes via service role.

create extension if not exists "pgcrypto";

create table if not exists public.fiscal_years (
  id uuid primary key default gen_random_uuid(),
  fiscal_year integer not null,
  start_date date not null,
  end_date date not null,
  week_count integer not null,
  source_type text not null,
  source_reference text,
  source_year integer,
  declared_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fiscal_years_year_unique unique (fiscal_year),
  constraint fiscal_years_week_count_check
    check (week_count in (52, 53)),
  constraint fiscal_years_date_order_check
    check (start_date <= end_date),
  constraint fiscal_years_source_type_check
    check (source_type in ('COMPANY_PUBLISHED', 'MASTER_ADMIN_DECLARED'))
);

comment on table public.fiscal_years is
  'Authoritative retail fiscal years (4-5-4). Imported facts only — not derived drafts.';

comment on column public.fiscal_years.source_type is
  'COMPANY_PUBLISHED | MASTER_ADMIN_DECLARED — provenance for accepted calendar authority.';

create table if not exists public.fiscal_weeks (
  id uuid primary key default gen_random_uuid(),
  fiscal_year_id uuid not null
    references public.fiscal_years (id)
    on delete cascade,
  fiscal_week integer not null,
  fiscal_quarter integer not null,
  fiscal_period integer not null,
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now(),
  constraint fiscal_weeks_year_week_unique unique (fiscal_year_id, fiscal_week),
  constraint fiscal_weeks_week_range_check
    check (fiscal_week >= 1),
  constraint fiscal_weeks_quarter_check
    check (fiscal_quarter between 1 and 4),
  constraint fiscal_weeks_period_check
    check (fiscal_period between 1 and 12),
  constraint fiscal_weeks_date_order_check
    check (start_date <= end_date)
);

comment on table public.fiscal_weeks is
  'Authoritative fiscal weeks within a fiscal year. fiscal_period = retail 4-5-4 period (1..12), not Gregorian month.';

comment on column public.fiscal_weeks.fiscal_period is
  'Retail fiscal period 1–12 (4-5-4). Not a Gregorian calendar month.';

create index if not exists fiscal_weeks_date_range_idx
  on public.fiscal_weeks (start_date, end_date);

create index if not exists fiscal_weeks_year_id_idx
  on public.fiscal_weeks (fiscal_year_id);

alter table public.fiscal_years enable row level security;
alter table public.fiscal_weeks enable row level security;

drop policy if exists "Authenticated read fiscal years" on public.fiscal_years;
drop policy if exists "Authenticated read fiscal weeks" on public.fiscal_weeks;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise notice 'fiscal_calendar: skipping RLS policies (authenticated role absent)';
    return;
  end if;

  -- Shared company/store operational context: any authenticated actor may read.
  -- Mutations are service-role only (no authenticated write policies).
  execute $policy$
    create policy "Authenticated read fiscal years"
      on public.fiscal_years
      for select
      to authenticated
      using (true)
  $policy$;

  execute $policy$
    create policy "Authenticated read fiscal weeks"
      on public.fiscal_weeks
      for select
      to authenticated
      using (true)
  $policy$;
end $$;

notify pgrst, 'reload schema';
