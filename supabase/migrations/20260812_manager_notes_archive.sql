-- Executive Floor Pad — archive flag for durable notes without cluttering active shift view
-- Depends on: 20260812_manager_notes.sql

alter table public.manager_notes
  add column if not exists is_archived boolean not null default false;

create index if not exists manager_notes_store_active_idx
  on public.manager_notes (store_number, is_archived, created_at desc);

comment on column public.manager_notes.is_archived is
  'When true, note is retained indefinitely but hidden from the active shift Floor Pad list';
