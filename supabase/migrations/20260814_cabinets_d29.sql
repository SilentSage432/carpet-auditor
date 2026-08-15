-- Cabinets (D29) as a first-class store-ops department.
-- Unique identity is (store_id, code) after 20260809_multi_store.sql.

insert into public.departments (store_id, name, code, weekly_bay_target, is_active)
select s.id, 'Cabinets', 'D29', 6, true
from public.stores s
on conflict (store_id, code) do update
set
  name = excluded.name;
