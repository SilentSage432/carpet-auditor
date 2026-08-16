-- Unified SMS / one-time token invitation + self-service PIN reset
-- Canonical columns: auth_token_hash, auth_token_expires_at, pin_hash, pin_updated_at
-- status: invited | active | suspended

alter table public.store_specialists
  add column if not exists phone_number text;

alter table public.store_specialists
  add column if not exists auth_token_hash text;

alter table public.store_specialists
  add column if not exists auth_token_expires_at timestamptz;

alter table public.store_specialists
  add column if not exists pin_hash text;

alter table public.store_specialists
  add column if not exists pin_updated_at timestamptz;

alter table public.store_specialists
  add column if not exists status text;

update public.store_specialists
set auth_token_hash = invite_token_hash
where auth_token_hash is null
  and invite_token_hash is not null;

update public.store_specialists
set auth_token_expires_at = invite_token_expires_at
where auth_token_expires_at is null
  and invite_token_expires_at is not null;

update public.store_specialists
set pin_hash = pin_code
where pin_hash is null
  and pin_code is not null
  and pin_code like '%.%'
  and length(split_part(pin_code, '.', 2)) = 64;

update public.store_specialists
set status = case
  when is_active = false then 'suspended'
  when status = 'inactive' then 'suspended'
  when must_change_pin = true
    and coalesce(auth_token_hash, invite_token_hash::text, invite_token::text) is not null
    and invite_consumed_at is null then 'invited'
  when status in ('invited', 'active', 'suspended') then status
  else 'active'
end
where status is null
  or btrim(status) = ''
  or status = 'inactive';

alter table public.store_specialists
  alter column status set default 'active';

update public.store_specialists
set status = 'active'
where status is null;

alter table public.store_specialists
  alter column status set not null;

alter table public.store_specialists
  drop constraint if exists store_specialists_status_check;

alter table public.store_specialists
  add constraint store_specialists_status_check
  check (status in ('invited', 'active', 'suspended'));

create unique index if not exists store_specialists_auth_token_hash_uidx
  on public.store_specialists (auth_token_hash)
  where auth_token_hash is not null;

comment on column public.store_specialists.auth_token_hash is
  'SHA-256 hex of the one-time /auth/verify/[token] secret — never store the raw token';
comment on column public.store_specialists.auth_token_expires_at is
  'Expiration for the current invite or PIN-reset token';
comment on column public.store_specialists.pin_hash is
  'salt.sha256 of the associate PIN — hub-bridge verifies this (pin_code is legacy fallback)';
comment on column public.store_specialists.pin_updated_at is
  'Set when the associate PIN is created or rotated';
comment on column public.store_specialists.status is
  'Roster lifecycle: invited · active · suspended';
