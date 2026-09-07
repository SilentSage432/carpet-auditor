-- APP-CAT-001A: Many taught scannable identifiers → one canonical item per store.
-- Canonical identity remains (store_number, item_number) on appliance_catalog.
-- Legacy appliance_catalog.upc is retained and dual-read with this table.
-- No identifier_type. No scan/catalog metadata rewrite beyond identifier rows.

create table if not exists public.appliance_catalog_identifiers (
  id uuid primary key default gen_random_uuid(),
  store_number text not null,
  item_number text not null,
  identifier text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appliance_catalog_identifiers_item_fkey
    foreign key (store_number, item_number)
    references public.appliance_catalog (store_number, item_number)
    on delete cascade
);

create unique index if not exists appliance_catalog_identifiers_store_identifier_uidx
  on public.appliance_catalog_identifiers (store_number, identifier);

create index if not exists appliance_catalog_identifiers_store_item_idx
  on public.appliance_catalog_identifiers (store_number, item_number);

comment on table public.appliance_catalog_identifiers is
  'APP-CAT-001A: taught scannable identifiers resolving to canonical (store_number, item_number). Not official Lowe''s ESL semantics.';

comment on column public.appliance_catalog_identifiers.identifier is
  'Taught scan key for resolution. Not necessarily a UPC; type enum deferred.';

-- Fail clearly if same-store duplicate UPC ownership would poison backfill.
do $$
declare
  dup_count integer;
begin
  select count(*)::integer
    into dup_count
  from (
    select store_number, upc
    from public.appliance_catalog
    where upc is not null
      and btrim(upc) <> ''
    group by store_number, upc
    having count(distinct item_number) > 1
  ) d;

  if dup_count > 0 then
    raise exception
      'APP-CAT-001A: % same-store duplicate UPC ownership group(s) found. Refuse arbitrary backfill — remediate appliance_catalog.upc conflicts first.',
      dup_count;
  end if;
end $$;

-- Idempotent backfill: legacy non-null upc → identifier row (same item).
insert into public.appliance_catalog_identifiers (
  store_number,
  item_number,
  identifier,
  created_at,
  updated_at
)
select
  c.store_number,
  c.item_number,
  btrim(c.upc),
  coalesce(c.created_at, now()),
  now()
from public.appliance_catalog c
where c.upc is not null
  and btrim(c.upc) <> ''
on conflict (store_number, identifier) do nothing;

-- If an existing identifier row already maps the upc to a different item, fail.
do $$
declare
  mismatch integer;
begin
  select count(*)::integer
    into mismatch
  from public.appliance_catalog c
  join public.appliance_catalog_identifiers i
    on i.store_number = c.store_number
   and i.identifier = btrim(c.upc)
  where c.upc is not null
    and btrim(c.upc) <> ''
    and i.item_number is distinct from c.item_number;

  if mismatch > 0 then
    raise exception
      'APP-CAT-001A: % legacy upc value(s) already owned by a different identifier row. Refuse silent steal.',
      mismatch;
  end if;
end $$;

alter table public.appliance_catalog_identifiers enable row level security;

do $$
declare
  r record;
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise notice 'APP-CAT-001A: skipping identifiers RLS (authenticated role absent)';
    return;
  end if;

  if to_regprocedure('public.jwt_matches_store(text)') is null then
    raise notice 'APP-CAT-001A: jwt_matches_store missing — identifiers RLS skipped (fail-closed)';
    return;
  end if;

  for r in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'appliance_catalog_identifiers'
  loop
    execute format(
      'drop policy if exists %I on public.appliance_catalog_identifiers',
      r.policyname
    );
  end loop;

  revoke all on table public.appliance_catalog_identifiers from anon;
  grant select, insert, update, delete on table public.appliance_catalog_identifiers
    to authenticated;

  execute $policy$
    create policy "Enforce Store Isolation on appliance_catalog_identifiers"
      on public.appliance_catalog_identifiers
      for all
      to authenticated
      using (public.jwt_matches_store(store_number))
      with check (public.jwt_matches_store(store_number))
  $policy$;
end $$;

notify pgrst, 'reload schema';
