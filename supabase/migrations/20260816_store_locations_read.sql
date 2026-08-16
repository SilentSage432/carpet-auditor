-- Open SELECT on store_locations so Map/Floor can read mapped bays
-- (including rotation status PENDING) from authenticated Hub-bridge and anon
-- sessions. Writes stay isolated by the existing JWT FOR ALL policy.
-- Apply on live Supabase after 20260812_jwt_rls_policies.sql.

alter table if exists public.store_locations enable row level security;

grant select on public.store_locations to anon, authenticated;

drop policy if exists "Allow read access for store locations" on public.store_locations;
create policy "Allow read access for store locations"
  on public.store_locations
  for select
  to anon, authenticated
  using (true);

comment on policy "Allow read access for store locations" on public.store_locations is
  'Open read for mapped aisle/bay tags. Rotation PENDING is available-for-draw, not hidden.';
