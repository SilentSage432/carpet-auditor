-- Per-bay custom cadence for Sunday draw (3–21 days).
-- Null means use velocity-tier default (standard=14, high/critical=5).
-- Does not replace showroom audit_frequency_days.

alter table public.store_locations
  add column if not exists custom_decay_days integer;

alter table public.store_locations
  drop constraint if exists store_locations_custom_decay_days_check;

alter table public.store_locations
  add constraint store_locations_custom_decay_days_check
  check (
    custom_decay_days is null
    or (custom_decay_days >= 3 and custom_decay_days <= 21)
  );

comment on column public.store_locations.custom_decay_days is
  'Sunday-draw cadence override in days (3–21). Null uses velocity-tier default.';
