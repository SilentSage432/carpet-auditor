-- DEPTSYNC-ZEBRA-HANDOFF-002
-- Orthogonal per-bay operator confirmation that a Sunday assignment was
-- manually entered into Lowe's Zebra Dashboard.
--
-- Not a Zebra integration. Does not change completion/verification semantics.
-- Client table writes remain revoked; confirmation goes through service-role
-- Store Ops API after requireSupervisorOrAdmin.

alter table public.sunday_bay_assignments
  add column if not exists zebra_entered_at timestamptz,
  add column if not exists zebra_entered_by text;

comment on column public.sunday_bay_assignments.zebra_entered_at is
  'Operator-recorded time when this bay assignment was manually entered into Lowe''s Zebra. Null = not confirmed. Independent of completion/verification.';

comment on column public.sunday_bay_assignments.zebra_entered_by is
  'Operator actor id (profiles/specialist) who confirmed zebra_entered_at. Not proof Zebra accepted the task.';

-- Clear handoff evidence when ownership is cleared or reassigned.
-- Same-owner updates (including confirm stamps) preserve existing evidence.
create or replace function public.sunday_bay_assignments_clear_zebra_on_owner_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    -- Clear only on ownership loss/reassign (roster). Profile-id backfill on the
    -- same roster must not erase operator handoff evidence.
    if new.status = 'cleared'
       or coalesce(new.roster_specialist_id, '')
            is distinct from coalesce(old.roster_specialist_id, '') then
      new.zebra_entered_at := null;
      new.zebra_entered_by := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists sunday_bay_assignments_clear_zebra_on_owner_change
  on public.sunday_bay_assignments;

create trigger sunday_bay_assignments_clear_zebra_on_owner_change
  before update on public.sunday_bay_assignments
  for each row
  execute function public.sunday_bay_assignments_clear_zebra_on_owner_change();

-- No new grants: authenticated SELECT already covers new columns;
-- INSERT/UPDATE/DELETE remain revoked for clients (capacity RPC / service role).

notify pgrst, 'reload schema';
