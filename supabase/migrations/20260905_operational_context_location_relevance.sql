-- FS-003 Location seasonal relevance foundation.
-- Declared (context, location) → NONE|LOW|MEDIUM|HIGH.
-- Missing row = UNSET. Does not mutate bay priority / rotations / SI.
-- Writes via service role after Master actor auth. Authenticated read only.

create extension if not exists "pgcrypto";

create table if not exists public.operational_context_location_relevance (
  id uuid primary key default gen_random_uuid(),
  context_id uuid not null
    references public.operational_contexts (id)
    on delete cascade,
  location_id uuid not null
    references public.store_locations (id)
    on delete cascade,
  relevance text not null,
  declared_by uuid null
    references public.profiles (id)
    on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operational_context_loc_relevance_unique
    unique (context_id, location_id),
  constraint operational_context_loc_relevance_level_check
    check (relevance in ('NONE', 'LOW', 'MEDIUM', 'HIGH'))
);

comment on table public.operational_context_location_relevance is
  'FS-003 declared location seasonal relevance. Missing row = UNSET; NONE = explicit no relevance. Does not mutate store_locations priority fields.';

comment on column public.operational_context_location_relevance.declared_by is
  'profiles.id of Master who last set this location relevance.';

create index if not exists operational_context_loc_relevance_context_idx
  on public.operational_context_location_relevance (context_id);

create index if not exists operational_context_loc_relevance_location_idx
  on public.operational_context_location_relevance (location_id);

alter table public.operational_context_location_relevance enable row level security;

drop policy if exists "Authenticated read operational context location relevance"
  on public.operational_context_location_relevance;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise notice 'operational_context_location_relevance: skipping RLS (authenticated role absent)';
    return;
  end if;

  if to_regprocedure('public.jwt_matches_store(text)') is null then
    raise notice 'operational_context_location_relevance: jwt_matches_store missing — open authenticated SELECT';
    execute $policy$
      create policy "Authenticated read operational context location relevance"
        on public.operational_context_location_relevance
        for select
        to authenticated
        using (true)
    $policy$;
    return;
  end if;

  -- Readable when parent context is global or matches actor store,
  -- and the location belongs to a store the actor may read.
  execute $policy$
    create policy "Authenticated read operational context location relevance"
      on public.operational_context_location_relevance
      for select
      to authenticated
      using (
        exists (
          select 1
          from public.operational_contexts c
          where c.id = operational_context_location_relevance.context_id
            and (
              c.store_id is null
              or exists (
                select 1
                from public.stores s
                where s.id = c.store_id
                  and public.jwt_matches_store(s.store_number)
              )
            )
        )
        and exists (
          select 1
          from public.store_locations sl
          join public.stores s on s.id = sl.store_id
          where sl.id = operational_context_location_relevance.location_id
            and public.jwt_matches_store(s.store_number)
        )
      )
  $policy$;
end $$;

notify pgrst, 'reload schema';
