-- Executive Floor Pad — structured Gemini metadata on manager notes
-- Depends on: 20260812_manager_notes.sql

alter table public.manager_notes
  add column if not exists metadata jsonb not null default '{}'::jsonb;

comment on column public.manager_notes.metadata is
  'Gemini Copilot structured extract: appliance_serials, carpet_remnants, operational_hotspots, vendor_mentions, follow_up_date';

create index if not exists manager_notes_metadata_gin_idx
  on public.manager_notes using gin (metadata);
