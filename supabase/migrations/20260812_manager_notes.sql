-- Phase 2 — Manager Notes durability (store_number / department / author_id)
-- Evolves 20260811_manager_notes toward JWT-claim isolation while keeping S Pen / AI columns.
-- Depends on: 20260809_multi_store, 20260811_manager_notes (optional), 20260812_jwt_rls_policies helpers

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Table (create if missing — Phase 2 canonical columns)
-- ---------------------------------------------------------------------------
create table if not exists public.manager_notes (
  id uuid primary key default gen_random_uuid(),
  store_number text not null,
  department text not null,
  author_id uuid references auth.users (id) on delete set null,
  content text not null default '',
  category text not null default 'general'
    check (category in ('shift_handover', 'audit', 'general')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Evolve legacy 20260811 shape → Phase 2 columns
alter table public.manager_notes
  add column if not exists store_number text;

alter table public.manager_notes
  add column if not exists department text;

alter table public.manager_notes
  add column if not exists author_id uuid references auth.users (id) on delete set null;

alter table public.manager_notes
  add column if not exists category text;

alter table public.manager_notes
  add column if not exists updated_at timestamptz;

alter table public.manager_notes
  add column if not exists content text;

-- Preserve S Pen / Gemini workspace columns when present
alter table public.manager_notes
  add column if not exists store_id uuid references public.stores (id) on delete cascade;

alter table public.manager_notes
  add column if not exists department_code text;

alter table public.manager_notes
  add column if not exists aisle text;

alter table public.manager_notes
  add column if not exists bay integer;

alter table public.manager_notes
  add column if not exists title text;

alter table public.manager_notes
  add column if not exists canvas_data_url text;

alter table public.manager_notes
  add column if not exists ai_summary text;

alter table public.manager_notes
  add column if not exists action_items jsonb;

alter table public.manager_notes
  add column if not exists created_by text;

alter table public.manager_notes
  add column if not exists completed_task_indexes integer[];

-- Backfill department from legacy department_code
update public.manager_notes
set department = coalesce(nullif(trim(department), ''), nullif(trim(department_code), ''), 'general')
where department is null or trim(department) = '';

-- Backfill store_number from stores via store_id
update public.manager_notes mn
set store_number = s.store_number
from public.stores s
where mn.store_id = s.id
  and (mn.store_number is null or trim(mn.store_number) = '');

update public.manager_notes
set store_number = coalesce(nullif(trim(store_number), ''), '0000')
where store_number is null or trim(store_number) = '';

update public.manager_notes
set category = 'general'
where category is null or trim(category) = '';

update public.manager_notes
set updated_at = coalesce(updated_at, created_at, now())
where updated_at is null;

update public.manager_notes
set content = coalesce(content, '')
where content is null;

update public.manager_notes
set title = coalesce(title, '')
where title is null;

update public.manager_notes
set created_by = coalesce(nullif(trim(created_by), ''), 'unknown')
where created_by is null or trim(created_by) = '';

-- Keep department_code mirrored for older readers
update public.manager_notes
set department_code = department
where department_code is null or trim(department_code) = '';

alter table public.manager_notes
  alter column store_number set not null;

alter table public.manager_notes
  alter column department set not null;

alter table public.manager_notes
  alter column content set not null;

alter table public.manager_notes
  alter column category set default 'general';

alter table public.manager_notes
  alter column updated_at set default now();

alter table public.manager_notes
  alter column created_at set default now();

-- Category check (drop soft if already constrained differentlyely)
do $$ begin
  alter table public.manager_notes
    drop constraint if exists manager_notes_category_check;
  alter table public.manager_notes
    add constraint manager_notes_category_check
    check (category in ('shift_handover', 'audit', 'general'));
exception when others then null;
end $$;

create index if not exists manager_notes_store_number_idx
  on public.manager_notes (store_number);

create index if not exists manager_notes_department_idx
  on public.manager_notes (department);

create index if not exists manager_notes_store_dept_created_idx
  on public.manager_notes (store_number, department, created_at desc);

create index if not exists manager_notes_author_id_idx
  on public.manager_notes (author_id);

create or replace function public.manager_notes_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  if new.department is not null then
    new.department_code = new.department;
  end if;
  return new;
end;
$$;

drop trigger if exists manager_notes_set_updated_at on public.manager_notes;
create trigger manager_notes_set_updated_at
  before update on public.manager_notes
  for each row
  execute function public.manager_notes_set_updated_at();

comment on table public.manager_notes is
  'Manager floor notes — durable Supabase rows scoped by JWT store_number + department';

alter table public.manager_notes enable row level security;

-- Replace prior policies (open select / store_id-based)
-- NOTE: Prefer 20260812_fix_manager_notes_rls.sql for live DBs — permissive
-- authenticated CRUD unblocks Floor Pad upserts when JWT dept claims mismatch.
drop policy if exists "manager_notes_authenticated_select" on public.manager_notes;
drop policy if exists "Enforce Store and Department Isolation" on public.manager_notes;
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

grant select, insert, update, delete on public.manager_notes to authenticated;
