-- Some live DBs added UNIQUE(store_number, department_id, week_number), which
-- allows only one bay per department per ISO week. Canonical identity is
-- (location_id, assigned_week) — one row per bay per week.
-- Drop the mistaken constraint when present.

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'weekly_rotations_store_dept_week_uniq'
      and conrelid = 'public.weekly_rotations'::regclass
  ) then
    alter table public.weekly_rotations
      drop constraint weekly_rotations_store_dept_week_uniq;
  end if;
end $$;

notify pgrst, 'reload schema';
