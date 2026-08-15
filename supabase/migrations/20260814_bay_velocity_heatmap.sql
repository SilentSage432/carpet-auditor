-- IRP / down-stocking velocity heatmap
-- Extends store_locations (canonical bay table) + bay_service_logs (walk-the-floor).
-- Does not replace last_completed_at (weekly rotation completions).
-- Depends on: 20260809_store_operations_rbac, 20260812_jwt_rls_policies helpers

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- store_locations — IRP cadence + velocity (additive; keep department_id)
-- ---------------------------------------------------------------------------
alter table public.store_locations
  add column if not exists department_code text;

alter table public.store_locations
  add column if not exists last_serviced_at timestamptz;

alter table public.store_locations
  add column if not exists velocity_tier text not null default 'standard';

alter table public.store_locations
  add column if not exists priority_override boolean not null default false;

alter table public.store_locations
  drop constraint if exists store_locations_velocity_tier_check;

alter table public.store_locations
  add constraint store_locations_velocity_tier_check
  check (velocity_tier in ('standard', 'high', 'critical_hotspot'));

update public.store_locations sl
set department_code = d.code
from public.departments d
where d.id = sl.department_id
  and (sl.department_code is null or trim(sl.department_code) = '');

update public.store_locations
set last_serviced_at = last_completed_at
where last_serviced_at is null
  and last_completed_at is not null;

create or replace function public.store_locations_sync_department_code()
returns trigger
language plpgsql
as $$
begin
  if new.department_code is null
     or btrim(new.department_code) = ''
     or (tg_op = 'UPDATE' and new.department_id is distinct from old.department_id)
  then
    select d.code
      into new.department_code
    from public.departments d
    where d.id = new.department_id;
  end if;
  return new;
end;
$$;

drop trigger if exists store_locations_sync_department_code
  on public.store_locations;
create trigger store_locations_sync_department_code
  before insert or update of department_id, department_code
  on public.store_locations
  for each row
  execute function public.store_locations_sync_department_code();

create index if not exists store_locations_velocity_draw_idx
  on public.store_locations (
    department_id,
    is_active,
    status,
    velocity_tier,
    priority_override
  );

create index if not exists store_locations_last_serviced_idx
  on public.store_locations (store_id, last_serviced_at);

comment on column public.store_locations.last_serviced_at is
  'IRP walk-the-floor last touch (bay_service_logs). Distinct from last_completed_at (weekly rotation).';
comment on column public.store_locations.velocity_tier is
  'standard | high | critical_hotspot — auto-promoted from heavy/critical service logs.';
comment on column public.store_locations.priority_override is
  'Manual Sunday-draw pin; rotation engine treats as velocity-priority.';
comment on column public.store_locations.department_code is
  'Denormalized departments.code for IRP logs and JWT-scoped heatmap queries.';

-- ---------------------------------------------------------------------------
-- bay_service_logs — 2-second walk-the-floor intensity
-- ---------------------------------------------------------------------------
create table if not exists public.bay_service_logs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  location_id uuid not null references public.store_locations (id) on delete cascade,
  department_code text not null,
  serviced_by text,
  intensity text not null
    check (intensity in ('light_touch', 'heavy_packdown', 'critical_hole')),
  notes text,
  created_at timestamptz not null default now()
);

do $$
begin
  if exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'stores'
  ) then
    alter table public.bay_service_logs
      drop constraint if exists bay_service_logs_store_id_fkey;
    alter table public.bay_service_logs
      add constraint bay_service_logs_store_id_fkey
      foreign key (store_id) references public.stores (id) on delete cascade;
  end if;
end $$;

create index if not exists bay_service_logs_location_created_idx
  on public.bay_service_logs (location_id, created_at desc);

create index if not exists bay_service_logs_store_dept_idx
  on public.bay_service_logs (store_id, department_code, created_at desc);

comment on table public.bay_service_logs is
  'Walk-the-floor IRP intensity logs. location_id → store_locations (not a bays/bay_tags table).';

alter table public.bay_service_logs enable row level security;

drop policy if exists "Enforce Store and Department Isolation"
  on public.bay_service_logs;

do $$
begin
  if exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'jwt_matches_store'
  ) then
    execute $policy$
      create policy "Enforce Store and Department Isolation"
        on public.bay_service_logs
        for all
        to authenticated
        using (
          exists (
            select 1
            from public.store_locations sl
            where sl.id = bay_service_logs.location_id
              and public.jwt_matches_store(sl.store_number)
              and (
                public.jwt_matches_department_code(bay_service_logs.department_code)
                or exists (
                  select 1 from public.departments d
                  where d.id = sl.department_id
                    and public.jwt_matches_department_code(d.code)
                )
              )
          )
        )
        with check (
          exists (
            select 1
            from public.store_locations sl
            where sl.id = bay_service_logs.location_id
              and public.jwt_matches_store(sl.store_number)
              and (
                public.jwt_matches_department_code(bay_service_logs.department_code)
                or exists (
                  select 1 from public.departments d
                  where d.id = sl.department_id
                    and public.jwt_matches_department_code(d.code)
                )
              )
          )
        )
    $policy$;
  else
    execute $policy$
      create policy "Enforce Store and Department Isolation"
        on public.bay_service_logs
        for all
        to authenticated
        using (
          exists (
            select 1
            from public.store_locations sl
            where sl.id = bay_service_logs.location_id
              and sl.store_number = (auth.jwt() -> 'app_metadata' ->> 'store_number')
          )
        )
        with check (
          exists (
            select 1
            from public.store_locations sl
            where sl.id = bay_service_logs.location_id
              and sl.store_number = (auth.jwt() -> 'app_metadata' ->> 'store_number')
          )
        )
    $policy$;
  end if;
end $$;
