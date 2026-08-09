-- Department weekly targets + Lowe's dept codes for rotation cron
-- Depends on: 20260809_store_operations_rbac.sql

alter table public.departments
  add column if not exists weekly_bay_target integer not null default 10;

alter table public.departments
  drop constraint if exists departments_weekly_bay_target_check;

alter table public.departments
  add constraint departments_weekly_bay_target_check
  check (weekly_bay_target >= 1);

alter table public.departments
  add column if not exists is_active boolean not null default true;

create index if not exists departments_is_active_idx
  on public.departments (is_active);

-- Flooring absorbs Home Decor (no separate Home Decor department)
update public.departments
set name = 'Flooring / Home Decor'
where code = 'flooring';

-- Remap legacy hub codes → Lowe's codes (skip if target already present)
update public.departments
set name = 'Paint', code = 'D24P'
where code = 'paint'
  and not exists (select 1 from public.departments d where d.code = 'D24P');

update public.departments
set name = 'Millwork', code = 'D30'
where code = 'millwork'
  and not exists (select 1 from public.departments d where d.code = 'D30');

update public.departments
set name = 'Inside Garden', code = 'D28I'
where code = 'lawn_garden'
  and not exists (select 1 from public.departments d where d.code = 'D28I');

update public.departments
set name = 'Tools', code = 'D25'
where code = 'hardware'
  and not exists (select 1 from public.departments d where d.code = 'D25');

-- Drop leftover legacy rows after remap targets exist
delete from public.departments where code in ('paint', 'millwork', 'lawn_garden', 'hardware');

-- Ensure required departments exist (idempotent)
insert into public.departments (name, code, weekly_bay_target, is_active)
values
  ('Flooring / Home Decor', 'flooring', 10, true),
  ('Appliances', 'appliances', 10, true),
  ('Plumbing', 'plumbing', 10, true),
  ('Electrical', 'electrical', 10, true),
  ('Paint', 'D24P', 10, true),
  ('Inside Garden', 'D28I', 10, true),
  ('Outside Garden', 'D28O', 10, true),
  ('Millwork', 'D30', 10, true),
  ('Tools', 'D25', 10, true),
  ('Building Materials', 'building_materials', 10, true)
on conflict (code) do update
set
  name = excluded.name,
  is_active = true;
