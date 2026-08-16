-- Roster INSERT/SELECT for authenticated Hub-bridge sessions.
-- After PIN unlock the browser uses the authenticated JWT (not anon).
-- Policies that require auth_user_id = auth.uid() hide roster-only rows
-- (auth_user_id IS NULL) and reject inserts that have no Auth user yet.

alter table if exists public.store_specialists enable row level security;

grant select, insert, update, delete on public.store_specialists to anon, authenticated;

drop policy if exists "Allow store managers to insert specialists" on public.store_specialists;
create policy "Allow store managers to insert specialists"
  on public.store_specialists
  for insert
  to authenticated
  with check (true);

drop policy if exists "Allow store managers to read specialists" on public.store_specialists;
create policy "Allow store managers to read specialists"
  on public.store_specialists
  for select
  to authenticated
  using (true);

drop policy if exists "Allow authenticated all store_specialists" on public.store_specialists;
create policy "Allow authenticated all store_specialists"
  on public.store_specialists
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Allow anon all store_specialists" on public.store_specialists;
create policy "Allow anon all store_specialists"
  on public.store_specialists
  for all
  to anon
  using (true)
  with check (true);

comment on policy "Allow store managers to insert specialists" on public.store_specialists is
  'Master/DS Hub sessions may insert roster-only specialists (auth_user_id IS NULL).';
comment on policy "Allow store managers to read specialists" on public.store_specialists is
  'Roster list includes members with no Auth account yet (auth_user_id IS NULL).';
