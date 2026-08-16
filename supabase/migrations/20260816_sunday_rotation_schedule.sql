-- Store-owned Sunday auto-stage schedule.
-- Cron polls hourly; dispatch honors timezone + time + auto-generate.
-- Depends on: 20260809_multi_store.sql (public.stores)

alter table public.stores
  add column if not exists sunday_auto_generate boolean not null default true;

alter table public.stores
  add column if not exists sunday_auto_stage_time time not null default '05:00:00';

alter table public.stores
  add column if not exists timezone text not null default 'America/Denver';

comment on column public.stores.sunday_auto_generate is
  'When false, Sunday cron skips this store. Master Admin Force Draw still runs.';

comment on column public.stores.sunday_auto_stage_time is
  'Local wall-clock time on Sunday to auto-stage the upcoming ISO week (default 05:00).';

comment on column public.stores.timezone is
  'IANA timezone for Sunday auto-stage (default America/Denver).';
