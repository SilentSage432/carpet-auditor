-- APP-AUD-002B: Freeze authoritative physical observation fields on CLOSED
-- audit-bound appliance_scans. Composes with appliance_scans_enforce_audit_bind
-- (membership / observation-time window on INSERT and audit_session_id/scanned_at).
--
-- Idempotent local-first upserts that do not change frozen values are allowed.
-- Soft fields (condition_tag, category, sub_category, scanned_by,
-- is_showroom_baseline) remain mutable for future APP-OBS-001 classification work.
--
-- Does NOT apply to INSERT (late in-window offline bind remains APP-AUD-001A).

create or replace function public.appliance_scans_enforce_closed_evidence_freeze()
returns trigger
language plpgsql
as $$
declare
  sess_status text;
begin
  if old.audit_session_id is null then
    return new;
  end if;

  select status
    into sess_status
  from public.appliance_audit_sessions
  where id = old.audit_session_id;

  if sess_status is null or sess_status <> 'CLOSED' then
    return new;
  end if;

  if new.item_number is distinct from old.item_number
     or new.serial_number is distinct from old.serial_number
     or new.scanned_at is distinct from old.scanned_at
     or new.audit_session_id is distinct from old.audit_session_id
     or new.location is distinct from old.location
     or new.location_id is distinct from old.location_id
     or new.aisle is distinct from old.aisle
     or new.bay_number is distinct from old.bay_number
     or new.location_type is distinct from old.location_type
  then
    raise exception
      'Closed physical audit evidence cannot change (WHAT/WHERE/WHEN/WHICH) — frozen after physical close';
  end if;

  return new;
end;
$$;

comment on function public.appliance_scans_enforce_closed_evidence_freeze() is
  'APP-AUD-002B: reject UPDATE that rewrites authoritative observation fields on CLOSED audit-bound scans; allow idempotent upserts and soft-field edits.';

drop trigger if exists appliance_scans_enforce_closed_evidence_freeze_trg
  on public.appliance_scans;
create trigger appliance_scans_enforce_closed_evidence_freeze_trg
  before update on public.appliance_scans
  for each row
  execute function public.appliance_scans_enforce_closed_evidence_freeze();

notify pgrst, 'reload schema';
