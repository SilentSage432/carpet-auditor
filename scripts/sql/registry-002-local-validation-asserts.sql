-- Assertions for REGISTRY-002 on a disposable DB after harness + migration + seed.
-- Raises exceptions on failure. Safe to re-run after re-backfill.

do $$
declare
  v_store uuid;
  v_dept_a uuid;
  v_dept_b uuid;
  v_count integer;
  v_active boolean;
  v_aisle text;
  v_id uuid;
begin
  select id into v_store from public.stores where store_number = '2587-test' limit 1;
  select id into v_dept_a from public.departments where code = 'flooring' limit 1;
  select id into v_dept_b from public.departments where code = 'home_decor' limit 1;

  if v_store is null or v_dept_a is null then
    raise exception 'seed missing';
  end if;

  -- Normalized uniqueness: show-l / SHOW-L / padding digits
  if public.normalize_store_aisle(' show-l ') <> 'SHOW-L' then
    raise exception 'normalize named zone failed';
  end if;
  if public.normalize_store_aisle('012') <> '12' then
    raise exception 'normalize digit padding failed';
  end if;
  if public.normalize_store_aisle('0') <> '0' then
    raise exception 'normalize zero failed';
  end if;

  -- Backfill created expected aisles
  select count(*) into v_count from public.store_aisles where department_id = v_dept_a;
  if v_count < 3 then
    raise exception 'expected >=3 registry rows for flooring, got %', v_count;
  end if;

  -- Mixed active/retired → registry active
  select is_active, aisle into v_active, v_aisle
  from public.store_aisles
  where department_id = v_dept_a
    and aisle = '41';
  if v_aisle is null then
    raise exception 'aisle 41 missing from registry';
  end if;
  if v_active is not true then
    raise exception 'mixed aisle 41 should be active';
  end if;

  -- Fully retired aisle → registry retired
  select is_active into v_active
  from public.store_aisles
  where department_id = v_dept_a
    and aisle = '99';
  if v_active is not false then
    raise exception 'fully retired aisle 99 should be inactive';
  end if;

  -- Named zone present
  if not exists (
    select 1 from public.store_aisles
    where department_id = v_dept_a and aisle = 'CARPET-WALL'
  ) then
    raise exception 'CARPET-WALL missing from backfill';
  end if;

  -- Zero-bay insert allowed
  insert into public.store_aisles (store_id, department_id, aisle, display_name)
  values (v_store, v_dept_a, 'SHOW-L', 'Left Showroom')
  returning id into v_id;
  if v_id is null then
    raise exception 'zero-bay SHOW-L insert failed';
  end if;

  -- Duplicate normalized rejected
  begin
    insert into public.store_aisles (store_id, department_id, aisle)
    values (v_store, v_dept_a, 'show-l');
    raise exception 'duplicate SHOW-L should have failed';
  exception
    when unique_violation then
      null;
  end;

  -- Cross-department same code allowed
  insert into public.store_aisles (store_id, department_id, aisle)
  values (v_store, v_dept_b, 'SHOW-L');

  -- Cross-store department mismatch rejected
  begin
    insert into public.store_aisles (store_id, department_id, aisle)
    values (
      (select id from public.stores where store_number = '9999-test'),
      v_dept_a,
      'X-ZONE'
    );
    raise exception 'store/department mismatch should have failed';
  exception
    when others then
      if sqlerrm not like '%must match departments.store_id%' then
        raise;
      end if;
  end;

  -- Bay rows unchanged count
  select count(*) into v_count from public.store_locations;
  if v_count <> 6 then
    raise exception 'store_locations count mutated: %', v_count;
  end if;

  -- Idempotent backfill (re-run insert block)
  insert into public.store_aisles (
    store_id, department_id, aisle, display_name, is_active, retired_at
  )
  select
    coalesce(sl.store_id, d.store_id),
    sl.department_id,
    public.normalize_store_aisle(sl.aisle),
    null::text,
    bool_or(sl.is_active is distinct from false),
    case
      when bool_or(sl.is_active is distinct from false) then null
      else coalesce(max(sl.updated_at), now())
    end
  from public.store_locations sl
  inner join public.departments d on d.id = sl.department_id
  where char_length(trim(both from coalesce(sl.aisle, ''))) > 0
  group by
    coalesce(sl.store_id, d.store_id),
    sl.department_id,
    public.normalize_store_aisle(sl.aisle)
  on conflict (department_id, aisle) do nothing;

  raise notice 'REGISTRY-002 local asserts PASS';
end $$;
