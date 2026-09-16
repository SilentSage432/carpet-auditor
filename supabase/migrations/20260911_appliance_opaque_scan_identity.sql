-- APP-UPC-001A — Opaque appliance scan identity
-- Physical scan identifiers (UPC / ESL / taught aliases) are NOT durable readable data.
-- Durable matching key: keyed HMAC fingerprint (computed server-side only).
-- Canonical catalog identity remains (store_number, item_number).
--
-- Pilot data reset is performed separately (authorized appliance-only clear).
-- This migration does not truncate non-appliance tables.

-- 1) Replace plaintext identifier column with opaque fingerprint.
alter table public.appliance_catalog_identifiers
  add column if not exists scan_fingerprint text;

-- Drop plaintext unique index / column when present.
drop index if exists public.appliance_catalog_identifiers_store_identifier_uidx;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'appliance_catalog_identifiers'
      and column_name = 'identifier'
  ) then
    alter table public.appliance_catalog_identifiers drop column identifier;
  end if;
end $$;

-- Plaintext→fingerprint cannot be computed in SQL (secret is app-server only).
-- Authorized APP-UPC-001A fresh start: remove unconvertible identifier rows.
delete from public.appliance_catalog_identifiers
where scan_fingerprint is null
   or btrim(scan_fingerprint) = '';

alter table public.appliance_catalog_identifiers
  alter column scan_fingerprint set not null;

create unique index if not exists appliance_catalog_identifiers_store_fingerprint_uidx
  on public.appliance_catalog_identifiers (store_number, scan_fingerprint);

comment on table public.appliance_catalog_identifiers is
  'APP-UPC-001A: opaque scan fingerprints resolving to canonical (store_number, item_number). No durable plaintext UPC/ESL/alias.';

comment on column public.appliance_catalog_identifiers.scan_fingerprint is
  'Server-owned HMAC-SHA-256 hex of canonical physical scan identifier. Never a raw barcode.';

-- 2) Remove durable plaintext UPC from catalog.
drop index if exists public.appliance_catalog_upc_idx;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'appliance_catalog'
      and column_name = 'upc'
  ) then
    alter table public.appliance_catalog drop column upc;
  end if;
end $$;

notify pgrst, 'reload schema';
