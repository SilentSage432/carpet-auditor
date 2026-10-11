-- DEPTSYNC-SEC-OPS-002 — capture pre/post policy + grant state (readonly)
select tablename, policyname, roles::text, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('bay_service_logs', 'rotation_exceptions')
order by 1, 2;

select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('bay_service_logs', 'rotation_exceptions')
  and grantee in ('anon', 'authenticated', 'service_role')
order by 1, 2, 3;

select table_name, column_name, grantee, privilege_type
from information_schema.column_privileges
where table_schema = 'public'
  and table_name in ('store_specialists', 'profiles')
  and column_name in (
    'pin_code', 'pin_hash', 'temp_pin_hash', 'invite_token',
    'invite_token_hash', 'auth_token_hash', 'pin'
  )
  and grantee in ('anon', 'authenticated')
  and privilege_type = 'SELECT'
order by 1, 2, 3;
