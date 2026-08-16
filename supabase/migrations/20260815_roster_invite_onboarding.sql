-- Roster SMS/link invite onboarding
-- Hashed one-time invite token + associate status (invited → active).
-- Does not change PIN verification ownership (hub-bridge still verifies pin_code).

alter table public.store_specialists
  add column if not exists status text;

alter table public.store_specialists
  add column if not exists invite_token_hash text;

alter table public.store_specialists
  add column if not exists invite_consumed_at timestamptz;

update public.store_specialists
set status = case
  when is_active = false then 'inactive'
  when must_change_pin = true
    and invite_token is not null
    and invite_consumed_at is null then 'invited'
  else 'active'
end
where status is null or btrim(status) = '';

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
  check (status in ('invited', 'active', 'inactive'));

create unique index if not exists store_specialists_invite_token_hash_uidx
  on public.store_specialists (invite_token_hash)
  where invite_token_hash is not null;

create index if not exists store_specialists_status_idx
  on public.store_specialists (store_number, status);

comment on column public.store_specialists.status is
  'Roster onboarding: invited (SMS/link pending) · active · inactive';
comment on column public.store_specialists.invite_token_hash is
  'SHA-256 hex of the one-time /invite/[token] secret — never store the raw token';
comment on column public.store_specialists.invite_consumed_at is
  'Set when the invite token is consumed during PIN activation';
