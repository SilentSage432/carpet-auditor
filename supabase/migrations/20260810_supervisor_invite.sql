-- Supervisor Invite & Onboarding Engine
-- Extends store_specialists (hub roster) — no separate supervisors table.

alter table public.store_specialists
  add column if not exists invite_token uuid;

alter table public.store_specialists
  add column if not exists invite_token_expires_at timestamptz;

alter table public.store_specialists
  add column if not exists must_change_pin boolean not null default false;

alter table public.store_specialists
  add column if not exists temp_pin_hash text;

alter table public.store_specialists
  add column if not exists phone_number text;

-- One active invite token per row when set
create unique index if not exists store_specialists_invite_token_uidx
  on public.store_specialists (invite_token)
  where invite_token is not null;

create index if not exists store_specialists_invite_expires_idx
  on public.store_specialists (invite_token_expires_at)
  where invite_token is not null;

comment on column public.store_specialists.invite_token is
  'UUID for /invite?token= onboarding link';
comment on column public.store_specialists.must_change_pin is
  'True after SMS invite until supervisor sets a permanent PIN';
comment on column public.store_specialists.temp_pin_hash is
  'salt.hexsha256 of temporary 6-digit invite PIN';
