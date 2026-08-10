-- Dedicated appliance catalog + floor scan tables (ownership separate from carpet_*).
-- Also backfills from legacy carpet_catalog / carpet_audits appliance rows when present.

create table if not exists public.appliance_catalog (
  id uuid primary key default gen_random_uuid(),
  store_number text not null default '0000',
  item_number text not null,
  upc text,
  description text not null default '',
  category text not null default 'Laundry',
  sub_category text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists appliance_catalog_store_item_uidx
  on public.appliance_catalog (store_number, item_number);

create index if not exists appliance_catalog_upc_idx
  on public.appliance_catalog (upc)
  where upc is not null;

create index if not exists appliance_catalog_category_idx
  on public.appliance_catalog (category, sub_category);

create table if not exists public.appliance_scans (
  id uuid primary key default gen_random_uuid(),
  store_number text not null default '0000',
  item_number text not null,
  serial_number text not null default '',
  location text not null default '',
  category text not null default 'Laundry',
  sub_category text not null default '',
  scanned_by text not null default '',
  scanned_at timestamptz not null default now()
);

create index if not exists appliance_scans_scanned_at_idx
  on public.appliance_scans (scanned_at desc);

create index if not exists appliance_scans_store_idx
  on public.appliance_scans (store_number, scanned_at desc);

create index if not exists appliance_scans_item_idx
  on public.appliance_scans (item_number);

create index if not exists appliance_scans_category_idx
  on public.appliance_scans (category, sub_category);

-- Backfill catalog from legacy carpet_catalog appliance rows
insert into public.appliance_catalog (
  id,
  store_number,
  item_number,
  upc,
  description,
  category,
  sub_category,
  created_at,
  updated_at
)
select
  c.id,
  c.store_number,
  c.sku,
  c.upc_barcode,
  c.carpet_name,
  case
    when c.category in ('Washer', 'Dryer') then 'Laundry'
    when c.category in ('Refrigerator', 'Freezer') then 'Refrigeration'
    when c.category in ('Range / Stove', 'Range', 'Range Hood', 'Cooking', 'Appliance Accessories')
      then 'Cooking / Ranges'
    when c.category in ('Dishwasher', 'Dishwashers') then 'Dishwashers'
    when c.category in ('Microwave', 'Microwaves') then 'Microwaves / Venting'
    when c.category = 'Cooking' then 'Cooking / Ranges'
    when c.category = 'Microwaves' then 'Microwaves / Venting'
    when c.category in (
      'Laundry',
      'Refrigeration',
      'Cooking / Ranges',
      'Dishwashers',
      'Microwaves / Venting'
    ) then c.category
    else 'Laundry'
  end,
  case
    when nullif(trim(c.sub_category), '') is not null then
      case
        when c.sub_category = 'Combo/Unit' then 'Combo / Unit'
        when c.sub_category = 'Drink/Compact' then 'Beverage / Compact'
        when c.sub_category = 'Chest/Upright Freezer' then 'Chest / Upright Freezer'
        else c.sub_category
      end
    when c.category = 'Washer' then 'Washer'
    when c.category = 'Dryer' then 'Dryer'
    when c.category = 'Refrigerator' then 'French Door'
    when c.category = 'Freezer' then 'Chest / Upright Freezer'
    when c.category in ('Range / Stove', 'Range', 'Cooking') then 'Range / Stove'
    when c.category = 'Range Hood' then 'Range Hood'
    when c.category in ('Dishwasher', 'Dishwashers') then 'Built-In'
    when c.category in ('Microwave', 'Microwaves') then 'Countertop'
    else coalesce(c.sub_category, '')
  end,
  c.created_at,
  c.updated_at
from public.carpet_catalog c
where c.category in (
  'Washer', 'Dryer', 'Refrigerator', 'Freezer', 'Range / Stove', 'Range',
  'Range Hood', 'Dishwasher', 'Microwave', 'Appliance Accessories',
  'Laundry', 'Refrigeration', 'Cooking', 'Cooking / Ranges',
  'Dishwashers', 'Microwaves', 'Microwaves / Venting'
)
on conflict (store_number, item_number) do nothing;

-- Backfill scans from legacy carpet_audits appliance rows
insert into public.appliance_scans (
  id,
  store_number,
  item_number,
  serial_number,
  location,
  category,
  sub_category,
  scanned_by,
  scanned_at
)
select
  a.id,
  a.store_number,
  a.sku,
  '',
  coalesce(nullif(trim(a.sims_location), ''), a.location_type),
  case
    when a.category in ('Washer', 'Dryer') then 'Laundry'
    when a.category in ('Refrigerator', 'Freezer') then 'Refrigeration'
    when a.category in ('Range / Stove', 'Range', 'Range Hood', 'Cooking', 'Appliance Accessories')
      then 'Cooking / Ranges'
    when a.category in ('Dishwasher', 'Dishwashers') then 'Dishwashers'
    when a.category in ('Microwave', 'Microwaves') then 'Microwaves / Venting'
    when a.category = 'Cooking' then 'Cooking / Ranges'
    when a.category = 'Microwaves' then 'Microwaves / Venting'
    when a.category in (
      'Laundry',
      'Refrigeration',
      'Cooking / Ranges',
      'Dishwashers',
      'Microwaves / Venting'
    ) then a.category
    else 'Laundry'
  end,
  case
    when nullif(trim(a.sub_category), '') is not null then
      case
        when a.sub_category = 'Combo/Unit' then 'Combo / Unit'
        when a.sub_category = 'Drink/Compact' then 'Beverage / Compact'
        when a.sub_category = 'Chest/Upright Freezer' then 'Chest / Upright Freezer'
        else a.sub_category
      end
    when a.category = 'Washer' then 'Washer'
    when a.category = 'Dryer' then 'Dryer'
    when a.category = 'Refrigerator' then 'French Door'
    when a.category = 'Freezer' then 'Chest / Upright Freezer'
    when a.category in ('Range / Stove', 'Range', 'Cooking') then 'Range / Stove'
    when a.category = 'Range Hood' then 'Range Hood'
    when a.category in ('Dishwasher', 'Dishwashers') then 'Built-In'
    when a.category in ('Microwave', 'Microwaves') then 'Countertop'
    else coalesce(a.sub_category, '')
  end,
  a.audited_by,
  a.created_at
from public.carpet_audits a
where a.category in (
  'Washer', 'Dryer', 'Refrigerator', 'Freezer', 'Range / Stove', 'Range',
  'Range Hood', 'Dishwasher', 'Microwave', 'Appliance Accessories',
  'Laundry', 'Refrigeration', 'Cooking', 'Cooking / Ranges',
  'Dishwashers', 'Microwaves', 'Microwaves / Venting'
)
on conflict (id) do nothing;
