-- Phase 1 — Security & Identity Handshake (defensive / self-healing)
-- JWT custom claims (store_number, department, role) + store/department RLS.
-- Safe to re-run on partial schemas: skips missing tables; prefers store_number.
--
-- After apply: enable Custom Access Token Hook in Supabase Dashboard
--   Auth → Hooks → Custom Access Token → public.custom_access_token_hook

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enum: user_role (create if missing, else append associate / elevated roles)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'user_role'
      and n.nspname = 'public'
  ) then
    create type public.user_role as enum (
      'super_admin',
      'master_admin',
      'store_manager',
      'department_supervisor',
      'specialist',
      'associate'
    );
  else
    alter type public.user_role add value if not exists 'associate';
    alter type public.user_role add value if not exists 'master_admin';
    alter type public.user_role add value if not exists 'store_manager';
    alter type public.user_role add value if not exists 'specialist';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Profiles: link to hub roster + store_number for JWT / actor resolution
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'profiles'
  ) then
    alter table public.profiles add column if not exists store_number text;
    alter table public.profiles add column if not exists specialist_id text;

    create index if not exists profiles_store_number_idx
      on public.profiles (store_number);
    create index if not exists profiles_specialist_id_idx
      on public.profiles (specialist_id);

    comment on column public.profiles.id is
      'Equals auth.users.id — one profile per Supabase Auth user';
    comment on column public.profiles.specialist_id is
      'Optional bridge to store_specialists.id (hub roster)';
    comment on column public.profiles.store_number is
      'Hub store_number mirrored into JWT app_metadata.store_number';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- JWT claim helpers (read app_metadata injected by hook / raw_app_meta_data)
-- ---------------------------------------------------------------------------
create or replace function public.jwt_store_number()
returns text
language sql
stable
as $$
  select nullif(
    trim(coalesce(
      auth.jwt() -> 'app_metadata' ->> 'store_number',
      auth.jwt() -> 'user_metadata' ->> 'store_number',
      ''
    )),
    ''
  );
$$;

create or replace function public.jwt_department()
returns text
language sql
stable
as $$
  select nullif(
    trim(coalesce(
      auth.jwt() -> 'app_metadata' ->> 'department',
      auth.jwt() -> 'user_metadata' ->> 'department',
      ''
    )),
    ''
  );
$$;

create or replace function public.jwt_app_role()
returns text
language sql
stable
as $$
  select nullif(
    trim(coalesce(
      auth.jwt() -> 'app_metadata' ->> 'role',
      auth.jwt() -> 'user_metadata' ->> 'role',
      ''
    )),
    ''
  );
$$;

/** Elevated: Master Admin / store manager — cross-department within store. */
create or replace function public.jwt_is_elevated()
returns boolean
language sql
stable
as $$
  select public.jwt_app_role() in ('master_admin', 'super_admin', 'store_manager');
$$;

create or replace function public.jwt_matches_store(p_store_number text)
returns boolean
language sql
stable
as $$
  select
    public.jwt_store_number() is not null
    and p_store_number is not null
    and public.jwt_store_number() = p_store_number;
$$;

create or replace function public.jwt_matches_department_code(p_code text)
returns boolean
language sql
stable
as $$
  select
    public.jwt_is_elevated()
    or (
      public.jwt_department() is not null
      and p_code is not null
      and public.jwt_department() = p_code
    );
$$;

-- ---------------------------------------------------------------------------
-- Sync raw_app_meta_data from profiles (callable from triggers / admin)
-- ---------------------------------------------------------------------------
create or replace function public.sync_profile_app_metadata(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store text;
  v_role text;
  v_dept text;
  v_jwt_role text;
  v_specialist text;
begin
  if not exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'profiles'
  ) then
    return;
  end if;

  select
    p.store_number,
    p.role::text,
    d.code,
    p.specialist_id
  into v_store, v_role, v_dept, v_specialist
  from public.profiles p
  left join public.departments d on d.id = p.assigned_department_id
  where p.id = p_user_id;

  if not found then
    return;
  end if;

  v_jwt_role := case
    when v_role = 'super_admin' then 'master_admin'
    else coalesce(v_role, 'department_supervisor')
  end;

  update auth.users
  set raw_app_meta_data =
    coalesce(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object(
      'store_number', v_store,
      'department', v_dept,
      'role', v_jwt_role,
      'specialist_id', v_specialist
    )
  where id = p_user_id;
end;
$$;

create or replace function public.trg_profiles_sync_app_metadata()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_profile_app_metadata(new.id);
  return new;
end;
$$;

do $$
begin
  if exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'profiles'
  ) then
    drop trigger if exists profiles_sync_app_metadata on public.profiles;
    create trigger profiles_sync_app_metadata
      after insert or update of store_number, role, assigned_department_id, specialist_id
      on public.profiles
      for each row
      execute function public.trg_profiles_sync_app_metadata();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Custom Access Token Hook — inject claims into every issued JWT
-- Enable in Dashboard: Auth → Hooks → Custom Access Token
-- ---------------------------------------------------------------------------
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  claims jsonb;
  uid uuid;
  v_store text;
  v_role text;
  v_dept text;
  v_jwt_role text;
  v_specialist text;
begin
  uid := (event ->> 'user_id')::uuid;
  claims := event -> 'claims';
  if claims is null then
    claims := '{}'::jsonb;
  end if;

  if exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'profiles'
  ) then
    select
      p.store_number,
      p.role::text,
      d.code,
      p.specialist_id
    into v_store, v_role, v_dept, v_specialist
    from public.profiles p
    left join public.departments d on d.id = p.assigned_department_id
    where p.id = uid;

    if found then
      v_jwt_role := case
        when v_role = 'super_admin' then 'master_admin'
        else coalesce(v_role, 'department_supervisor')
      end;

      claims := jsonb_set(
        claims,
        '{app_metadata}',
        coalesce(claims -> 'app_metadata', '{}'::jsonb)
          || jsonb_build_object(
            'store_number', v_store,
            'department', v_dept,
            'role', v_jwt_role,
            'specialist_id', v_specialist
          ),
        true
      );
    end if;
  end if;

  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

-- ---------------------------------------------------------------------------
-- Helpers: ensure store_number column + backfill (never assumes store_id)
-- ---------------------------------------------------------------------------
create or replace function public._ensure_store_number_column(p_table text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = p_table
  ) then
    return;
  end if;

  execute format(
    'alter table public.%I add column if not exists store_number text',
    p_table
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS: stores
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'stores'
  ) then
    alter table public.stores enable row level security;

    drop policy if exists "super_admin all stores" on public.stores;
    drop policy if exists "Enforce Store Isolation on stores" on public.stores;

    create policy "Enforce Store Isolation on stores"
      on public.stores
      for all
      to authenticated
      using (public.jwt_matches_store(store_number))
      with check (
        public.jwt_matches_store(store_number)
        and public.jwt_is_elevated()
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- RLS: departments — store_number + department code
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'departments'
  ) then
    perform public._ensure_store_number_column('departments');

    -- Backfill from stores via store_id only when that column exists
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'departments'
        and column_name = 'store_id'
    ) and exists (
      select 1 from pg_tables
      where schemaname = 'public' and tablename = 'stores'
    ) then
      execute $q$
        update public.departments d
        set store_number = s.store_number
        from public.stores s
        where s.id = d.store_id
          and (d.store_number is null or trim(d.store_number) = '')
      $q$;
    end if;

    create index if not exists departments_store_number_idx
      on public.departments (store_number);

    alter table public.departments enable row level security;

    drop policy if exists "super_admin all departments" on public.departments;
    drop policy if exists "supervisor read departments" on public.departments;
    drop policy if exists "supervisor update departments" on public.departments;
    drop policy if exists "Enforce Store and Department Isolation" on public.departments;

    create policy "Enforce Store and Department Isolation"
      on public.departments
      for all
      to authenticated
      using (
        public.jwt_matches_store(departments.store_number)
        and public.jwt_matches_department_code(departments.code)
      )
      with check (
        public.jwt_matches_store(departments.store_number)
        and public.jwt_matches_department_code(departments.code)
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- RLS: store_locations — store_number + department
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'store_locations'
  ) then
    perform public._ensure_store_number_column('store_locations');

    -- Backfill via departments.store_number (no store_id required)
    if exists (
      select 1 from pg_tables
      where schemaname = 'public' and tablename = 'departments'
    ) then
      execute $q$
        update public.store_locations sl
        set store_number = d.store_number
        from public.departments d
        where d.id = sl.department_id
          and d.store_number is not null
          and (sl.store_number is null or trim(sl.store_number) = '')
      $q$;
    end if;

    create index if not exists store_locations_store_number_idx
      on public.store_locations (store_number);

    alter table public.store_locations enable row level security;

    drop policy if exists "super_admin all store_locations" on public.store_locations;
    drop policy if exists "supervisor read store_locations" on public.store_locations;
    drop policy if exists "supervisor update store_locations" on public.store_locations;
    drop policy if exists "Enforce Store and Department Isolation" on public.store_locations;

    create policy "Enforce Store and Department Isolation"
      on public.store_locations
      for all
      to authenticated
      using (
        public.jwt_matches_store(store_locations.store_number)
        and exists (
          select 1 from public.departments d
          where d.id = store_locations.department_id
            and public.jwt_matches_department_code(d.code)
        )
      )
      with check (
        public.jwt_matches_store(store_locations.store_number)
        and exists (
          select 1 from public.departments d
          where d.id = store_locations.department_id
            and public.jwt_matches_department_code(d.code)
        )
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- RLS: weekly_rotations — store_number + department
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'weekly_rotations'
  ) then
    perform public._ensure_store_number_column('weekly_rotations');

    if exists (
      select 1 from pg_tables
      where schemaname = 'public' and tablename = 'departments'
    ) then
      execute $q$
        update public.weekly_rotations wr
        set store_number = d.store_number
        from public.departments d
        where d.id = wr.department_id
          and d.store_number is not null
          and (wr.store_number is null or trim(wr.store_number) = '')
      $q$;
    end if;

    create index if not exists weekly_rotations_store_number_idx
      on public.weekly_rotations (store_number);

    alter table public.weekly_rotations enable row level security;

    drop policy if exists "super_admin all weekly_rotations" on public.weekly_rotations;
    drop policy if exists "supervisor read weekly_rotations" on public.weekly_rotations;
    drop policy if exists "supervisor update weekly_rotations" on public.weekly_rotations;
    drop policy if exists "Enforce Store and Department Isolation" on public.weekly_rotations;

    create policy "Enforce Store and Department Isolation"
      on public.weekly_rotations
      for all
      to authenticated
      using (
        public.jwt_matches_store(weekly_rotations.store_number)
        and exists (
          select 1 from public.departments d
          where d.id = weekly_rotations.department_id
            and public.jwt_matches_department_code(d.code)
        )
      )
      with check (
        public.jwt_matches_store(weekly_rotations.store_number)
        and exists (
          select 1 from public.departments d
          where d.id = weekly_rotations.department_id
            and public.jwt_matches_department_code(d.code)
        )
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- RLS: rotation_exceptions — via department store_number + code
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'rotation_exceptions'
  ) then
    alter table public.rotation_exceptions enable row level security;

    drop policy if exists "super_admin all rotation_exceptions" on public.rotation_exceptions;
    drop policy if exists "supervisor read rotation_exceptions" on public.rotation_exceptions;
    drop policy if exists "supervisor insert rotation_exceptions" on public.rotation_exceptions;
    drop policy if exists "Enforce Store and Department Isolation" on public.rotation_exceptions;

    create policy "Enforce Store and Department Isolation"
      on public.rotation_exceptions
      for all
      to authenticated
      using (
        exists (
          select 1
          from public.departments d
          where d.id = rotation_exceptions.department_id
            and public.jwt_matches_store(d.store_number)
            and public.jwt_matches_department_code(d.code)
        )
      )
      with check (
        exists (
          select 1
          from public.departments d
          where d.id = rotation_exceptions.department_id
            and public.jwt_matches_store(d.store_number)
            and public.jwt_matches_department_code(d.code)
        )
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- RLS: manager_notes — authenticated CRUD (Floor Pad upserts)
-- Store scoping remains in the client filter; JWT claim WITH CHECK was blocking
-- inserts when app_metadata.department / store_number were missing or mismatched.
-- Authoritative live fix also in 20260812_fix_manager_notes_rls.sql.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'manager_notes'
  ) then
    perform public._ensure_store_number_column('manager_notes');

    alter table public.manager_notes
      add column if not exists department text;
    alter table public.manager_notes
      add column if not exists department_code text;

    execute $q$
      update public.manager_notes
      set department = coalesce(nullif(trim(department), ''), nullif(trim(department_code), ''), 'general')
      where department is null or trim(department) = ''
    $q$;
    execute $q$
      update public.manager_notes
      set department_code = coalesce(nullif(trim(department_code), ''), nullif(trim(department), ''))
      where department_code is null or trim(department_code) = ''
    $q$;

    create index if not exists manager_notes_store_number_idx
      on public.manager_notes (store_number);

    alter table public.manager_notes enable row level security;

    drop policy if exists "manager_notes_authenticated_select" on public.manager_notes;
    drop policy if exists "Enforce Store and Department Isolation" on public.manager_notes;
    drop policy if exists "Allow authenticated users to insert manager notes" on public.manager_notes;
    drop policy if exists "Allow authenticated users to update manager notes" on public.manager_notes;
    drop policy if exists "Allow authenticated users to select manager notes" on public.manager_notes;
    drop policy if exists "Allow authenticated users to delete manager notes" on public.manager_notes;

    create policy "Allow authenticated users to select manager notes"
      on public.manager_notes
      for select
      to authenticated
      using (true);

    create policy "Allow authenticated users to insert manager notes"
      on public.manager_notes
      for insert
      to authenticated
      with check (true);

    create policy "Allow authenticated users to update manager notes"
      on public.manager_notes
      for update
      to authenticated
      using (true)
      with check (true);

    create policy "Allow authenticated users to delete manager notes"
      on public.manager_notes
      for delete
      to authenticated
      using (true);

    grant select, insert, update, delete on public.manager_notes to authenticated;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- RLS: sunday_bay_assignments (Phase 2 table — skip if not applied yet)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'sunday_bay_assignments'
  ) then
    alter table public.sunday_bay_assignments enable row level security;

    drop policy if exists "Enforce Store and Department Isolation"
      on public.sunday_bay_assignments;

    create policy "Enforce Store and Department Isolation"
      on public.sunday_bay_assignments
      for all
      to authenticated
      using (
        public.jwt_matches_store(sunday_bay_assignments.store_number)
        and public.jwt_matches_department_code(sunday_bay_assignments.department)
      )
      with check (
        public.jwt_matches_store(sunday_bay_assignments.store_number)
        and public.jwt_matches_department_code(sunday_bay_assignments.department)
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- RLS: push_subscriptions — own Auth profile id only
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'push_subscriptions'
  ) then
    alter table public.push_subscriptions enable row level security;

    drop policy if exists "Users can manage their own push subscriptions"
      on public.push_subscriptions;

    create policy "Users can manage their own push subscriptions"
      on public.push_subscriptions
      for all
      to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'push_subscriptions'
        and column_name = 'user_id'
    ) then
      comment on column public.push_subscriptions.user_id is
        'Auth profile id (auth.users.id / profiles.id) — primary push identity';
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'push_subscriptions'
        and column_name = 'specialist_id'
    ) then
      comment on column public.push_subscriptions.specialist_id is
        'Deprecated hub roster bridge; prefer user_id';
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Profiles RLS — self-read; elevated store-scoped list
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'profiles'
  ) then
    alter table public.profiles enable row level security;

    drop policy if exists "super_admin all profiles" on public.profiles;
    drop policy if exists "users read own profile" on public.profiles;
    drop policy if exists "supervisor update own profile" on public.profiles;
    drop policy if exists "users update own profile" on public.profiles;
    drop policy if exists "Enforce Store Isolation on profiles" on public.profiles;

    create policy "users read own profile"
      on public.profiles
      for select
      to authenticated
      using (
        id = auth.uid()
        or (
          public.jwt_is_elevated()
          and public.jwt_matches_store(store_number)
        )
      );

    create policy "users update own profile"
      on public.profiles
      for update
      to authenticated
      using (id = auth.uid())
      with check (
        id = auth.uid()
        and role is not distinct from (
          select role from public.profiles where id = auth.uid()
        )
      );

    create policy "Enforce Store Isolation on profiles"
      on public.profiles
      for all
      to authenticated
      using (
        public.jwt_is_elevated()
        and public.jwt_matches_store(store_number)
      )
      with check (
        public.jwt_is_elevated()
        and public.jwt_matches_store(store_number)
      );
  end if;
end $$;

-- Optional cleanup helper (keep available for later migrations)
-- drop function if exists public._ensure_store_number_column(text);

-- Service role (DeptSync API route handlers) bypasses RLS by default.
