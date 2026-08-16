-- Read/write contract parity:
-- 1) Digit-equal store match (2587 ≡ 02587) for JWT RLS.
-- 2) Lowe's / hub department aliases (flooring ≡ D23) for JWT RLS.
-- 3) Authenticated SELECT on carpet_* (Hub-bridge is authenticated, not anon).
-- 4) Open SELECT on Store Ops tables that already have INSERT via FOR ALL.
-- 5) sunday_bay_assignments.status allows CARRIED_OVER (writer already emits it).

-- ---------------------------------------------------------------------------
-- Store number: ignore leading zeros
-- ---------------------------------------------------------------------------
create or replace function public.jwt_matches_store(p_store_number text)
returns boolean
language sql
stable
as $$
  select
    public.jwt_store_number() is not null
    and p_store_number is not null
    and nullif(ltrim(public.jwt_store_number(), '0'), '')
      = nullif(ltrim(p_store_number, '0'), '');
$$;

-- ---------------------------------------------------------------------------
-- Department aliases
-- ---------------------------------------------------------------------------
create or replace function public.department_codes_equivalent(a text, b text)
returns boolean
language sql
immutable
as $$
  select a is not null and b is not null and (
    a = b
    or lower(trim(a)) = lower(trim(b))
    or (
      lower(trim(a)) in ('flooring', 'd23')
      and lower(trim(b)) in ('flooring', 'd23')
    )
    or (
      lower(trim(a)) in ('appliances', 'd35')
      and lower(trim(b)) in ('appliances', 'd35')
    )
    or (
      lower(trim(a)) in ('plumbing', 'd26')
      and lower(trim(b)) in ('plumbing', 'd26')
    )
    or (
      lower(trim(a)) in ('electrical', 'd24')
      and lower(trim(b)) in ('electrical', 'd24')
    )
    or (
      lower(trim(a)) in ('paint', 'd24p')
      and lower(trim(b)) in ('paint', 'd24p')
    )
    or (
      lower(trim(a)) in ('millwork', 'd30')
      and lower(trim(b)) in ('millwork', 'd30')
    )
    or (
      lower(trim(a)) in ('cabinets', 'd29')
      and lower(trim(b)) in ('cabinets', 'd29')
    )
    or (
      lower(trim(a)) in ('tools', 'hardware', 'd25')
      and lower(trim(b)) in ('tools', 'hardware', 'd25')
    )
    or (
      lower(trim(a)) in ('inside_garden', 'lawn_garden', 'd28i', 'd28')
      and lower(trim(b)) in ('inside_garden', 'lawn_garden', 'd28i', 'd28')
    )
    or (
      lower(trim(a)) in ('outside_garden', 'd28o')
      and lower(trim(b)) in ('outside_garden', 'd28o')
    )
    or (
      lower(trim(a)) in ('building_materials', 'd21')
      and lower(trim(b)) in ('building_materials', 'd21')
    )
  );
$$;

create or replace function public.jwt_matches_department_code(p_code text)
returns boolean
language sql
stable
as $$
  select
    public.jwt_is_elevated()
    or (
      p_code is not null
      and (
        public.department_codes_equivalent(public.jwt_department(), p_code)
        or exists (
          select 1
          from jsonb_array_elements_text(
            coalesce(
              auth.jwt() -> 'app_metadata' -> 'accessible_departments',
              '[]'::jsonb
            )
          ) as granted(code)
          where public.department_codes_equivalent(granted.code, p_code)
        )
      )
    );
$$;

-- ---------------------------------------------------------------------------
-- sunday_bay_assignments.status — writer emits CARRIED_OVER
-- ---------------------------------------------------------------------------
alter table if exists public.sunday_bay_assignments
  drop constraint if exists sunday_bay_assignments_status_check;

alter table if exists public.sunday_bay_assignments
  add constraint sunday_bay_assignments_status_check
  check (
    status in (
      'pending',
      'assigned',
      'completed',
      'cleared',
      'CARRIED_OVER',
      'PENDING',
      'ASSIGNED',
      'COMPLETED'
    )
  );

-- ---------------------------------------------------------------------------
-- Open SELECT for tables that already allow INSERT (FOR ALL / insert policies)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  tables text[] := array[
    'weekly_rotations',
    'sunday_bay_assignments',
    'bay_service_logs',
    'downstock_queue',
    'shift_walk_tasks',
    'associate_shift_days',
    'rotation_exceptions',
    'carpet_audits',
    'carpet_catalog',
    'carpet_remnants',
    'appliance_catalog',
    'appliance_scans',
    'store_locations'
  ];
begin
  foreach t in array tables
  loop
    if exists (
      select 1 from pg_tables
      where schemaname = 'public' and tablename = t
    ) then
      execute format('alter table public.%I enable row level security', t);
      execute format('grant select on public.%I to anon, authenticated', t);
      execute format(
        'drop policy if exists %I on public.%I',
        'Allow read access for ' || t,
        t
      );
      execute format(
        'create policy %I on public.%I for select to anon, authenticated using (true)',
        'Allow read access for ' || t,
        t
      );
    end if;
  end loop;
end $$;
