-- Call-out carry-over priority loop
-- store_locations.carried_over is the next-draw prepend flag (cleared when assigned).
-- last_carried_over_at stays for Floor / Sunday "Carry-Over Priority" badges.
-- sunday_bay_assignments.status may be CARRIED_OVER; is_carried_over mirrors the flag.

alter table public.store_locations
  add column if not exists carried_over boolean not null default false;

alter table public.store_locations
  add column if not exists last_carried_over_at timestamptz;

create index if not exists store_locations_carry_over_draw_idx
  on public.store_locations (department_id, is_active, carried_over, priority_override);

comment on column public.store_locations.carried_over is
  'True while this bay must prepend the next Sunday draw (cleared when assigned or completed).';
comment on column public.store_locations.last_carried_over_at is
  'When the bay last entered the call-out carry-over loop (badge window).';

alter table public.sunday_bay_assignments
  add column if not exists is_carried_over boolean not null default false;

alter table public.sunday_bay_assignments
  drop constraint if exists sunday_bay_assignments_status_check;

alter table public.sunday_bay_assignments
  add constraint sunday_bay_assignments_status_check
  check (status in ('pending', 'assigned', 'completed', 'cleared', 'CARRIED_OVER'));

comment on column public.sunday_bay_assignments.is_carried_over is
  'True when this week''s specialist assignment was flagged carry-over (call-out loop).';
