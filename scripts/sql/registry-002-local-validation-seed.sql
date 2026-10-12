-- Seed for REGISTRY-002 disposable validation DB.

begin;

insert into public.stores (id, store_number)
values
  ('11111111-1111-1111-1111-111111111111', '2587-test'),
  ('22222222-2222-2222-2222-222222222222', '9999-test')
on conflict (store_number) do nothing;

insert into public.departments (id, store_id, name, code)
values
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '11111111-1111-1111-1111-111111111111',
    'Flooring',
    'flooring'
  ),
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    '11111111-1111-1111-1111-111111111111',
    'Home Decor',
    'home_decor'
  )
on conflict do nothing;

-- 6 bay surfaces:
-- 41 active + 41 retired (mixed) → registry active
-- 012 / 12 padding collapse → one registry aisle "12"
-- CARPET-WALL active named zone
-- 99 fully retired
insert into public.store_locations (
  store_id, department_id, aisle, bay, type, is_active, updated_at
) values
  (
    '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '41',
    1,
    'SELLING',
    true,
    now()
  ),
  (
    '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '41',
    3,
    'SELLING',
    false,
    now()
  ),
  (
    '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '012',
    1,
    'SELLING',
    true,
    now()
  ),
  (
    '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '12',
    2,
    'SELLING',
    true,
    now()
  ),
  (
    '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'carpet-wall',
    1,
    'SELLING',
    true,
    now()
  ),
  (
    '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '99',
    1,
    'SELLING',
    false,
    now() - interval '1 day'
  );

commit;
