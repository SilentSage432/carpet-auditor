-- Tie appliance floor scans to a mapped store_locations bay when the scanner
-- is opened from an APPLIANCE_SIMS_AUDIT rotation. Free-text `location` stays.

alter table public.appliance_scans
  add column if not exists location_id uuid references public.store_locations (id) on delete set null,
  add column if not exists aisle text,
  add column if not exists bay_number integer;

create index if not exists appliance_scans_location_id_idx
  on public.appliance_scans (location_id, scanned_at desc);

comment on column public.appliance_scans.location_id is
  'Optional mapped bay (store_locations.id) when scanned from a SIMS workflow';

notify pgrst, 'reload schema';
