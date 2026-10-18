-- DEPTSYNC-ROTATION-AUTO-008A — Standing weekly capacity authorization
--
-- Additive: store-scoped standing capacity policy + weekly approval provenance.
-- Weekly approvals remain the authoritative per-week contract; standing policy
-- materializes into store_week_capacity_approvals for future weeks.
--
-- LOCAL / REVIEW ONLY in this tranche — do NOT apply to production here.
-- Does NOT enable WEEKLY_ROTATION_AUTO_PUBLISH.
-- Does NOT mutate assignments, sections, or historical approvals.

begin;

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. Standing policy (versioned; one active row per store)
-- ---------------------------------------------------------------------------

create table if not exists public.store_standing_capacity_policies (
  id uuid primary key default gen_random_uuid(),
  store_number text not null,
  policy_version integer not null check (policy_version >= 1),
  is_active boolean not null default true,
  effective_at timestamptz not null default now(),
  revoked_at timestamptz null,
  established_by_specialist_id text not null,
  note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_standing_capacity_policies_version_unique
    unique (store_number, policy_version)
);

comment on table public.store_standing_capacity_policies is
  'AUTO-008A: MasterAdmin standing weekly bay capacity policy. Prospective only; materializes into weekly approvals.';

create table if not exists public.store_standing_capacity_policy_items (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null
    references public.store_standing_capacity_policies (id) on delete cascade,
  specialist_id text not null,
  approved_capacity integer not null
    check (approved_capacity >= 0 and approved_capacity <= 3),
  created_at timestamptz not null default now(),
  constraint store_standing_capacity_policy_items_unique
    unique (policy_id, specialist_id)
);

comment on table public.store_standing_capacity_policy_items is
  'AUTO-008A: per-associate standing capacity (0–3) within a policy version.';

create unique index if not exists store_standing_capacity_policies_one_active_idx
  on public.store_standing_capacity_policies (store_number)
  where (is_active = true);

create index if not exists store_standing_capacity_policies_store_idx
  on public.store_standing_capacity_policies (store_number, effective_at desc);

-- ---------------------------------------------------------------------------
-- 2. Weekly approval provenance (explicit vs standing materialization)
-- ---------------------------------------------------------------------------

create table if not exists public.store_week_capacity_approval_provenance (
  store_number text not null,
  week_label text not null,
  specialist_id text not null,
  source text not null
    check (source in ('explicit', 'standing')),
  standing_policy_id uuid null
    references public.store_standing_capacity_policies (id) on delete set null,
  materialized_at timestamptz null,
  recorded_at timestamptz not null default now(),
  constraint store_week_capacity_approval_provenance_week_label_check
    check (week_label ~ '^[0-9]{4}-W[0-9]{2}$'),
  constraint store_week_capacity_approval_provenance_pk
    primary key (store_number, week_label, specialist_id),
  constraint store_week_capacity_approval_provenance_standing_id_check
    check (
      (source = 'standing' and standing_policy_id is not null)
      or (source = 'explicit' and standing_policy_id is null)
    )
);

comment on table public.store_week_capacity_approval_provenance is
  'AUTO-008A: whether a weekly approval row came from MasterAdmin explicit week approve or standing-policy materialization.';

create index if not exists store_week_capacity_approval_provenance_week_idx
  on public.store_week_capacity_approval_provenance (store_number, week_label);

-- ---------------------------------------------------------------------------
-- 3. RLS (authenticated read; writes via service role / future RPCs only)
-- ---------------------------------------------------------------------------

alter table public.store_standing_capacity_policies enable row level security;
alter table public.store_standing_capacity_policy_items enable row level security;
alter table public.store_week_capacity_approval_provenance enable row level security;

revoke all on table public.store_standing_capacity_policies from public, anon;
revoke all on table public.store_standing_capacity_policy_items from public, anon;
revoke all on table public.store_week_capacity_approval_provenance from public, anon;

revoke insert, update, delete, truncate, references, trigger
  on table public.store_standing_capacity_policies from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.store_standing_capacity_policy_items from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.store_week_capacity_approval_provenance from authenticated;

grant select on table public.store_standing_capacity_policies to authenticated;
grant select on table public.store_standing_capacity_policy_items to authenticated;
grant select on table public.store_week_capacity_approval_provenance to authenticated;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise notice 'AUTO-008A: skipping RLS policies (authenticated absent)';
    return;
  end if;

  if to_regprocedure('public.jwt_matches_store(text)') is null then
    execute $policy$
      create policy "Authenticated deny standing capacity policies"
        on public.store_standing_capacity_policies
        for select to authenticated using (false)
    $policy$;
    execute $policy$
      create policy "Authenticated deny standing capacity items"
        on public.store_standing_capacity_policy_items
        for select to authenticated using (false)
    $policy$;
    execute $policy$
      create policy "Authenticated deny capacity provenance"
        on public.store_week_capacity_approval_provenance
        for select to authenticated using (false)
    $policy$;
  else
    execute $policy$
      create policy "Authenticated read standing capacity policies"
        on public.store_standing_capacity_policies
        for select to authenticated
        using (public.jwt_matches_store(store_standing_capacity_policies.store_number))
    $policy$;
    execute $policy$
      create policy "Authenticated read standing capacity items"
        on public.store_standing_capacity_policy_items
        for select to authenticated
        using (
          exists (
            select 1
            from public.store_standing_capacity_policies p
            where p.id = store_standing_capacity_policy_items.policy_id
              and public.jwt_matches_store(p.store_number)
          )
        )
    $policy$;
    execute $policy$
      create policy "Authenticated read capacity approval provenance"
        on public.store_week_capacity_approval_provenance
        for select to authenticated
        using (public.jwt_matches_store(store_week_capacity_approval_provenance.store_number))
    $policy$;
  end if;
exception
  when duplicate_object then
    null;
end $$;

commit;
