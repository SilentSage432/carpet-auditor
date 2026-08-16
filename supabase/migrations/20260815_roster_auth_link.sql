-- Roster auth claiming: nullable Auth link on store_specialists (hub team roster).
-- Roster-only members have no auth.users row. Signup / invite redemption
-- claims the existing card (auth_user_id) instead of inserting a duplicate.

alter table public.store_specialists
  add column if not exists auth_user_id uuid;

alter table public.store_specialists
  add column if not exists email text;

-- Live aliases some projects used for the Auth FK — never require them on insert.
do $$
declare
  col text;
begin
  foreach col in array array['user_id', 'auth_id', 'auth_user_id']
  loop
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'store_specialists'
        and column_name = col
    ) then
      execute format(
        'alter table public.store_specialists alter column %I drop not null',
        col
      );
      begin
        execute format(
          'alter table public.store_specialists alter column %I drop default',
          col
        );
      exception
        when others then null;
      end;
    end if;
  end loop;
end $$;

do $$
begin
  alter table public.store_specialists
    add constraint store_specialists_auth_user_id_fkey
    foreign key (auth_user_id) references auth.users (id) on delete set null;
exception
  when duplicate_object then null;
  when undefined_table then null;
end $$;

create unique index if not exists store_specialists_auth_user_id_uidx
  on public.store_specialists (auth_user_id)
  where auth_user_id is not null;

create unique index if not exists store_specialists_store_email_uidx
  on public.store_specialists (store_number, (lower(btrim(email))))
  where email is not null and btrim(email) <> '';

comment on column public.store_specialists.auth_user_id is
  'auth.users.id after invite/signup claim. Null = roster-only (no app login).';
comment on column public.store_specialists.email is
  'Optional contact email used to claim this roster row when Auth signup completes.';

-- Claim an existing store_specialists row for a new auth.users id.
-- Never inserts a second roster card.
create or replace function public.claim_existing_roster_for_auth_user(
  p_user_id uuid,
  p_email text,
  p_phone text,
  p_meta jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  matched uuid;
  token text;
begin
  if p_user_id is null then
    return null;
  end if;

  update public.store_specialists
  set
    status = case
      when lower(coalesce(status, '')) in ('invited', 'pending') then 'active'
      else status
    end,
    email = coalesce(nullif(btrim(email), ''), nullif(btrim(coalesce(p_email, '')), ''))
  where auth_user_id = p_user_id
  returning id into matched;

  if matched is null and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'store_specialists' and column_name = 'user_id'
  ) then
    execute
      'update public.store_specialists
       set auth_user_id = $1,
           status = case
             when lower(coalesce(status, '''')) in (''invited'', ''pending'') then ''active''
             else status
           end
       where user_id = $1
       returning id'
    into matched
    using p_user_id;
  end if;

  if matched is null and p_email is not null and btrim(p_email) <> ''
    and lower(p_email) not like '%@deptsync.hub' then
    update public.store_specialists
    set
      auth_user_id = p_user_id,
      email = coalesce(nullif(btrim(email), ''), btrim(p_email)),
      status = case
        when lower(coalesce(status, '')) in ('invited', 'pending') then 'active'
        else coalesce(status, 'active')
      end
    where id = (
      select s.id
      from public.store_specialists s
      where s.auth_user_id is null
        and s.email is not null
        and lower(btrim(s.email)) = lower(btrim(p_email))
      order by s.created_at asc nulls last
      limit 1
    )
    returning id into matched;
  end if;

  token := coalesce(
    p_meta ->> 'invite_token',
    p_meta ->> 'auth_token',
    p_meta ->> 'specialist_id'
  );

  if matched is null and token is not null and btrim(token) <> '' then
    update public.store_specialists
    set
      auth_user_id = p_user_id,
      status = case
        when lower(coalesce(status, '')) in ('invited', 'pending') then 'active'
        else coalesce(status, 'active')
      end
    where auth_user_id is null
      and id::text = token
    returning id into matched;
  end if;

  if matched is null and p_phone is not null and btrim(p_phone) <> '' then
    update public.store_specialists
    set
      auth_user_id = p_user_id,
      status = case
        when lower(coalesce(status, '')) in ('invited', 'pending') then 'active'
        else coalesce(status, 'active')
      end
    where id = (
      select s.id
      from public.store_specialists s
      where s.auth_user_id is null
        and s.phone_number is not null
        and s.phone_number = p_phone
      order by s.created_at asc nulls last
      limit 1
    )
    returning id into matched;
  end if;

  if matched is not null and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'specialist_id'
  ) then
    update public.profiles
    set specialist_id = matched::text
    where id = p_user_id
      and (specialist_id is null or btrim(specialist_id) = '');
  end if;

  return matched;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email, updated_at = now();

  perform public.claim_existing_roster_for_auth_user(
    new.id,
    new.email,
    new.phone,
    new.raw_user_meta_data
  );

  return new;
end;
$$;
