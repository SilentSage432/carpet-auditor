-- carpet_audits.updated_at — LWW conflict parity for offline sync queue
-- Depends on: carpet_audits base schema (supabase/schema.sql)

alter table public.carpet_audits
  add column if not exists updated_at timestamptz;

update public.carpet_audits
set updated_at = coalesce(updated_at, created_at, now())
where updated_at is null;

alter table public.carpet_audits
  alter column updated_at set default now();

alter table public.carpet_audits
  alter column updated_at set not null;

create or replace function public.carpet_audits_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists carpet_audits_set_updated_at on public.carpet_audits;
create trigger carpet_audits_set_updated_at
  before update on public.carpet_audits
  for each row
  execute function public.carpet_audits_set_updated_at();

create index if not exists carpet_audits_store_updated_at_idx
  on public.carpet_audits (store_number, updated_at desc);

comment on column public.carpet_audits.updated_at is
  'Last modification time — used by DeptSync offline LWW conflict detection';
