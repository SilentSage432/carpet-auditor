-- RLS security lockdown — Hub + Store Ops
-- Closes anon/public FOR ALL and open SELECT USING (true) added for Hub-bridge
-- parity (20260816_store_locations_read.sql, 20260816_rls_read_write_parity.sql).
--
-- Canonical table names (requested aliases do not exist in this schema):
--   sunday_audit_assignments  → sunday_bay_assignments
--   department_downstock_items → downstock_queue
--
-- Login / PIN verify stay on service-role Hub-bridge (POST /api/auth/hub-bridge).
-- After apply: authenticated Hub-bridge JWT is required for client table access.
-- Depends on: jwt_matches_store (digit-equal), jwt_matches_department_code,
-- jwt_is_elevated, jwt_app_role from 20260812 + 20260816.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.jwt_is_roster_admin()
returns boolean
language sql
stable
as $$
  select
    public.jwt_is_elevated()
    or public.jwt_app_role() in ('department_supervisor', 'supervisor');
$$;

comment on function public.jwt_is_roster_admin() is
  'Master / store manager / department supervisor — roster INSERT/UPDATE/DELETE.';

-- Live store_id columns are uuid on some tables and text on others (bay_service_logs).
-- Accept text and compare both stores.id::text and digit-equal store_number.
drop function if exists public.jwt_row_matches_store(text, uuid);

create or replace function public.jwt_row_matches_store(
  p_store_number text,
  p_store_id text
)
returns boolean
language sql
stable
as $$
  select
    public.jwt_matches_store(p_store_number)
    or public.jwt_matches_store(p_store_id)
    or (
      p_store_id is not null
      and nullif(trim(p_store_id), '') is not null
      and exists (
        select 1
        from public.stores s
        where s.id::text = p_store_id
          and public.jwt_matches_store(s.store_number)
      )
    );
$$;

comment on function public.jwt_row_matches_store(text, text) is
  'Store isolation via store_number and/or stores.id (uuid or text) → store_number.';

-- ---------------------------------------------------------------------------
-- 1) store_specialists — drop anon/public; store-scoped authenticated
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  secret_col text;
begin
  if to_regclass('public.store_specialists') is null then
    return;
  end if;

  alter table public.store_specialists enable row level security;

  for r in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'store_specialists'
  loop
    execute format(
      'drop policy if exists %I on public.store_specialists',
      r.policyname
    );
  end loop;

  revoke all on table public.store_specialists from anon;
  grant select, insert, update, delete on table public.store_specialists
    to authenticated;

  foreach secret_col in array array[
    'pin_code',
    'pin_hash',
    'temp_pin_hash',
    'invite_token',
    'invite_token_hash',
    'auth_token_hash'
  ]
  loop
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'store_specialists'
        and column_name = secret_col
    ) then
      execute format(
        'revoke select (%I) on public.store_specialists from anon, authenticated',
        secret_col
      );
    end if;
  end loop;

  create policy "store_specialists_select_store"
    on public.store_specialists
    for select
    to authenticated
    using (public.jwt_matches_store(store_number));

  create policy "store_specialists_write_roster_admin"
    on public.store_specialists
    for insert
    to authenticated
    with check (
      public.jwt_matches_store(store_number)
      and public.jwt_is_roster_admin()
    );

  create policy "store_specialists_update_roster_admin"
    on public.store_specialists
    for update
    to authenticated
    using (
      public.jwt_matches_store(store_number)
      and public.jwt_is_roster_admin()
    )
    with check (
      public.jwt_matches_store(store_number)
      and public.jwt_is_roster_admin()
    );

  create policy "store_specialists_delete_roster_admin"
    on public.store_specialists
    for delete
    to authenticated
    using (
      public.jwt_matches_store(store_number)
      and public.jwt_is_roster_admin()
    );
end $$;

-- ---------------------------------------------------------------------------
-- 2) Hub inventory — authenticated + jwt_matches_store on all ops
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  r record;
  hub text[] := array[
    'carpet_audits',
    'carpet_catalog',
    'carpet_remnants',
    'appliance_catalog',
    'appliance_scans'
  ];
begin
  foreach t in array hub
  loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = t
        and column_name = 'store_number'
    ) then
      raise notice 'skip hub lockdown: %.store_number missing', t;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    for r in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = t
    loop
      execute format('drop policy if exists %I on public.%I', r.policyname, t);
    end loop;

    execute format('revoke all on table public.%I from anon', t);
    execute format(
      'grant select, insert, update, delete on table public.%I to authenticated',
      t
    );

    execute format(
      'create policy %I on public.%I for all to authenticated
         using (public.jwt_matches_store(store_number))
         with check (public.jwt_matches_store(store_number))',
      'Enforce Store Isolation on ' || t,
      t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3) manager_notes — store + department (department_code or department)
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  dept_expr text;
  has_code boolean;
  has_dept boolean;
begin
  if to_regclass('public.manager_notes') is null then
    return;
  end if;

  alter table public.manager_notes enable row level security;

  for r in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'manager_notes'
  loop
    execute format(
      'drop policy if exists %I on public.manager_notes',
      r.policyname
    );
  end loop;

  revoke all on table public.manager_notes from anon;
  grant select, insert, update, delete on table public.manager_notes
    to authenticated;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'manager_notes'
      and column_name = 'department_code'
  ) into has_code;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'manager_notes'
      and column_name = 'department'
  ) into has_dept;

  if has_code and has_dept then
    dept_expr :=
      'public.jwt_matches_department_code(coalesce(nullif(trim(department_code), ''''), nullif(trim(department), '''')))';
  elsif has_code then
    dept_expr := 'public.jwt_matches_department_code(department_code)';
  elsif has_dept then
    dept_expr := 'public.jwt_matches_department_code(department)';
  else
    dept_expr := 'true';
    raise notice 'manager_notes has no department columns — store isolation only';
  end if;

  execute format(
    'create policy %I on public.manager_notes for all to authenticated
       using (public.jwt_matches_store(store_number) and %s)
       with check (public.jwt_matches_store(store_number) and %s)',
    'Enforce Store and Department Isolation',
    dept_expr,
    dept_expr
  );
end $$;

-- ---------------------------------------------------------------------------
-- 4) Store Ops — drop open SELECT USING (true); store-scoped authenticated SELECT
--    Writes keep existing JWT FOR ALL (store + department) policies.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  r record;
  has_store_number boolean;
  has_store_id boolean;
  tables text[] := array[
    'store_locations',
    'weekly_rotations',
    'sunday_bay_assignments',
    'bay_service_logs',
    'downstock_queue',
    'shift_walk_tasks',
    'associate_shift_days',
    'rotation_exceptions',
    'carpet_audits',
    'carpet_catalog',
    'carpet_remnants',
    'appliance_catalog',
    'appliance_scans'
  ];
begin
  -- Named open-read policies from 20260816 (including the spaced store_locations name)
  foreach t in array tables
  loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);
    execute format(
      'drop policy if exists %I on public.%I',
      'Allow read access for ' || t,
      t
    );
  end loop;

  drop policy if exists "Allow read access for store locations"
    on public.store_locations;

  foreach t in array tables
  loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;

    -- Any remaining SELECT USING (true) / anon SELECT
    for r in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = t
        and cmd = 'SELECT'
        and (
          coalesce(qual, '') in ('true', '(true)')
          or 'anon' = any (roles)
        )
    loop
      execute format('drop policy if exists %I on public.%I', r.policyname, t);
    end loop;

    execute format('revoke select on table public.%I from anon', t);
    execute format('grant select on table public.%I to authenticated', t);

    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'store_number'
    ) into has_store_number;
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'store_id'
    ) into has_store_id;

    execute format(
      'drop policy if exists %I on public.%I',
      'Allow authenticated store-scoped select',
      t
    );

    if t = 'rotation_exceptions' then
      execute $policy$
        create policy "Allow authenticated store-scoped select"
          on public.rotation_exceptions
          for select
          to authenticated
          using (
            exists (
              select 1
              from public.departments d
              where d.id = rotation_exceptions.department_id
                and public.jwt_matches_store(d.store_number)
            )
          )
      $policy$;
    elsif t = 'bay_service_logs' and has_store_id then
      execute $policy$
        create policy "Allow authenticated store-scoped select"
          on public.bay_service_logs
          for select
          to authenticated
          using (
            public.jwt_row_matches_store(
              null::text,
              bay_service_logs.store_id::text
            )
          )
      $policy$;
    elsif has_store_number and has_store_id then
      execute format(
        'create policy %I on public.%I for select to authenticated
           using (public.jwt_row_matches_store(%I.store_number::text, %I.store_id::text))',
        'Allow authenticated store-scoped select',
        t,
        t,
        t
      );
    elsif has_store_number then
      execute format(
        'create policy %I on public.%I for select to authenticated
           using (public.jwt_matches_store(store_number))',
        'Allow authenticated store-scoped select',
        t
      );
    elsif has_store_id then
      execute format(
        'create policy %I on public.%I for select to authenticated
           using (public.jwt_row_matches_store(null::text, store_id::text))',
        'Allow authenticated store-scoped select',
        t
      );
    else
      raise notice 'skip store-scoped SELECT: % has neither store_number nor store_id', t;
    end if;
  end loop;
end $$;

-- Hub inventory already received FOR ALL store isolation above; the extra
-- SELECT policy is redundant but equivalent (permissive OR). Leave it.

-- ---------------------------------------------------------------------------
-- 5) Realtime publication — sunday_bay_assignments, manager_notes, downstock_queue
-- ---------------------------------------------------------------------------
do $$
declare
  pub text := 'supabase_realtime';
  t text;
  realtime_tables text[] := array[
    'sunday_bay_assignments',
    'manager_notes',
    'downstock_queue'
  ];
begin
  if not exists (select 1 from pg_publication where pubname = pub) then
    raise notice 'skip realtime: publication % missing', pub;
    return;
  end if;

  foreach t in array realtime_tables
  loop
    if to_regclass('public.' || t) is null then
      raise notice 'skip realtime: table % missing', t;
      continue;
    end if;
    begin
      execute format(
        'alter publication %I add table only public.%I',
        pub,
        t
      );
    exception
      when duplicate_object then
        raise notice '% already in %', t, pub;
    end;
  end loop;
end $$;

comment on table public.store_specialists is
  'Hub roster — authenticated store SELECT; INSERT/UPDATE/DELETE roster admin only. Secrets revoked from client roles.';
