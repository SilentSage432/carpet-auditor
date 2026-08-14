-- P0 query indexes for mobile cold-start / high-frequency list paths.
-- Safe to re-run. Does not change RLS or table ownership.

-- carpet_audits: hub cycle log (store + newest first, bounded)
create index if not exists carpet_audits_store_created_at_idx
  on public.carpet_audits (store_number, created_at desc);

-- carpet_remnants: remnant rack list
create index if not exists carpet_remnants_store_updated_at_idx
  on public.carpet_remnants (store_number, updated_at desc);

-- store_locations: Store Map GET by store then aisle/bay
create index if not exists store_locations_store_aisle_bay_idx
  on public.store_locations (store_id, aisle, bay);

create index if not exists store_locations_store_dept_aisle_bay_idx
  on public.store_locations (store_id, department_id, aisle, bay);

-- weekly_rotations: this-week checklist
create index if not exists weekly_rotations_store_week_dept_idx
  on public.weekly_rotations (store_id, assigned_week, department_id);

-- manager_notes: Floor Pad list (active notes by store/dept)
alter table public.manager_notes
  add column if not exists is_archived boolean not null default false;

create index if not exists manager_notes_store_archived_dept_created_idx
  on public.manager_notes (store_number, is_archived, department, created_at desc);
