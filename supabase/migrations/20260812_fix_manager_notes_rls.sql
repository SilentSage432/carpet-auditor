-- Fix manager_notes RLS — authenticated CRUD was blocked by JWT store/dept WITH CHECK
-- on INSERT when app_metadata claims were missing or mismatched.
-- Apply after 20260812_manager_notes.sql / 20260812_jwt_rls_policies.sql.

alter table public.manager_notes enable row level security;

-- Drop prior restrictive / open policies so these replace them cleanly
drop policy if exists "Enforce Store and Department Isolation" on public.manager_notes;
drop policy if exists "manager_notes_authenticated_select" on public.manager_notes;
drop policy if exists "Allow authenticated users to insert manager notes" on public.manager_notes;
drop policy if exists "Allow authenticated users to update manager notes" on public.manager_notes;
drop policy if exists "Allow authenticated users to select manager notes" on public.manager_notes;
drop policy if exists "Allow authenticated users to delete manager notes" on public.manager_notes;

create policy "Allow authenticated users to select manager notes"
  on public.manager_notes
  for select
  to authenticated
  using (true);

create policy "Allow authenticated users to insert manager notes"
  on public.manager_notes
  for insert
  to authenticated
  with check (true);

create policy "Allow authenticated users to update manager notes"
  on public.manager_notes
  for update
  to authenticated
  using (true)
  with check (true);

create policy "Allow authenticated users to delete manager notes"
  on public.manager_notes
  for delete
  to authenticated
  using (true);

-- Stamp author_id from the Auth session when the client omits it
create or replace function public.manager_notes_set_author_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.author_id is null and auth.uid() is not null then
    new.author_id := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists manager_notes_set_author_id on public.manager_notes;
create trigger manager_notes_set_author_id
  before insert or update on public.manager_notes
  for each row
  execute function public.manager_notes_set_author_id();

comment on table public.manager_notes is
  'Manager floor notes — authenticated CRUD; author_id stamped from auth.uid()';

grant select, insert, update, delete on public.manager_notes to authenticated;
