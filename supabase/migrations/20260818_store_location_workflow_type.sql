-- Bay execution profile — orthogonal to type (SELLING/TOPSTOCK) and
-- location_type (STANDARD/SHOWROOM_STACKOUT). Default keeps existing merch rotations.

alter table public.store_locations
  add column if not exists workflow_type text not null default 'STANDARD_MERCH';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'store_locations_workflow_type_check'
      and conrelid = 'public.store_locations'::regclass
  ) then
    alter table public.store_locations
      add constraint store_locations_workflow_type_check
      check (
        workflow_type in (
          'STANDARD_MERCH',
          'APPLIANCE_SIMS_AUDIT',
          'BULK_PALLET_AUDIT'
        )
      );
  end if;
end $$;

create index if not exists store_locations_workflow_type_idx
  on public.store_locations (department_id, workflow_type);

comment on column public.store_locations.workflow_type is
  'Bay execution profile: STANDARD_MERCH | APPLIANCE_SIMS_AUDIT | BULK_PALLET_AUDIT';

notify pgrst, 'reload schema';
