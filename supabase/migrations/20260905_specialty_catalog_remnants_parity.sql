-- Specialty Hub canonicalization M2 — carpet_catalog + carpet_remnants.
--
-- Production drift (pre-apply audit): legacy incompatible shapes; 0 rows.
-- Strategy: assert empty → DROP TABLE (no CASCADE) → CREATE Hub contract → RLS.
--
-- Fail-closed:
--   * Non-zero row counts raise before DROP.
--   * DROP without CASCADE so unexpected dependents abort the migration.
--   * Already-canonical Hub tables skip DROP/CREATE only when critical runtime
--     columns + upsert contracts are proven (not superficial column probes).
--   * Mixed canonical/legacy state raises — operator review required.
--
-- App contracts: lib/catalog.ts, lib/remnants.ts, lib/sync-queue.ts,
-- app/api/flooring/ai-insights/route.ts, supabase/schema.sql (+ later alters).
-- RLS pattern: 20260817_rls_security_lockdown.sql (jwt_matches_store).
--
-- One migration file → one transaction under normal Supabase SQL apply.
-- Either both tables end canonical, or the whole file rolls back.

do $$
declare
  catalog_hub boolean;
  remnants_hub boolean;
  n_catalog bigint;
  n_remnants bigint;
begin
  -------------------------------------------------------------------------
  -- Canonical detection (runtime contract — not object-name dependent)
  --
  -- carpet_catalog is Hub iff ALL of:
  --   columns: store_number, sku, carpet_name, roll_width_ft, updated_at
  --            (+ category, sub_category, default_sims_location)
  --   upsert:  FULL unique on exactly (store_number, sku)
  --            UNIQUE constraint OR unique index with NO predicate (partial rejected)
  --
  -- carpet_remnants is Hub iff ALL of:
  --   columns: store_number, sku, tag_number, width_ft, length_ft,
  --            square_feet, square_yards, updated_at (+ status, created_at)
  --   upsert:  PRIMARY KEY (id) OR full unique on exactly (id) (partial rejected)
  -------------------------------------------------------------------------

  if to_regclass('public.carpet_catalog') is null then
    catalog_hub := false;
  else
    select
      -- required + high-value columns
      (
        select count(*) = 8
        from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = 'carpet_catalog'
          and c.column_name in (
            'store_number',
            'sku',
            'carpet_name',
            'roll_width_ft',
            'updated_at',
            'category',
            'sub_category',
            'default_sims_location'
          )
      )
      and
      -- full unique (store_number, sku) — constraint or non-partial unique index
      (
        exists (
          select 1
          from pg_constraint con
          join pg_class rel on rel.oid = con.conrelid
          join pg_namespace nsp on nsp.oid = rel.relnamespace
          where nsp.nspname = 'public'
            and rel.relname = 'carpet_catalog'
            and con.contype = 'u'
            and (
              select array_agg(att.attname::text order by ord.ordinality)
              from unnest(con.conkey) with ordinality as ord(attnum, ordinality)
              join pg_attribute att
                on att.attrelid = con.conrelid
               and att.attnum = ord.attnum
            ) = array['store_number', 'sku']::text[]
        )
        or exists (
          select 1
          from pg_index idx
          join pg_class rel on rel.oid = idx.indrelid
          join pg_namespace nsp on nsp.oid = rel.relnamespace
          where nsp.nspname = 'public'
            and rel.relname = 'carpet_catalog'
            and idx.indisunique
            and idx.indpred is null
            and idx.indnkeyatts = idx.indnatts
            and not exists (
              select 1
              from unnest(idx.indkey) as k(attnum)
              where k.attnum <= 0
            )
            and (
              select array_agg(att.attname::text order by ord.ordinality)
              from unnest(idx.indkey) with ordinality as ord(attnum, ordinality)
              join pg_attribute att
                on att.attrelid = idx.indrelid
               and att.attnum = ord.attnum
            ) = array['store_number', 'sku']::text[]
        )
      )
    into catalog_hub;
  end if;

  if to_regclass('public.carpet_remnants') is null then
    remnants_hub := false;
  else
    select
      (
        select count(*) = 10
        from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = 'carpet_remnants'
          and c.column_name in (
            'store_number',
            'sku',
            'tag_number',
            'width_ft',
            'length_ft',
            'square_feet',
            'square_yards',
            'updated_at',
            'status',
            'created_at'
          )
      )
      and
      (
        exists (
          select 1
          from pg_constraint con
          join pg_class rel on rel.oid = con.conrelid
          join pg_namespace nsp on nsp.oid = rel.relnamespace
          where nsp.nspname = 'public'
            and rel.relname = 'carpet_remnants'
            and con.contype = 'p'
            and (
              select array_agg(att.attname::text order by ord.ordinality)
              from unnest(con.conkey) with ordinality as ord(attnum, ordinality)
              join pg_attribute att
                on att.attrelid = con.conrelid
               and att.attnum = ord.attnum
            ) = array['id']::text[]
        )
        or exists (
          select 1
          from pg_constraint con
          join pg_class rel on rel.oid = con.conrelid
          join pg_namespace nsp on nsp.oid = rel.relnamespace
          where nsp.nspname = 'public'
            and rel.relname = 'carpet_remnants'
            and con.contype = 'u'
            and (
              select array_agg(att.attname::text order by ord.ordinality)
              from unnest(con.conkey) with ordinality as ord(attnum, ordinality)
              join pg_attribute att
                on att.attrelid = con.conrelid
               and att.attnum = ord.attnum
            ) = array['id']::text[]
        )
        or exists (
          select 1
          from pg_index idx
          join pg_class rel on rel.oid = idx.indrelid
          join pg_namespace nsp on nsp.oid = rel.relnamespace
          where nsp.nspname = 'public'
            and rel.relname = 'carpet_remnants'
            and idx.indisunique
            and idx.indpred is null
            and idx.indnkeyatts = idx.indnatts
            and not exists (
              select 1
              from unnest(idx.indkey) as k(attnum)
              where k.attnum <= 0
            )
            and (
              select array_agg(att.attname::text order by ord.ordinality)
              from unnest(idx.indkey) with ordinality as ord(attnum, ordinality)
              join pg_attribute att
                on att.attrelid = idx.indrelid
               and att.attnum = ord.attnum
            ) = array['id']::text[]
        )
      )
    into remnants_hub;
  end if;

  if catalog_hub and remnants_hub then
    raise notice
      'specialty Hub tables already present — skipping DROP/CREATE; ensuring RLS';
  elsif catalog_hub <> remnants_hub then
    raise exception
      'specialty parity: inconsistent state (catalog Hub=%, remnants Hub=%). Refusing to proceed.',
      catalog_hub, remnants_hub;
  else
    -- Legacy or missing: must be empty before replacement.
    if to_regclass('public.carpet_catalog') is not null then
      execute 'select count(*) from public.carpet_catalog' into n_catalog;
      if n_catalog <> 0 then
        raise exception
          'specialty parity: public.carpet_catalog has % rows; refusing DROP. Evacuate or migrate data first.',
          n_catalog;
      end if;
    end if;

    if to_regclass('public.carpet_remnants') is not null then
      execute 'select count(*) from public.carpet_remnants' into n_remnants;
      if n_remnants <> 0 then
        raise exception
          'specialty parity: public.carpet_remnants has % rows; refusing DROP. Evacuate or migrate data first.',
          n_remnants;
      end if;
    end if;

    -- Fail closed on unexpected dependents (no CASCADE, no IF EXISTS once present).
    if to_regclass('public.carpet_catalog') is not null then
      drop table public.carpet_catalog;
    end if;
    if to_regclass('public.carpet_remnants') is not null then
      drop table public.carpet_remnants;
    end if;

    create table public.carpet_catalog (
      id uuid primary key default gen_random_uuid(),
      store_number text not null,
      sku text not null,
      carpet_name text not null,
      vendor text not null default '',
      roll_width_ft numeric(6, 2) not null default 12.00,
      upc_barcode text,
      category text not null default 'Carpet',
      sub_category text not null default '',
      default_sims_location text not null default '',
      sqft_per_box numeric(12, 4),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint carpet_catalog_store_sku_key unique (store_number, sku)
    );

    create index carpet_catalog_sku_idx
      on public.carpet_catalog (sku);
    create index carpet_catalog_upc_barcode_idx
      on public.carpet_catalog (upc_barcode)
      where upc_barcode is not null;
    create index carpet_catalog_store_number_idx
      on public.carpet_catalog (store_number);
    create index carpet_catalog_category_idx
      on public.carpet_catalog (category);
    create index carpet_catalog_sub_category_idx
      on public.carpet_catalog (category, sub_category);
    create index carpet_catalog_sims_location_idx
      on public.carpet_catalog (default_sims_location);

    create table public.carpet_remnants (
      id uuid primary key default gen_random_uuid(),
      store_number text not null,
      sku text not null default '',
      carpet_name text not null default '',
      category text not null default 'Carpet',
      tag_number text not null,
      width_ft numeric(8, 3) not null default 12,
      length_ft numeric(8, 3) not null,
      square_feet numeric(12, 4) not null,
      square_yards numeric(12, 4) not null,
      location text not null default '',
      notes text not null default '',
      status text not null default 'available'
        constraint carpet_remnants_status_check
          check (status in ('available', 'reserved', 'sold')),
      reserved_for text not null default '',
      logged_by text not null default '',
      estimated_value numeric(12, 2),
      markdown_percent numeric(6, 2),
      markdown_price numeric(12, 2),
      markdown_notes text not null default '',
      markdown_by text not null default '',
      markdown_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index carpet_remnants_status_idx
      on public.carpet_remnants (status);
    create index carpet_remnants_tag_idx
      on public.carpet_remnants (tag_number);
    create index carpet_remnants_store_number_idx
      on public.carpet_remnants (store_number);
    create index carpet_remnants_store_updated_at_idx
      on public.carpet_remnants (store_number, updated_at desc);
  end if;

  -- RLS + grants (idempotent; matches 20260817 hub lockdown).
  alter table public.carpet_catalog enable row level security;
  alter table public.carpet_remnants enable row level security;

  revoke all on table public.carpet_catalog from anon;
  revoke all on table public.carpet_remnants from anon;

  grant select, insert, update, delete on table public.carpet_catalog to authenticated;
  grant select, insert, update, delete on table public.carpet_remnants to authenticated;

  drop policy if exists "Enforce Store Isolation on carpet_catalog" on public.carpet_catalog;
  drop policy if exists "Enforce Store Isolation on carpet_remnants" on public.carpet_remnants;
  -- Legacy remnant policy names from partial live lockdown (if recreate path dropped them already, no-op).
  drop policy if exists "Allow authenticated store-scoped select" on public.carpet_remnants;

  create policy "Enforce Store Isolation on carpet_catalog"
    on public.carpet_catalog
    for all
    to authenticated
    using (public.jwt_matches_store(store_number))
    with check (public.jwt_matches_store(store_number));

  create policy "Enforce Store Isolation on carpet_remnants"
    on public.carpet_remnants
    for all
    to authenticated
    using (public.jwt_matches_store(store_number))
    with check (public.jwt_matches_store(store_number));
end $$;

comment on table public.carpet_catalog is
  'Hub flooring/SIMS SKU catalog (store-scoped). Canonical contract for lib/catalog.ts.';
comment on table public.carpet_remnants is
  'Hub remnant rack inventory (store-scoped). Canonical contract for lib/remnants.ts.';
