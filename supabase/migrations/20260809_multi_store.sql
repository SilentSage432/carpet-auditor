-- Multi-store architecture for Store Operations
-- Depends on: 20260809_store_operations_rbac.sql, 20260809_weekly_rotation_cron.sql

-- ---------------------------------------------------------------------------
-- Stores registry (UUID store_id; hub still keys sessions by store_number)
-- ---------------------------------------------------------------------------
create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  store_number text not null unique,
  name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists stores_is_active_idx on public.stores (is_active);

insert into public.stores (store_number, name, is_active)
values ('1234', 'Default Store', true)
on conflict (store_number) do nothing;

-- ---------------------------------------------------------------------------
-- departments.store_id (code unique per store)
-- ---------------------------------------------------------------------------
alter table public.departments
  add column if not exists store_id uuid references public.stores (id) on delete cascade;

update public.departments d
set store_id = s.id
from public.stores s
where s.store_number = '1234'
  and d.store_id is null;

alter table public.departments
  alter column store_id set not null;

alter table public.departments
  drop constraint if exists departments_code_key;

alter table public.departments
  drop constraint if exists departments_store_id_code_key;

alter table public.departments
  add constraint departments_store_id_code_key unique (store_id, code);

create index if not exists departments_store_id_idx on public.departments (store_id);

-- ---------------------------------------------------------------------------
-- store_locations.store_id
-- Unique identity for bulk upsert: (department_id, aisle, bay)
-- One map row per aisle/bay; type remains a required attribute.
-- ---------------------------------------------------------------------------
alter table public.store_locations
  add column if not exists store_id uuid references public.stores (id) on delete cascade;

update public.store_locations sl
set store_id = d.store_id
from public.departments d
where d.id = sl.department_id
  and sl.store_id is null;

alter table public.store_locations
  alter column store_id set not null;

-- Collapse Selling+Topstock duplicates for the same aisle/bay (prefer SELLING)
delete from public.store_locations
where id in (
  select id from (
    select
      id,
      row_number() over (
        partition by department_id, aisle, bay
        order by
          case when type = 'SELLING' then 0 else 1 end,
          created_at asc nulls last
      ) as rn
    from public.store_locations
  ) ranked
  where rn > 1
);

alter table public.store_locations
  drop constraint if exists store_locations_department_id_aisle_bay_type_key;

alter table public.store_locations
  drop constraint if exists store_locations_department_id_aisle_bay_key;

alter table public.store_locations
  add constraint store_locations_department_id_aisle_bay_key
  unique (department_id, aisle, bay);

create index if not exists store_locations_store_id_idx
  on public.store_locations (store_id);

-- ---------------------------------------------------------------------------
-- weekly_rotations.store_id
-- ---------------------------------------------------------------------------
alter table public.weekly_rotations
  add column if not exists store_id uuid references public.stores (id) on delete cascade;

update public.weekly_rotations wr
set store_id = d.store_id
from public.departments d
where d.id = wr.department_id
  and wr.store_id is null;

alter table public.weekly_rotations
  alter column store_id set not null;

create index if not exists weekly_rotations_store_id_idx
  on public.weekly_rotations (store_id);

-- ---------------------------------------------------------------------------
-- RLS for stores (service role bypasses; keep policies for auth.users path)
-- ---------------------------------------------------------------------------
alter table public.stores enable row level security;

drop policy if exists "super_admin all stores" on public.stores;
create policy "super_admin all stores"
  on public.stores for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'super_admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'super_admin'
    )
  );
