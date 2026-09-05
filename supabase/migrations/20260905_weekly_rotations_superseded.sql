-- Preserve weekly rotation stage history across Force Draw / restage.
-- Active plan: superseded_at IS NULL (at most one per location_id + assigned_week).
-- Historical superseded rows keep original id + created_at.
-- Does NOT fabricate supersession for rows already hard-deleted in the past.

alter table public.weekly_rotations
  add column if not exists superseded_at timestamptz;

alter table public.weekly_rotations
  add column if not exists supersede_source text;

alter table public.weekly_rotations
  add column if not exists superseded_by text;

comment on column public.weekly_rotations.superseded_at is
  'NULL = active operational week row. Set when Force Draw / reset retires this stage without deleting history.';
comment on column public.weekly_rotations.supersede_source is
  'Why the row left the active plan: FORCE_DRAW | ADMIN_RESET | CONFLICT_CLEAR';
comment on column public.weekly_rotations.superseded_by is
  'Optional actor id (roster/specialist) who triggered supersession.';

-- Drop full unique so historical duplicates for the same location/week can exist.
alter table public.weekly_rotations
  drop constraint if exists weekly_rotations_location_id_assigned_week_key;

drop index if exists public.weekly_rotations_location_id_assigned_week_key;

-- At most one active row per location + ISO week.
create unique index if not exists weekly_rotations_active_location_week_uidx
  on public.weekly_rotations (location_id, assigned_week)
  where superseded_at is null;

create index if not exists weekly_rotations_location_week_history_idx
  on public.weekly_rotations (location_id, assigned_week, created_at desc);

create index if not exists weekly_rotations_active_dept_week_idx
  on public.weekly_rotations (department_id, assigned_week)
  where superseded_at is null;

notify pgrst, 'reload schema';
