-- AI bay audit persistence — multimodal completion gate verdicts
-- Depends on: weekly_rotations, departments, JWT helpers (20260812_jwt_rls_policies.sql)

create extension if not exists "pgcrypto";

create table if not exists public.bay_audit_logs (
  id uuid primary key default gen_random_uuid(),
  store_number text not null,
  department_id uuid not null references public.departments (id) on delete cascade,
  bay_number text not null,
  rotation_id uuid references public.weekly_rotations (id) on delete set null,
  actor_id uuid,
  verdict text not null check (verdict in ('PASS', 'CONDITIONAL', 'FAIL')),
  rubric jsonb not null default '{}'::jsonb,
  detected_issues jsonb not null default '[]'::jsonb,
  carton_estimate integer,
  image_url text,
  source text not null default 'gemini' check (source in ('gemini', 'local')),
  supervisor_override boolean not null default false,
  override_by uuid,
  latency_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists bay_audit_logs_store_dept_bay_idx
  on public.bay_audit_logs (store_number, department_id, bay_number);

create index if not exists bay_audit_logs_created_at_idx
  on public.bay_audit_logs (created_at desc);

comment on table public.bay_audit_logs is
  'Persisted AI bay audit verdicts (Snap Bay / completion gate)';

alter table public.bay_audit_logs enable row level security;

drop policy if exists "Enforce Store and Department Isolation"
  on public.bay_audit_logs;

do $$
begin
  if exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'jwt_matches_store'
  ) then
    execute $policy$
      create policy "Enforce Store and Department Isolation"
        on public.bay_audit_logs
        for all
        to authenticated
        using (
          public.jwt_matches_store(bay_audit_logs.store_number)
          and exists (
            select 1
            from public.departments d
            where d.id = bay_audit_logs.department_id
              and public.jwt_matches_store(d.store_number)
          )
        )
        with check (
          public.jwt_matches_store(bay_audit_logs.store_number)
          and exists (
            select 1
            from public.departments d
            where d.id = bay_audit_logs.department_id
              and public.jwt_matches_store(d.store_number)
          )
        )
    $policy$;
  else
    execute $policy$
      create policy "Enforce Store and Department Isolation"
        on public.bay_audit_logs
        for all
        to authenticated
        using (
          store_number = (auth.jwt() -> 'app_metadata' ->> 'store_number')
        )
        with check (
          store_number = (auth.jwt() -> 'app_metadata' ->> 'store_number')
        )
    $policy$;
  end if;
end $$;

notify pgrst, 'reload schema';
