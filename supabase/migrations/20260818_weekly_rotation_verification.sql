-- Two-stage weekly bay review lives on weekly_rotations, not store_locations.status.
-- PENDING = staged · PENDING_VERIFICATION = associate submitted · VERIFIED_COMPLETE = DS closed.

alter table public.weekly_rotations
  add column if not exists verification_status text not null default 'PENDING',
  add column if not exists completed_by text,
  add column if not exists verified_by text,
  add column if not exists verified_at timestamptz,
  add column if not exists review_note text;

update public.weekly_rotations
set verification_status = 'VERIFIED_COMPLETE',
    verified_at = coalesce(verified_at, completed_at)
where is_completed = true
  and verification_status = 'PENDING';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'weekly_rotations_verification_status_check'
      and conrelid = 'public.weekly_rotations'::regclass
  ) then
    alter table public.weekly_rotations
      add constraint weekly_rotations_verification_status_check
      check (
        verification_status in (
          'PENDING',
          'PENDING_VERIFICATION',
          'VERIFIED_COMPLETE'
        )
      );
  end if;
end $$;

create index if not exists weekly_rotations_verification_status_idx
  on public.weekly_rotations (department_id, assigned_week, verification_status);

comment on column public.weekly_rotations.verification_status is
  'Week-item DS review: PENDING → PENDING_VERIFICATION → VERIFIED_COMPLETE';

notify pgrst, 'reload schema';
