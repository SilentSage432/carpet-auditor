-- Multi-department role & scope access
-- Additive: primary assigned_department / assigned_department_id stay canonical.
-- accessible_departments = primary + granted cross-department codes.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- store_specialists — hub DepartmentScope strings (flooring, cabinets, …)
-- ---------------------------------------------------------------------------
alter table public.store_specialists
  add column if not exists accessible_departments text[] not null default '{}';

update public.store_specialists
set accessible_departments = array[assigned_department]
where (accessible_departments is null or cardinality(accessible_departments) = 0)
  and assigned_department is not null
  and assigned_department <> 'all';

create index if not exists store_specialists_accessible_departments_gin
  on public.store_specialists using gin (accessible_departments);

comment on column public.store_specialists.accessible_departments is
  'Hub department scopes this roster member may enter (includes primary assigned_department).';

-- ---------------------------------------------------------------------------
-- profiles — store-ops departments.code strings (flooring, D29, D24P, …)
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists accessible_departments text[] not null default '{}';

update public.profiles p
set accessible_departments = array[d.code]
from public.departments d
where d.id = p.assigned_department_id
  and d.code is not null
  and trim(d.code) <> ''
  and (p.accessible_departments is null or cardinality(p.accessible_departments) = 0);

create index if not exists profiles_accessible_departments_gin
  on public.profiles using gin (accessible_departments);

comment on column public.profiles.accessible_departments is
  'Store-ops department codes in JWT/RLS scope (primary + granted).';

-- ---------------------------------------------------------------------------
-- JWT helpers — match primary department OR accessible_departments[]
-- ---------------------------------------------------------------------------
create or replace function public.jwt_matches_department_code(p_code text)
returns boolean
language sql
stable
as $$
  select
    public.jwt_is_elevated()
    or (
      p_code is not null
      and (
        public.jwt_department() = p_code
        or exists (
          select 1
          from jsonb_array_elements_text(
            coalesce(
              auth.jwt() -> 'app_metadata' -> 'accessible_departments',
              '[]'::jsonb
            )
          ) as granted(code)
          where granted.code = p_code
        )
      )
    );
$$;

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
  v_accessible text[];
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
    p.specialist_id,
    coalesce(p.accessible_departments, '{}'::text[])
  into v_store, v_role, v_dept, v_specialist, v_accessible
  from public.profiles p
  left join public.departments d on d.id = p.assigned_department_id
  where p.id = p_user_id;

  if not found then
    return;
  end if;

  if v_dept is not null and trim(v_dept) <> '' then
    v_accessible := array(
      select distinct x
      from unnest(array_append(coalesce(v_accessible, '{}'::text[]), v_dept)) as x
      where x is not null and trim(x) <> ''
    );
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
      'specialist_id', v_specialist,
      'accessible_departments', to_jsonb(coalesce(v_accessible, '{}'::text[]))
    )
  where id = p_user_id;
end;
$$;

drop trigger if exists profiles_sync_app_metadata on public.profiles;
create trigger profiles_sync_app_metadata
  after insert or update of store_number, role, assigned_department_id, specialist_id, accessible_departments
  on public.profiles
  for each row
  execute function public.trg_profiles_sync_app_metadata();

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
  v_accessible text[];
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
      p.specialist_id,
      coalesce(p.accessible_departments, '{}'::text[])
    into v_store, v_role, v_dept, v_specialist, v_accessible
    from public.profiles p
    left join public.departments d on d.id = p.assigned_department_id
    where p.id = uid;

    if found then
      if v_dept is not null and trim(v_dept) <> '' then
        v_accessible := array(
          select distinct x
          from unnest(array_append(coalesce(v_accessible, '{}'::text[]), v_dept)) as x
          where x is not null and trim(x) <> ''
        );
      end if;

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
            'specialist_id', v_specialist,
            'accessible_departments', to_jsonb(coalesce(v_accessible, '{}'::text[]))
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
