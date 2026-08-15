-- Performance composite indexes for Store Map / Floor / copilot list paths.
-- Safe to re-run. Does not change RLS or table ownership.
--
-- Canonical columns (do not invent aliases):
--   store_locations     department_id, aisle, bay
--                       (not aisle_number / bay_number)
--   bay_service_logs    location_id, created_at
--                       (not bay_id / serviced_at — location_id is the bay FK)
--   weekly_rotations    department_id, is_completed
--                       (not status — open vs done is is_completed)

drop function if exists public._perf_index_if_columns(text, text, text, text[], text);

create function public._perf_index_if_columns(
  p_index_name text,
  p_schema text,
  p_table text,
  p_columns text[],
  p_index_sql text
)
returns void
language plpgsql
as $$
declare
  rel regclass;
  missing text;
begin
  rel := to_regclass(format('%I.%I', p_schema, p_table));
  if rel is null then
    raise notice 'PERF skip % — table %.% does not exist',
      p_index_name, p_schema, p_table;
    return;
  end if;

  select c.col
  into missing
  from unnest(p_columns) as c(col)
  where not exists (
    select 1
    from pg_attribute a
    where a.attrelid = rel
      and a.attnum > 0
      and not a.attisdropped
      and a.attname = c.col
  )
  limit 1;

  if missing is not null then
    raise notice 'PERF skip % — column %.%.% does not exist',
      p_index_name, p_schema, p_table, missing;
    return;
  end if;

  execute p_index_sql;
end;
$$;

-- Map GET / aisle accordion: department + aisle + bay
select public._perf_index_if_columns(
  'idx_store_locations_dept_aisle',
  'public',
  'store_locations',
  array['department_id', 'aisle', 'bay'],
  $sql$
    create index if not exists idx_store_locations_dept_aisle
      on public.store_locations (department_id, aisle, bay)
  $sql$
);

-- Copilot / walk history: bay FK + time desc
select public._perf_index_if_columns(
  'idx_bay_service_logs_bay_time',
  'public',
  'bay_service_logs',
  array['location_id', 'created_at'],
  $sql$
    create index if not exists idx_bay_service_logs_bay_time
      on public.bay_service_logs (location_id, created_at desc)
  $sql$
);

-- Floor checklist / active week filter
select public._perf_index_if_columns(
  'idx_rotations_active',
  'public',
  'weekly_rotations',
  array['department_id', 'is_completed'],
  $sql$
    create index if not exists idx_rotations_active
      on public.weekly_rotations (department_id, is_completed)
  $sql$
);

drop function if exists public._perf_index_if_columns(text, text, text, text[], text);
