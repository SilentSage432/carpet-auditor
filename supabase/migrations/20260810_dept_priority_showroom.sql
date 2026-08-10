-- Department master toggles (default off except Flooring),
-- adaptive manual priority, and showroom / stack-out zones.
-- Note: store_locations.type remains SELLING|TOPSTOCK (enum location_type).
-- New column location_type uses enum store_location_kind (STANDARD|SHOWROOM_STACKOUT).

-- 1) Master toggles — inactive by default; Flooring stays on
alter table public.departments
  alter column is_active set default false;

update public.departments
set is_active = (lower(code) = 'flooring');

-- 2) Adaptive priority weight
alter table public.store_locations
  add column if not exists manual_priority_count integer not null default 0;

do $$ begin
  alter table public.store_locations
    add constraint store_locations_manual_priority_count_check
    check (manual_priority_count >= 0);
exception when duplicate_object then null;
end $$;

-- 3) Showroom / high-frequency zone (orthogonal to Selling/Topstock `type`)
do $$ begin
  create type public.store_location_kind as enum ('STANDARD', 'SHOWROOM_STACKOUT');
exception when duplicate_object then null;
end $$;

alter table public.store_locations
  add column if not exists location_type public.store_location_kind not null default 'STANDARD';

alter table public.store_locations
  add column if not exists audit_frequency_days integer not null default 7;

do $$ begin
  alter table public.store_locations
    add constraint store_locations_audit_frequency_days_check
    check (audit_frequency_days >= 1);
exception when duplicate_object then null;
end $$;

create index if not exists store_locations_draw_weight_idx
  on public.store_locations (
    department_id,
    is_active,
    status,
    location_type,
    manual_priority_count desc,
    last_completed_at asc nulls first
  );

create index if not exists store_locations_showroom_idx
  on public.store_locations (department_id, location_type, is_active)
  where location_type = 'SHOWROOM_STACKOUT';
