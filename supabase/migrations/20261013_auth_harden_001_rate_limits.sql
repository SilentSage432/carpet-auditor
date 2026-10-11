-- DEPTSYNC-AUTH-HARDEN-001 / 001A — shared auth rate-limit table + atomic touch RPC
-- HARD PREREQUISITE: apply this BEFORE deploying hub-bridge fail-closed rate limiting.
-- Without this RPC, public PIN login returns 503 (fail-closed) — not a silent bypass.
-- No operational roster/PIN data changes. Service-role / security definer only.

begin;

create table if not exists public.auth_rate_limits (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  failure_count integer not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.auth_rate_limits is
  'AUTH-HARDEN-001 shared login rate-limit buckets (service role / definer RPC only).';

alter table public.auth_rate_limits enable row level security;

-- No policies for anon/authenticated — client roles cannot read or write.
revoke all on table public.auth_rate_limits from anon, authenticated;
grant select, insert, update, delete on table public.auth_rate_limits to service_role;

-- p_mode:
--   attempt — atomically consume one attempt slot BEFORE PIN verify (race-safe)
--   fail    — alias of attempt (legacy name)
--   peek    — read-only check (tests / ops; not used for admit)
--   success — clear THIS bucket only after verified login
create or replace function public.touch_auth_rate_limit(
  p_bucket_key text,
  p_window_ms integer,
  p_max_failures integer,
  p_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_row public.auth_rate_limits%rowtype;
  v_window interval;
  v_allowed boolean;
  v_retry_ms integer;
  v_mode text := lower(coalesce(nullif(btrim(p_mode), ''), 'attempt'));
  v_count integer := 0;
  v_started timestamptz;
begin
  if p_bucket_key is null or btrim(p_bucket_key) = '' then
    return jsonb_build_object(
      'allowed', false,
      'failure_count', 0,
      'retry_after_ms', 0,
      'reason', 'invalid_bucket'
    );
  end if;

  if p_window_ms is null or p_window_ms < 1000 then
    p_window_ms := 900000; -- 15 minutes
  end if;
  if p_max_failures is null or p_max_failures < 1 then
    p_max_failures := 8;
  end if;

  v_window := make_interval(secs => greatest(1, (p_window_ms / 1000)::int));

  -- Normalize aliases
  if v_mode = 'fail' then
    v_mode := 'attempt';
  end if;

  if v_mode = 'success' then
    -- Clears only the caller's bucket_key — never another actor's row.
    delete from public.auth_rate_limits where bucket_key = p_bucket_key;
    return jsonb_build_object(
      'allowed', true,
      'failure_count', 0,
      'retry_after_ms', 0,
      'reason', 'cleared'
    );
  end if;

  if v_mode not in ('attempt', 'peek') then
    return jsonb_build_object(
      'allowed', false,
      'failure_count', 0,
      'retry_after_ms', p_window_ms,
      'reason', 'invalid_mode'
    );
  end if;

  -- Serialize concurrent attempts for this bucket.
  select * into v_row
  from public.auth_rate_limits
  where bucket_key = p_bucket_key
  for update;

  if not found then
    v_count := 0;
    v_started := v_now;
    if v_mode = 'attempt' then
      insert into public.auth_rate_limits (bucket_key, window_started_at, failure_count, updated_at)
      values (p_bucket_key, v_now, 1, v_now)
      on conflict (bucket_key) do update
        set failure_count = case
              when public.auth_rate_limits.window_started_at + v_window <= v_now
                then 1
              else public.auth_rate_limits.failure_count + 1
            end,
            window_started_at = case
              when public.auth_rate_limits.window_started_at + v_window <= v_now
                then v_now
              else public.auth_rate_limits.window_started_at
            end,
            updated_at = v_now
      returning * into v_row;
      v_count := v_row.failure_count;
      v_started := v_row.window_started_at;
    end if;
  elsif v_row.window_started_at + v_window <= v_now then
    -- Window expired
    v_count := 0;
    v_started := v_now;
    if v_mode = 'attempt' then
      update public.auth_rate_limits
      set window_started_at = v_now,
          failure_count = 1,
          updated_at = v_now
      where bucket_key = p_bucket_key
      returning * into v_row;
      v_count := v_row.failure_count;
      v_started := v_row.window_started_at;
    end if;
  else
    v_count := v_row.failure_count;
    v_started := v_row.window_started_at;
    if v_mode = 'attempt' then
      update public.auth_rate_limits
      set failure_count = failure_count + 1,
          updated_at = v_now
      where bucket_key = p_bucket_key
      returning * into v_row;
      v_count := v_row.failure_count;
      v_started := v_row.window_started_at;
    end if;
  end if;

  -- attempt: allow while count after consume <= max (exactly max attempts per window)
  -- peek: allow while prior count < max
  if v_mode = 'peek' then
    v_allowed := v_count < p_max_failures;
  else
    v_allowed := v_count <= p_max_failures;
  end if;

  if v_allowed then
    v_retry_ms := 0;
  else
    v_retry_ms := greatest(
      0,
      floor(extract(epoch from (v_started + v_window - v_now)) * 1000)::int
    );
  end if;

  return jsonb_build_object(
    'allowed', v_allowed,
    'failure_count', v_count,
    'retry_after_ms', v_retry_ms,
    'reason', case
      when not v_allowed then 'limited'
      when v_mode = 'peek' then 'peek'
      else 'counted'
    end
  );
end;
$$;

revoke all on function public.touch_auth_rate_limit(text, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.touch_auth_rate_limit(text, integer, integer, text)
  to service_role;

commit;
