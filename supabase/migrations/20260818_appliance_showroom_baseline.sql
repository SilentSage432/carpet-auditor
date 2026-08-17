-- Showroom baseline lock — persisted display units survive weekly topstock resets
alter table public.appliance_scans
  add column if not exists is_showroom_baseline boolean not null default false;

create index if not exists appliance_scans_showroom_baseline_idx
  on public.appliance_scans (store_number, is_showroom_baseline)
  where is_showroom_baseline = true;

notify pgrst, 'reload schema';
