-- Restore dual Selling + Topstock rows per aisle/bay
-- Unique key: (department_id, aisle, bay, type)

alter table public.store_locations
  drop constraint if exists store_locations_department_id_aisle_bay_key;

alter table public.store_locations
  drop constraint if exists store_locations_department_id_aisle_bay_type_key;

alter table public.store_locations
  add constraint store_locations_department_id_aisle_bay_type_key
  unique (department_id, aisle, bay, type);
