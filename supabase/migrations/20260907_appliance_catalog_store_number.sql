-- APP-FIELD-001 / APP-FIELD-001A: restore store_number on appliance_catalog.
--
-- Proven production shape (OpenAPI / PostgREST, 2026-09-07):
--   id, item_number, upc, description, category, sub_category, created_at, updated_at
-- Missing: store_number (and store_id). Row count at discovery: 0.
--
-- Why drift existed: an earlier/incomplete appliance_catalog existed without
-- store_number. Canonical 20260810 used CREATE TABLE IF NOT EXISTS, so the
-- missing column was never added. 20260817 RLS lockdown skipped store
-- isolation when store_number was absent.
--
-- Provenance law: store_number is authority. Do NOT invent owning store
-- (including fictional '0000') for unattributed rows. If any row lacks a
-- trustworthy non-blank store_number at apply time, this migration FAILS
-- VISIBLY so humans can remediate — it does not delete or guess ownership.
--
-- Future inserts must supply store_number explicitly (API actor-bound store).
-- No DEFAULT that manufactures store ownership.

alter table public.appliance_catalog
  add column if not exists store_number text;

-- Remove any manufactured default if a prior partial apply set one.
alter table public.appliance_catalog
  alter column store_number drop default;

do $$
declare
  unattributed integer;
begin
  select count(*)::integer
    into unattributed
  from public.appliance_catalog
  where store_number is null
     or btrim(store_number) = '';

  if unattributed > 0 then
    raise exception
      'APP-FIELD-001A: % appliance_catalog row(s) lack trustworthy store_number. Refusing fictional store assignment (including 0000). Remediate ownership explicitly, then re-run.',
      unattributed;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'appliance_catalog'
      and column_name = 'store_number'
      and is_nullable = 'YES'
  ) then
    alter table public.appliance_catalog
      alter column store_number set not null;
  end if;
end $$;

create unique index if not exists appliance_catalog_store_item_uidx
  on public.appliance_catalog (store_number, item_number);

create index if not exists appliance_catalog_upc_idx
  on public.appliance_catalog (upc)
  where upc is not null;

-- Restore store-scope RLS now that store_number exists.
alter table public.appliance_catalog enable row level security;

do $$
declare
  r record;
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise notice 'APP-FIELD-001A: skipping catalog RLS (authenticated role absent)';
    return;
  end if;

  if to_regprocedure('public.jwt_matches_store(text)') is null then
    raise notice 'APP-FIELD-001A: jwt_matches_store missing — catalog RLS policies skipped (fail-closed)';
    return;
  end if;

  for r in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'appliance_catalog'
  loop
    execute format(
      'drop policy if exists %I on public.appliance_catalog',
      r.policyname
    );
  end loop;

  revoke all on table public.appliance_catalog from anon;
  grant select, insert, update, delete on table public.appliance_catalog to authenticated;

  execute $policy$
    create policy "Enforce Store Isolation on appliance_catalog"
      on public.appliance_catalog
      for all
      to authenticated
      using (public.jwt_matches_store(store_number))
      with check (public.jwt_matches_store(store_number))
  $policy$;
end $$;

notify pgrst, 'reload schema';
