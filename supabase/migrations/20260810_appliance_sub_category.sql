-- Appliance suite detail alongside top-level category (Laundry, Refrigeration, …).
-- Reuses carpet_catalog / carpet_audits (no separate appliance_* tables).

alter table public.carpet_catalog
  add column if not exists sub_category text not null default '';

alter table public.carpet_audits
  add column if not exists sub_category text not null default '';

create index if not exists carpet_catalog_sub_category_idx
  on public.carpet_catalog (category, sub_category);

create index if not exists carpet_audits_sub_category_idx
  on public.carpet_audits (category, sub_category);

-- Legacy flat appliance labels → suite + sub
update public.carpet_catalog
set
  category = 'Laundry',
  sub_category = case
    when category = 'Washer' then 'Washer'
    when category = 'Dryer' then 'Dryer'
    else sub_category
  end
where category in ('Washer', 'Dryer');

update public.carpet_catalog
set category = 'Refrigeration',
    sub_category = case
      when nullif(trim(sub_category), '') is null then 'French Door'
      else sub_category
    end
where category = 'Refrigerator';

update public.carpet_catalog
set category = 'Refrigeration',
    sub_category = case
      when nullif(trim(sub_category), '') is null then 'Chest/Upright Freezer'
      else sub_category
    end
where category = 'Freezer';

update public.carpet_catalog
set category = 'Cooking',
    sub_category = case
      when category = 'Range Hood' then 'Range Hood'
      when nullif(trim(sub_category), '') is null then 'Range / Stove'
      else sub_category
    end
where category in ('Range / Stove', 'Range Hood', 'Appliance Accessories');

update public.carpet_catalog
set category = 'Dishwashers',
    sub_category = case
      when nullif(trim(sub_category), '') is null then 'Built-In'
      else sub_category
    end
where category = 'Dishwasher';

update public.carpet_catalog
set category = 'Microwaves',
    sub_category = case
      when nullif(trim(sub_category), '') is null then 'Countertop'
      else sub_category
    end
where category = 'Microwave';

update public.carpet_audits
set
  category = 'Laundry',
  sub_category = case
    when category = 'Washer' then 'Washer'
    when category = 'Dryer' then 'Dryer'
    else sub_category
  end
where category in ('Washer', 'Dryer');

update public.carpet_audits
set category = 'Refrigeration',
    sub_category = case
      when nullif(trim(sub_category), '') is null then 'French Door'
      else sub_category
    end
where category = 'Refrigerator';

update public.carpet_audits
set category = 'Refrigeration',
    sub_category = case
      when nullif(trim(sub_category), '') is null then 'Chest/Upright Freezer'
      else sub_category
    end
where category = 'Freezer';

update public.carpet_audits
set category = 'Cooking',
    sub_category = case
      when category = 'Range Hood' then 'Range Hood'
      when nullif(trim(sub_category), '') is null then 'Range / Stove'
      else sub_category
    end
where category in ('Range / Stove', 'Range Hood', 'Appliance Accessories');

update public.carpet_audits
set category = 'Dishwashers',
    sub_category = case
      when nullif(trim(sub_category), '') is null then 'Built-In'
      else sub_category
    end
where category = 'Dishwasher';

update public.carpet_audits
set category = 'Microwaves',
    sub_category = case
      when nullif(trim(sub_category), '') is null then 'Countertop'
      else sub_category
    end
where category = 'Microwave';
