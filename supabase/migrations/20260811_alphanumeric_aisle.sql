-- Alphanumeric aisle codes on store_locations (BW, RW, LW, GC, 12, A1, …)
-- weekly_rotations reference location_id (no aisle column).
-- There is no rotation_schedule table in this schema.

alter table public.store_locations
  drop constraint if exists store_locations_aisle_check;

alter table public.store_locations
  alter column aisle type text using trim(upper(aisle::text));

alter table public.store_locations
  alter column aisle set not null;

alter table public.store_locations
  drop constraint if exists store_locations_aisle_nonempty;

alter table public.store_locations
  add constraint store_locations_aisle_nonempty
  check (length(trim(aisle)) > 0);

-- Keep unique identity on TEXT aisle
alter table public.store_locations
  drop constraint if exists store_locations_department_id_aisle_bay_type_key;

alter table public.store_locations
  add constraint store_locations_department_id_aisle_bay_type_key
  unique (department_id, aisle, bay, type);

comment on column public.store_locations.aisle is
  'Alphanumeric aisle / zone code (TEXT), e.g. BW, RW, 12, A1 — always stored uppercase.';
