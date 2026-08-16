-- Backfill pin_updated_at so existing PIN holders show as app-Active,
-- distinct from roster-only members (status=active, no PIN).

update public.store_specialists
set pin_updated_at = coalesce(pin_updated_at, created_at, now())
where pin_updated_at is null
  and (
    pin_hash is not null
    or (
      pin_code is not null
      and btrim(pin_code) <> ''
    )
  );

comment on column public.store_specialists.status is
  'Roster lifecycle: invited · active (includes roster-only, no PIN) · suspended';
comment on column public.store_specialists.pin_updated_at is
  'Set when the associate PIN is created or rotated. Null means roster-only (no app access).';
