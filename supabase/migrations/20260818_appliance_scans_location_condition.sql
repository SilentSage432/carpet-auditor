-- Appliance scan location mode + per-unit condition tagging
alter table public.appliance_scans
  add column if not exists location_type text not null default 'showroom',
  add column if not exists condition_tag text not null default 'NEW_BOXED';

alter table public.appliance_scans
  drop constraint if exists appliance_scans_location_type_check;

alter table public.appliance_scans
  add constraint appliance_scans_location_type_check
  check (location_type in ('showroom', 'topstock'));

alter table public.appliance_scans
  drop constraint if exists appliance_scans_condition_tag_check;

alter table public.appliance_scans
  add constraint appliance_scans_condition_tag_check
  check (
    condition_tag in (
      'NEW_BOXED',
      'SHOWROOM_DISPLAY',
      'SCRATCH_DENT',
      'OPEN_BOX'
    )
  );

create index if not exists appliance_scans_location_type_idx
  on public.appliance_scans (store_number, location_type, scanned_at desc);

notify pgrst, 'reload schema';
