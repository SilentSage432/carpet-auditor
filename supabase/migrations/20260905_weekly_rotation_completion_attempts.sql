-- Completion-attempt history for weekly rotations.
-- Parent weekly_rotations remains current operational state.
-- Child attempts preserve reported-complete + review evidence across send-backs.
-- Depends on: weekly_rotations, departments, JWT helpers (20260812_jwt_rls_policies.sql)

create extension if not exists "pgcrypto";

create table if not exists public.weekly_rotation_completion_attempts (
  id uuid primary key default gen_random_uuid(),
  weekly_rotation_id uuid not null
    references public.weekly_rotations (id)
    on delete restrict,
  reported_at timestamptz not null,
  reported_by text,
  reviewed_at timestamptz,
  reviewed_by text,
  review_outcome text not null,
  review_note text,
  created_at timestamptz not null default now(),
  constraint weekly_rotation_completion_attempts_outcome_check
    check (review_outcome in ('PENDING', 'VERIFIED', 'SENT_BACK')),
  constraint weekly_rotation_completion_attempts_pending_review_null_check
    check (
      review_outcome <> 'PENDING'
      or (reviewed_at is null and reviewed_by is null)
    ),
  constraint weekly_rotation_completion_attempts_terminal_reviewed_at_check
    check (
      review_outcome = 'PENDING'
      or reviewed_at is not null
    )
);

comment on table public.weekly_rotation_completion_attempts is
  'Historical report/review attempts for a weekly_rotations row. Parent remains current operational state.';

comment on column public.weekly_rotation_completion_attempts.review_outcome is
  'PENDING = awaiting DS review · VERIFIED = terminal pass · SENT_BACK = terminal rework';

-- At most one open attempt per rotation.
create unique index if not exists weekly_rotation_completion_attempts_one_pending_uidx
  on public.weekly_rotation_completion_attempts (weekly_rotation_id)
  where review_outcome = 'PENDING';

create index if not exists weekly_rotation_completion_attempts_rotation_reported_idx
  on public.weekly_rotation_completion_attempts (weekly_rotation_id, reported_at);

alter table public.weekly_rotation_completion_attempts enable row level security;

drop policy if exists "Enforce Store and Department Isolation"
  on public.weekly_rotation_completion_attempts;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise notice
      'weekly_rotation_completion_attempts: skipping RLS policy (authenticated role absent)';
    return;
  end if;

  if exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'jwt_matches_store'
  ) and exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'jwt_matches_department_code'
  ) then
    execute $policy$
      create policy "Enforce Store and Department Isolation"
        on public.weekly_rotation_completion_attempts
        for all
        to authenticated
        using (
          exists (
            select 1
            from public.weekly_rotations wr
            join public.departments d on d.id = wr.department_id
            where wr.id = weekly_rotation_completion_attempts.weekly_rotation_id
              and public.jwt_matches_store(wr.store_number)
              and public.jwt_matches_department_code(d.code)
          )
        )
        with check (
          exists (
            select 1
            from public.weekly_rotations wr
            join public.departments d on d.id = wr.department_id
            where wr.id = weekly_rotation_completion_attempts.weekly_rotation_id
              and public.jwt_matches_store(wr.store_number)
              and public.jwt_matches_department_code(d.code)
          )
        )
    $policy$;
  else
    -- Fail closed for authenticated clients when JWT helpers are absent.
    -- Service-role API routes bypass RLS.
    execute $policy$
      create policy "Enforce Store and Department Isolation"
        on public.weekly_rotation_completion_attempts
        for all
        to authenticated
        using (false)
        with check (false)
    $policy$;
  end if;
end $$;

notify pgrst, 'reload schema';
