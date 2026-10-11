-- DEPTSYNC-SEC-OPS-007 — Exact legacy credential mirror cleanup
-- Canonical project: fmeinlwhixngednabhgy
-- Clears ONLY obsolete plaintext PIN fields on two confirmed rows.
-- Does NOT modify store_specialists / MasterAdmin credentials.
--
-- Schema note: profiles.pin and store_profiles.pin are NOT NULL.
-- Those columns are cleared to empty string (non-secret, non-digit).
-- Nullable pin_code / pin_hash are set NULL.
--
-- Run inside a single transaction. ROLLBACK if any gate fails.

begin;

-- Preconditions (must each return 1)
do $$
declare
  v_profiles integer;
  v_store_profiles integer;
  v_master integer;
begin
  select count(*) into v_profiles
  from public.profiles
  where id::text = '0f3b20ce-85bf-4d1b-8103-4b81648d396d'
    and store_number = '2587'
    and specialist_id::text = 'f9e36630-9793-40cd-9d3c-53b5ee450b1c'
    and coalesce(pin, '') ~ '^\d{4,8}$'
    and coalesce(pin_code, '') ~ '^\d{4,8}$'
    and coalesce(pin_hash, '') = '';

  select count(*) into v_store_profiles
  from public.store_profiles
  where id::text = '0b7d86d3-5f14-447d-b2f5-5ff8997947a7'
    and store_number = '1852'
    and lower(coalesce(username, '')) = 'master_admin'
    and coalesce(pin, '') ~ '^\d{4,8}$'
    and coalesce(pin_code, '') ~ '^\d{4,8}$';

  select count(*) into v_master
  from public.store_specialists
  where id::text = 'f9e36630-9793-40cd-9d3c-53b5ee450b1c'
    and store_number = '2587'
    and role = 'MasterAdmin'
    and coalesce(pin_code, '') like 'scrypt1$%'
    and coalesce(pin_hash, '') like 'scrypt1$%';

  if v_profiles <> 1 or v_store_profiles <> 1 or v_master <> 1 then
    raise exception
      'SEC-OPS-007 gate failed: profiles=% store_profiles=% master=% (expected 1/1/1)',
      v_profiles, v_store_profiles, v_master;
  end if;
end $$;

-- Clear superseded profiles credential mirror (identity preserved)
do $$
declare
  v_updated integer;
begin
  update public.profiles
  set
    pin = '',
    pin_code = null,
    pin_hash = null
  where id::text = '0f3b20ce-85bf-4d1b-8103-4b81648d396d'
    and store_number = '2587'
    and specialist_id::text = 'f9e36630-9793-40cd-9d3c-53b5ee450b1c'
    and coalesce(pin, '') ~ '^\d{4,8}$'
    and coalesce(pin_code, '') ~ '^\d{4,8}$'
    and coalesce(pin_hash, '') = '';

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'SEC-OPS-007 profiles update affected % rows (expected 1)', v_updated;
  end if;
end $$;

-- Clear orphan store_profiles credential fields (identity preserved)
do $$
declare
  v_updated integer;
begin
  update public.store_profiles
  set
    pin = '',
    pin_code = null
  where id::text = '0b7d86d3-5f14-447d-b2f5-5ff8997947a7'
    and store_number = '1852'
    and lower(coalesce(username, '')) = 'master_admin'
    and coalesce(pin, '') ~ '^\d{4,8}$'
    and coalesce(pin_code, '') ~ '^\d{4,8}$';

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'SEC-OPS-007 store_profiles update affected % rows (expected 1)', v_updated;
  end if;
end $$;

-- Post-update gates inside the same transaction
do $$
declare
  v_profiles_digit integer;
  v_store_digit integer;
  v_specialist_digit integer;
  v_master_scrypt integer;
  v_profiles_row integer;
  v_store_row integer;
begin
  select count(*) into v_profiles_digit
  from public.profiles
  where coalesce(pin, '') ~ '^\d{4,8}$'
     or coalesce(pin_code, '') ~ '^\d{4,8}$';

  select count(*) into v_store_digit
  from public.store_profiles
  where coalesce(pin, '') ~ '^\d{4,8}$'
     or coalesce(pin_code, '') ~ '^\d{4,8}$';

  select count(*) into v_specialist_digit
  from public.store_specialists
  where coalesce(pin_code, '') ~ '^\d{4,8}$'
     or coalesce(pin_hash, '') ~ '^\d{4,8}$';

  select count(*) into v_master_scrypt
  from public.store_specialists
  where id::text = 'f9e36630-9793-40cd-9d3c-53b5ee450b1c'
    and coalesce(pin_code, '') like 'scrypt1$%'
    and coalesce(pin_hash, '') like 'scrypt1$%'
    and role = 'MasterAdmin'
    and store_number = '2587';

  select count(*) into v_profiles_row
  from public.profiles
  where id::text = '0f3b20ce-85bf-4d1b-8103-4b81648d396d'
    and store_number = '2587'
    and specialist_id::text = 'f9e36630-9793-40cd-9d3c-53b5ee450b1c'
    and role = 'super_admin'
    and pin = ''
    and pin_code is null
    and coalesce(pin_hash, '') = '';

  select count(*) into v_store_row
  from public.store_profiles
  where id::text = '0b7d86d3-5f14-447d-b2f5-5ff8997947a7'
    and store_number = '1852'
    and lower(coalesce(username, '')) = 'master_admin'
    and role = 'admin'
    and pin = ''
    and pin_code is null;

  if v_profiles_digit <> 0
     or v_store_digit <> 0
     or v_specialist_digit <> 0
     or v_master_scrypt <> 1
     or v_profiles_row <> 1
     or v_store_row <> 1 then
    raise exception
      'SEC-OPS-007 post-check failed: profiles_digit=% store_digit=% specialist_digit=% master_scrypt=% profiles_row=% store_row=%',
      v_profiles_digit, v_store_digit, v_specialist_digit, v_master_scrypt, v_profiles_row, v_store_row;
  end if;
end $$;

commit;
