-- weekly_rotations identity: one bay per ISO week.
-- Canonical unique is (location_id, assigned_week) from 20260809_store_operations_rbac.
-- CREATE TABLE IF NOT EXISTS does not add that unique when an older table already
-- exists, so PostgREST upsert onConflict: location_id,assigned_week fails with
-- "no unique or exclusion constraint matching the ON CONFLICT specification".
-- There is no week_number column — do not unique on store_number,department_id,week.

do $$
declare
  has_location_week_unique boolean := false;
begin
  if not exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'weekly_rotations'
  ) then
    return;
  end if;

  select exists (
    select 1
    from pg_index i
    join pg_class t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'weekly_rotations'
      and i.indisunique
      and (
        select array_agg(a.attname::text order by x.ordinality)
        from unnest(i.indkey) with ordinality as x(attnum, ordinality)
        join pg_attribute a
          on a.attrelid = t.oid
         and a.attnum = x.attnum
         and a.attnum > 0
      ) = array['location_id', 'assigned_week']::text[]
  ) into has_location_week_unique;

  if has_location_week_unique then
    return;
  end if;

  -- Keep one row per location+week before adding UNIQUE.
  -- Prefer rows referenced by Sunday assignments, then completed, then newest.
  if exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'sunday_bay_assignments'
  ) then
    delete from public.weekly_rotations wr
    using (
      select
        wr2.id,
        row_number() over (
          partition by wr2.location_id, wr2.assigned_week
          order by
            (exists (
              select 1
              from public.sunday_bay_assignments s
              where s.bay_id = wr2.id::text
            )) desc,
            wr2.is_completed desc,
            wr2.created_at desc nulls last,
            wr2.id desc
        ) as rn
      from public.weekly_rotations wr2
    ) ranked
    where wr.id = ranked.id
      and ranked.rn > 1;
  else
    delete from public.weekly_rotations wr
    using (
      select
        wr2.id,
        row_number() over (
          partition by wr2.location_id, wr2.assigned_week
          order by
            wr2.is_completed desc,
            wr2.created_at desc nulls last,
            wr2.id desc
        ) as rn
      from public.weekly_rotations wr2
    ) ranked
    where wr.id = ranked.id
      and ranked.rn > 1;
  end if;

  alter table public.weekly_rotations
    add constraint weekly_rotations_location_id_assigned_week_key
    unique (location_id, assigned_week);
end $$;

notify pgrst, 'reload schema';
