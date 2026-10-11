-- DEPTSYNC-SEC-OPS-002 — narrowly scoped ROLLBACK
-- Operator-authorized only. Restores pre-containment open policies / grants.
-- Does NOT restore secret-column SELECT (prefer leave revoked).
-- Prefer NOT to reintroduce open {public} ALL policies unless emergency.

begin;

-- Recreate open policies (EMERGENCY ONLY — reopens SEC-OPS-001 P0)
create policy "Allow all operations for authenticated and anon"
  on public.bay_service_logs
  for all
  to public
  using (true)
  with check (true);

create policy "Allow authenticated full access to rotation_exceptions"
  on public.rotation_exceptions
  for all
  to public
  using (true);

grant select, insert, update, delete, truncate, references, trigger
  on table public.bay_service_logs to anon, authenticated;

grant select, insert, update, delete, truncate, references, trigger
  on table public.rotation_exceptions to anon, authenticated;

commit;
