-- APP-AUD-001: Appliance physical audit sessions + reconciliation snapshots.
-- Physical scans remain OBSERVED evidence; Lowe's OH is DECLARED snapshot only.
-- No Lowe's/SIMS/Zebra integration.

alter table public.appliance_scans
  add column if not exists audit_session_id uuid;

create table if not exists public.appliance_audit_sessions (
  id uuid primary key default gen_random_uuid(),
  store_number text not null,
  status text not null default 'ACTIVE',
  started_at timestamptz not null default now(),
  closed_at timestamptz,
  started_by text not null default '',
  closed_by text,
  notes text not null default '',
  created_at timestamptz not null default now(),
  constraint appliance_audit_sessions_status_check
    check (status in ('ACTIVE', 'CLOSED')),
  constraint appliance_audit_sessions_closed_pair_check
    check (
      (status = 'ACTIVE' and closed_at is null and closed_by is null)
      or (status = 'CLOSED' and closed_at is not null)
    )
);

comment on table public.appliance_audit_sessions is
  'Groups OBSERVED appliance_scans into a durable physical audit. ACTIVE|CLOSED only.';

create unique index if not exists appliance_audit_sessions_one_active_per_store_uidx
  on public.appliance_audit_sessions (store_number)
  where status = 'ACTIVE';

create index if not exists appliance_audit_sessions_store_started_idx
  on public.appliance_audit_sessions (store_number, started_at desc);

-- Link scans after sessions table exists (idempotent if column already present).
do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'appliance_scans'
      and constraint_name = 'appliance_scans_audit_session_id_fkey'
  ) then
    alter table public.appliance_scans
      add constraint appliance_scans_audit_session_id_fkey
      foreign key (audit_session_id)
      references public.appliance_audit_sessions (id)
      on delete set null;
  end if;
end $$;

create index if not exists appliance_scans_audit_session_idx
  on public.appliance_scans (audit_session_id, scanned_at desc)
  where audit_session_id is not null;

create table if not exists public.appliance_reconciliation_snapshots (
  id uuid primary key default gen_random_uuid(),
  audit_session_id uuid not null
    references public.appliance_audit_sessions (id)
    on delete restrict,
  store_number text not null,
  item_number text not null,
  physical_count integer not null check (physical_count >= 0),
  declared_lowes_oh integer,
  variance integer,
  outcome text,
  notes text not null default '',
  reconciled_by text not null default '',
  reconciled_at timestamptz not null default now(),
  constraint appliance_recon_outcome_check
    check (
      outcome is null
      or outcome in ('RESOLVED', 'NEEDS_FOLLOW_UP')
    ),
  constraint appliance_recon_oh_variance_check
    check (
      (declared_lowes_oh is null and variance is null)
      or (
        declared_lowes_oh is not null
        and declared_lowes_oh >= 0
        and variance = physical_count - declared_lowes_oh
      )
    ),
  constraint appliance_recon_session_item_uidx
    unique (audit_session_id, item_number)
);

comment on table public.appliance_reconciliation_snapshots is
  'Latest DECLARED Lowe''s OH + DERIVED variance per audit item (mutable upsert). Not versioned declaration history. Not system OH.';

comment on column public.appliance_reconciliation_snapshots.declared_lowes_oh is
  'Human-declared Lowe''s on-hand at last reconcile save. NULL = not yet entered (not zero). Overwritten on re-save.';

comment on column public.appliance_reconciliation_snapshots.variance is
  'DERIVED: physical_count - declared_lowes_oh when OH is set; else NULL.';

create index if not exists appliance_recon_store_reconciled_idx
  on public.appliance_reconciliation_snapshots (store_number, reconciled_at desc);

-- APP-AUD-001A: observation-time bind for CLOSED audits (covers direct client upsert replay).
create or replace function public.appliance_scans_enforce_audit_bind()
returns trigger
language plpgsql
as $$
declare
  sess record;
begin
  if new.audit_session_id is null then
    return new;
  end if;

  select status, started_at, closed_at
    into sess
  from public.appliance_audit_sessions
  where id = new.audit_session_id;

  if not found then
    raise exception 'audit_session_id not found';
  end if;

  if sess.status = 'ACTIVE' then
    return new;
  end if;

  if sess.status = 'CLOSED' then
    if new.scanned_at is null then
      raise exception 'scanned_at is required to join a closed physical audit';
    end if;
    if sess.started_at is null or sess.closed_at is null then
      raise exception 'Closed physical audit is missing started_at/closed_at';
    end if;
    if new.scanned_at < sess.started_at then
      raise exception 'Observation time is before this physical audit started';
    end if;
    if new.scanned_at > sess.closed_at then
      raise exception 'Physical audit is closed — observation time is after close';
    end if;
    return new;
  end if;

  raise exception 'Unknown physical audit status';
end;
$$;

drop trigger if exists appliance_scans_enforce_audit_bind_trg
  on public.appliance_scans;
create trigger appliance_scans_enforce_audit_bind_trg
  before insert or update of audit_session_id, scanned_at
  on public.appliance_scans
  for each row
  execute function public.appliance_scans_enforce_audit_bind();

alter table public.appliance_audit_sessions enable row level security;
alter table public.appliance_reconciliation_snapshots enable row level security;

-- RLS: when authenticated + jwt_matches_store exist, create store-isolation policies.
-- If either is missing, RLS stays enabled with no policies → fail-closed for JWT roles
-- (service-role / admin API bypasses RLS). Production prerequisite: apply
-- 20260812_jwt_rls_policies.sql / 20260816_rls_read_write_parity.sql first so
-- jwt_matches_store exists before this migration.
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise notice 'APP-AUD-001: skipping RLS policies (authenticated role absent)';
    return;
  end if;

  if not exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'jwt_matches_store'
  ) then
    raise notice 'APP-AUD-001: jwt_matches_store missing — RLS policies skipped (fail-closed; admin API still usable)';
    return;
  end if;

  foreach t in array array[
    'appliance_audit_sessions',
    'appliance_reconciliation_snapshots'
  ]
  loop
    execute format('revoke all on table public.%I from anon', t);
    execute format(
      'grant select, insert, update, delete on table public.%I to authenticated',
      t
    );
    execute format('drop policy if exists %I on public.%I',
      'Enforce Store Isolation on ' || t, t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (public.jwt_matches_store(store_number))
         with check (public.jwt_matches_store(store_number))',
      'Enforce Store Isolation on ' || t,
      t
    );
  end loop;
end $$;

notify pgrst, 'reload schema';
