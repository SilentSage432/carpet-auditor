-- APP-OBS-001: Per-unit physical fulfillment disposition (blue sticker observation).
-- NULL = no staged disposition recorded (NOT official Lowe's availability).
-- Orthogonal to location_type and condition_tag.
-- Soft classification: mutable after CLOSED (not in APP-AUD-002B freeze set).

alter table public.appliance_scans
  add column if not exists fulfillment_disposition text;

alter table public.appliance_scans
  drop constraint if exists appliance_scans_fulfillment_disposition_check;

alter table public.appliance_scans
  add constraint appliance_scans_fulfillment_disposition_check
  check (
    fulfillment_disposition is null
    or fulfillment_disposition in ('STAGED_PICKUP', 'STAGED_DELIVERY')
  );

comment on column public.appliance_scans.fulfillment_disposition is
  'APP-OBS-001: physically observed staged fulfillment (STAGED_PICKUP|STAGED_DELIVERY). NULL = no staged disposition recorded. Not official Lowe''s availability.';

notify pgrst, 'reload schema';
