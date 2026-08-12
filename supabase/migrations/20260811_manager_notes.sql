-- Manager Notes & S Pen Canvas workspace
-- Depends on: 20260809_multi_store.sql (stores UUID identity)
-- Note: store_id is UUID (canonical multi-store FK), not bigint — matches stores.id.

create extension if not exists "pgcrypto";

create table if not exists public.manager_notes (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references public.stores (id) on delete cascade,
  department_code text not null,
  aisle text,
  bay integer check (bay is null or bay >= 0),
  title text not null default '',
  content text not null default '',
  canvas_data_url text,
  ai_summary text,
  action_items jsonb,
  created_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists manager_notes_store_id_idx
  on public.manager_notes (store_id);

create index if not exists manager_notes_department_code_idx
  on public.manager_notes (department_code);

create index if not exists manager_notes_created_at_idx
  on public.manager_notes (created_at desc);

create index if not exists manager_notes_store_dept_idx
  on public.manager_notes (store_id, department_code, created_at desc);

comment on table public.manager_notes is
  'Manager floor notes with optional S Pen canvas PNG + Gemini action-item synthesis';

comment on column public.manager_notes.canvas_data_url is
  'Optional base64 PNG data-URL from S Pen / stylus annotations';

comment on column public.manager_notes.action_items is
  'JSON array of { task, priority, assignee_role } extracted by Gemini';

alter table public.manager_notes enable row level security;

-- Service-role / server routes own writes today (header-based store-ops actor).
-- Authenticated read for future JWT RLS wiring.
drop policy if exists "manager_notes_authenticated_select" on public.manager_notes;
create policy "manager_notes_authenticated_select"
  on public.manager_notes
  for select
  to authenticated
  using (true);
