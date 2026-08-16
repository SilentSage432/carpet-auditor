-- Lowe's floor job title on roster cards (orthogonal to platform role).
-- Platform `role` stays Associate | Supervisor | MasterAdmin | Specialist (legacy CHECK).
-- Flooring CSA vs Flooring Specialist is stored here so grouping stays by home department.

alter table public.store_specialists
  add column if not exists floor_title text;

alter table public.store_specialists
  drop constraint if exists store_specialists_floor_title_check;

alter table public.store_specialists
  add constraint store_specialists_floor_title_check
  check (
    floor_title is null
    or floor_title in ('Specialist', 'CSA', 'Cashier', 'Receiving')
  );

update public.store_specialists
set floor_title = case
  when role in ('Supervisor', 'MasterAdmin') then null
  when assigned_department in (
    'flooring', 'appliances', 'millwork', 'cabinets'
  ) then 'Specialist'
  else 'CSA'
end
where floor_title is null
  and role not in ('Supervisor', 'MasterAdmin');

comment on column public.store_specialists.floor_title is
  'Lowe''s floor title: Specialist, CSA, Cashier, or Receiving. Platform RBAC uses role.';
