-- Enable Row Level Security on flagged public tables and verify coverage.
-- Flagged (Supabase advisor / missing from migration path):
--   public.appliance_catalog
--   public.appliance_scans
--   public.store_specialists
--
-- Note: schema.sql already declared RLS for these on greenfield installs;
-- the appliance migration created tables without ENABLE RLS, and roster
-- RLS lived only in schema.sql — this migration closes that gap on live DBs.

-- ---------------------------------------------------------------------------
-- 1) Flagged tables
-- ---------------------------------------------------------------------------
alter table if exists public.appliance_catalog enable row level security;
alter table if exists public.appliance_scans enable row level security;
alter table if exists public.store_specialists enable row level security;

-- Hub client still uses the anon key for roster / appliance surfaces.
-- Keep permissive anon policies (same posture as schema.sql) so enabling RLS
-- does not lock out the floor PWA until JWT policies replace them.
do $$
begin
  if to_regclass('public.appliance_catalog') is not null then
    drop policy if exists "anon_all_appliance_catalog" on public.appliance_catalog;
    create policy "anon_all_appliance_catalog"
      on public.appliance_catalog for all to anon
      using (true) with check (true);

    drop policy if exists "authenticated_all_appliance_catalog" on public.appliance_catalog;
    create policy "authenticated_all_appliance_catalog"
      on public.appliance_catalog for all to authenticated
      using (true) with check (true);
  end if;

  if to_regclass('public.appliance_scans') is not null then
    drop policy if exists "anon_all_appliance_scans" on public.appliance_scans;
    create policy "anon_all_appliance_scans"
      on public.appliance_scans for all to anon
      using (true) with check (true);

    drop policy if exists "authenticated_all_appliance_scans" on public.appliance_scans;
    create policy "authenticated_all_appliance_scans"
      on public.appliance_scans for all to authenticated
      using (true) with check (true);
  end if;

  if to_regclass('public.store_specialists') is not null then
    drop policy if exists "Allow anon all store_specialists" on public.store_specialists;
    create policy "Allow anon all store_specialists"
      on public.store_specialists for all to anon
      using (true) with check (true);

    drop policy if exists "Allow delete and update for store_specialists" on public.store_specialists;
    create policy "Allow delete and update for store_specialists"
      on public.store_specialists for all to anon
      using (true) with check (true);

    drop policy if exists "Allow authenticated all store_specialists" on public.store_specialists;
    create policy "Allow authenticated all store_specialists"
      on public.store_specialists for all to authenticated
      using (true) with check (true);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Verify / enable RLS on every public base table
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  missing text[] := array[]::text[];
begin
  for r in
    select c.relname as tablename
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r' -- ordinary tables only (not views / partitions parents)
      and not c.relrowsecurity
    order by c.relname
  loop
    execute format(
      'alter table public.%I enable row level security',
      r.tablename
    );
    raise notice 'Enabled RLS on public.%', r.tablename;
  end loop;

  select coalesce(array_agg(c.relname order by c.relname), array[]::text[])
  into missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not c.relrowsecurity;

  if coalesce(array_length(missing, 1), 0) > 0 then
    raise exception
      'RLS verification failed — public tables still missing ENABLE ROW LEVEL SECURITY: %',
      array_to_string(missing, ', ');
  end if;

  raise notice 'RLS verification passed — all public base tables have row level security enabled';
end $$;
