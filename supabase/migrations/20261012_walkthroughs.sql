-- RD-5 Collaborative Walkthroughs domain.
-- Leadership conversations: observations + optional follow-ups.
-- Independent of weekly rotation / verification / section ownership.
-- Writes via service role after Supervisor/Master API auth.
-- Authenticated SELECT is store-scoped. No authenticated write policies.
-- Additive only. Soft FKs for roster/section; no destructive cascades to rotations.

create extension if not exists "pgcrypto";

create table if not exists public.walkthrough_sessions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    references public.stores (id)
    on delete cascade,
  department_id uuid null
    references public.departments (id)
    on delete set null,
  companion_specialist_id uuid null
    references public.store_specialists (id)
    on delete set null,
  focus_section_id uuid null
    references public.operational_sections (id)
    on delete set null,
  status text not null default 'active',
  notes text null,
  started_at timestamptz not null default now(),
  ended_at timestamptz null,
  created_by_specialist_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint walkthrough_sessions_status_check
    check (status in ('active', 'ended')),
  constraint walkthrough_sessions_end_consistency_check
    check (
      (status = 'active' and ended_at is null)
      or (status = 'ended' and ended_at is not null)
    )
);

comment on table public.walkthrough_sessions is
  'RD-5 collaborative walkthrough session. Not weekly assignment or verification.';

create table if not exists public.walkthrough_observations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    references public.stores (id)
    on delete cascade,
  session_id uuid not null
    references public.walkthrough_sessions (id)
    on delete cascade,
  observation_type text not null,
  body text not null,
  associate_specialist_id uuid null
    references public.store_specialists (id)
    on delete set null,
  section_id uuid null
    references public.operational_sections (id)
    on delete set null,
  department_id uuid null
    references public.departments (id)
    on delete set null,
  aisle text null,
  bay integer null check (bay is null or bay >= 0),
  observed_at timestamptz not null default now(),
  created_by_specialist_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint walkthrough_observations_type_check
    check (observation_type in ('positive', 'opportunity', 'general')),
  constraint walkthrough_observations_body_nonempty_check
    check (char_length(trim(body)) > 0)
);

comment on table public.walkthrough_observations is
  'RD-5 human-authored walkthrough observation. Optional place + associate links.';

comment on column public.walkthrough_observations.observation_type is
  'positive = recognition/working well; opportunity = improvement; general = operational note.';

create or replace function public.normalize_walkthrough_observation_aisle()
returns trigger
language plpgsql
as $$
begin
  if new.aisle is null then
    return new;
  end if;
  new.aisle := regexp_replace(upper(trim(both from new.aisle)), '\s+', ' ', 'g');
  if char_length(new.aisle) = 0 then
    new.aisle := null;
  end if;
  return new;
end;
$$;

drop trigger if exists walkthrough_observations_normalize_aisle
  on public.walkthrough_observations;
create trigger walkthrough_observations_normalize_aisle
  before insert or update of aisle
  on public.walkthrough_observations
  for each row
  execute function public.normalize_walkthrough_observation_aisle();

create table if not exists public.walkthrough_follow_ups (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    references public.stores (id)
    on delete cascade,
  observation_id uuid not null
    references public.walkthrough_observations (id)
    on delete cascade,
  session_id uuid not null
    references public.walkthrough_sessions (id)
    on delete cascade,
  action_text text not null,
  responsible_specialist_id uuid null
    references public.store_specialists (id)
    on delete set null,
  due_on date null,
  status text not null default 'open',
  completion_evidence text null,
  resolution_notes text null,
  completed_at timestamptz null,
  completed_by_specialist_id text null,
  created_by_specialist_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint walkthrough_follow_ups_action_nonempty_check
    check (char_length(trim(action_text)) > 0),
  constraint walkthrough_follow_ups_status_check
    check (status in ('open', 'done')),
  constraint walkthrough_follow_ups_done_consistency_check
    check (
      (status = 'open' and completed_at is null)
      or (status = 'done' and completed_at is not null)
    )
);

comment on table public.walkthrough_follow_ups is
  'RD-5 optional follow-up linked to an observation. Overdue ≠ performance grade.';

create index if not exists walkthrough_sessions_store_started_idx
  on public.walkthrough_sessions (store_id, started_at desc);

create index if not exists walkthrough_sessions_store_status_idx
  on public.walkthrough_sessions (store_id, status);

create index if not exists walkthrough_observations_store_observed_idx
  on public.walkthrough_observations (store_id, observed_at desc);

create index if not exists walkthrough_observations_session_idx
  on public.walkthrough_observations (session_id, observed_at desc);

create index if not exists walkthrough_observations_place_idx
  on public.walkthrough_observations (store_id, department_id, aisle, bay)
  where aisle is not null;

create index if not exists walkthrough_observations_section_idx
  on public.walkthrough_observations (section_id)
  where section_id is not null;

create index if not exists walkthrough_follow_ups_store_status_idx
  on public.walkthrough_follow_ups (store_id, status, due_on);

create index if not exists walkthrough_follow_ups_observation_idx
  on public.walkthrough_follow_ups (observation_id);

alter table public.walkthrough_sessions enable row level security;
alter table public.walkthrough_observations enable row level security;
alter table public.walkthrough_follow_ups enable row level security;

drop policy if exists "Authenticated read walkthrough sessions"
  on public.walkthrough_sessions;
drop policy if exists "Authenticated read walkthrough observations"
  on public.walkthrough_observations;
drop policy if exists "Authenticated read walkthrough follow ups"
  on public.walkthrough_follow_ups;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise notice 'walkthroughs: skipping RLS policies (authenticated role absent)';
    return;
  end if;

  if to_regprocedure('public.jwt_matches_store(text)') is null then
    raise notice 'walkthroughs: jwt_matches_store missing — open authenticated SELECT';
    execute $policy$
      create policy "Authenticated read walkthrough sessions"
        on public.walkthrough_sessions
        for select
        to authenticated
        using (true)
    $policy$;
    execute $policy$
      create policy "Authenticated read walkthrough observations"
        on public.walkthrough_observations
        for select
        to authenticated
        using (true)
    $policy$;
    execute $policy$
      create policy "Authenticated read walkthrough follow ups"
        on public.walkthrough_follow_ups
        for select
        to authenticated
        using (true)
    $policy$;
    return;
  end if;

  execute $policy$
    create policy "Authenticated read walkthrough sessions"
      on public.walkthrough_sessions
      for select
      to authenticated
      using (
        exists (
          select 1
          from public.stores s
          where s.id = walkthrough_sessions.store_id
            and public.jwt_matches_store(s.store_number)
        )
      )
  $policy$;

  execute $policy$
    create policy "Authenticated read walkthrough observations"
      on public.walkthrough_observations
      for select
      to authenticated
      using (
        exists (
          select 1
          from public.stores s
          where s.id = walkthrough_observations.store_id
            and public.jwt_matches_store(s.store_number)
        )
      )
  $policy$;

  execute $policy$
    create policy "Authenticated read walkthrough follow ups"
      on public.walkthrough_follow_ups
      for select
      to authenticated
      using (
        exists (
          select 1
          from public.stores s
          where s.id = walkthrough_follow_ups.store_id
            and public.jwt_matches_store(s.store_number)
        )
      )
  $policy$;
end $$;

-- No authenticated INSERT/UPDATE/DELETE — service role after API actor checks.

notify pgrst, 'reload schema';
