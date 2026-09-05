-- FS-002 Operational seasons & events foundation.
-- Declared context occurrences (global or store-scoped) + department relevance.
-- Gregorian date ranges; no recurrence; no location priority; no intelligence.
-- Writes via service role after Master actor auth. Authenticated read only.

create extension if not exists "pgcrypto";

create table if not exists public.operational_contexts (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  store_id uuid null
    references public.stores (id)
    on delete cascade,
  title text not null,
  concept_key text null,
  start_date date not null,
  end_date date not null,
  source_type text not null,
  source_reference text null,
  source_year integer null,
  declared_by uuid null
    references public.profiles (id)
    on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operational_contexts_kind_check
    check (kind in ('SEASON', 'EVENT')),
  constraint operational_contexts_source_type_check
    check (
      source_type in (
        'COMPANY_PUBLISHED',
        'PUBLIC_CALENDAR',
        'MASTER_ADMIN_DECLARED'
      )
    ),
  constraint operational_contexts_date_order_check
    check (start_date <= end_date),
  constraint operational_contexts_title_nonempty_check
    check (char_length(trim(title)) > 0)
);

comment on table public.operational_contexts is
  'FS-002 declared season/event occurrences. store_id NULL = global. Not SYSTEM_DERIVED.';

comment on column public.operational_contexts.store_id is
  'NULL = global/shared company or public context; set = store-scoped Master declaration.';

comment on column public.operational_contexts.source_type is
  'COMPANY_PUBLISHED | PUBLIC_CALENDAR | MASTER_ADMIN_DECLARED — never SYSTEM_DERIVED.';

comment on column public.operational_contexts.declared_by is
  'profiles.id of Master who declared MASTER_ADMIN_DECLARED context; null for imported rows.';

create table if not exists public.operational_context_department_relevance (
  id uuid primary key default gen_random_uuid(),
  context_id uuid not null
    references public.operational_contexts (id)
    on delete cascade,
  department_code text not null,
  relevance text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operational_context_dept_relevance_unique
    unique (context_id, department_code),
  constraint operational_context_dept_relevance_level_check
    check (relevance in ('NONE', 'LOW', 'MEDIUM', 'HIGH')),
  constraint operational_context_dept_code_nonempty_check
    check (char_length(trim(department_code)) > 0)
);

comment on table public.operational_context_department_relevance is
  'FS-002 declared department relevance. Missing row = UNSET; NONE = explicit no relevance.';

create index if not exists operational_contexts_date_range_idx
  on public.operational_contexts (start_date, end_date);

create index if not exists operational_contexts_store_dates_idx
  on public.operational_contexts (store_id, start_date, end_date);

create index if not exists operational_contexts_kind_idx
  on public.operational_contexts (kind);

create index if not exists operational_context_dept_relevance_context_idx
  on public.operational_context_department_relevance (context_id);

alter table public.operational_contexts enable row level security;
alter table public.operational_context_department_relevance enable row level security;

drop policy if exists "Authenticated read operational contexts"
  on public.operational_contexts;
drop policy if exists "Authenticated read operational context relevance"
  on public.operational_context_department_relevance;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise notice 'operational_contexts: skipping RLS policies (authenticated role absent)';
    return;
  end if;

  if to_regprocedure('public.jwt_matches_store(text)') is null then
    raise notice 'operational_contexts: jwt_matches_store missing — using open authenticated SELECT';
    execute $policy$
      create policy "Authenticated read operational contexts"
        on public.operational_contexts
        for select
        to authenticated
        using (true)
    $policy$;
    execute $policy$
      create policy "Authenticated read operational context relevance"
        on public.operational_context_department_relevance
        for select
        to authenticated
        using (true)
    $policy$;
    return;
  end if;

  -- Global rows (store_id IS NULL) readable by any authenticated actor.
  -- Store-scoped rows: actor JWT must match the store via stores.store_number.
  -- No authenticated write policies — mutations are service-role only.
  execute $policy$
    create policy "Authenticated read operational contexts"
      on public.operational_contexts
      for select
      to authenticated
      using (
        store_id is null
        or exists (
          select 1
          from public.stores s
          where s.id = operational_contexts.store_id
            and public.jwt_matches_store(s.store_number)
        )
      )
  $policy$;

  execute $policy$
    create policy "Authenticated read operational context relevance"
      on public.operational_context_department_relevance
      for select
      to authenticated
      using (
        exists (
          select 1
          from public.operational_contexts c
          where c.id = operational_context_department_relevance.context_id
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
      )
  $policy$;
end $$;

notify pgrst, 'reload schema';
