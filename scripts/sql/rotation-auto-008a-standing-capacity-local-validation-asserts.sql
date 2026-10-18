-- Asserts after applying 20261025_rotation_auto_008a_standing_capacity.sql
-- on the disposable harness DB.

do $$
declare
  v_w43 integer;
  v_policy_id uuid;
  v_items integer;
  v_dup_ok boolean := false;
begin
  -- Existing weekly approval preserved
  select count(*) into v_w43
  from public.store_week_capacity_approvals
  where store_number = '2587' and week_label = '2026-W43' and specialist_id = 'tyson';
  if v_w43 <> 1 then
    raise exception 'HARNESS FAIL: W43 weekly approval not preserved (% rows)', v_w43;
  end if;

  -- Tables exist
  if to_regclass('public.store_standing_capacity_policies') is null then
    raise exception 'HARNESS FAIL: store_standing_capacity_policies missing';
  end if;
  if to_regclass('public.store_standing_capacity_policy_items') is null then
    raise exception 'HARNESS FAIL: store_standing_capacity_policy_items missing';
  end if;
  if to_regclass('public.store_week_capacity_approval_provenance') is null then
    raise exception 'HARNESS FAIL: store_week_capacity_approval_provenance missing';
  end if;

  -- Insert standing policy + items
  insert into public.store_standing_capacity_policies (
    store_number, policy_version, is_active, established_by_specialist_id, note
  ) values (
    '2587', 1, true, 'master', 'harness 3/3/3/3'
  ) returning id into v_policy_id;

  insert into public.store_standing_capacity_policy_items (policy_id, specialist_id, approved_capacity)
  values
    (v_policy_id, 'tyson', 3),
    (v_policy_id, 'nate', 3),
    (v_policy_id, 'nick', 3),
    (v_policy_id, 'tracy', 3);

  select count(*) into v_items
  from public.store_standing_capacity_policy_items
  where policy_id = v_policy_id;
  if v_items <> 4 then
    raise exception 'HARNESS FAIL: expected 4 policy items, got %', v_items;
  end if;

  -- One-active constraint: second active must fail
  begin
    insert into public.store_standing_capacity_policies (
      store_number, policy_version, is_active, established_by_specialist_id
    ) values ('2587', 2, true, 'master');
  exception
    when unique_violation then
      v_dup_ok := true;
  end;
  if not v_dup_ok then
    raise exception 'HARNESS FAIL: one-active unique index did not reject second active policy';
  end if;

  -- Provenance: standing requires policy id; explicit forbids it
  insert into public.store_week_capacity_approval_provenance (
    store_number, week_label, specialist_id, source, standing_policy_id, materialized_at
  ) values (
    '2587', '2026-W44', 'tyson', 'standing', v_policy_id, now()
  );

  begin
    insert into public.store_week_capacity_approval_provenance (
      store_number, week_label, specialist_id, source, standing_policy_id
    ) values (
      '2587', '2026-W44', 'nate', 'explicit', v_policy_id
    );
    raise exception 'HARNESS FAIL: explicit+standing_policy_id should be rejected';
  exception
    when check_violation then
      null;
  end;

  insert into public.store_week_capacity_approval_provenance (
    store_number, week_label, specialist_id, source, standing_policy_id
  ) values (
    '2587', '2026-W44', 'nate', 'explicit', null
  );

  raise notice 'HARNESS PASS: standing capacity migration validated';
end $$;
