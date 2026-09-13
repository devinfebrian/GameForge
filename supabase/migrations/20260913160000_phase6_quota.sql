-- GameForge AI: daily token budget and burst limiter (Phase 6)
--
-- Two limits, deliberately Postgres-backed rather than Redis:
--
--   burst     a sliding window over generation_runs, which already records one
--             row per claimed run with a started_at index. No new state, and the
--             count is a normal indexed range scan.
--   budget    a per-(user, UTC day) counter, incremented at each run's terminal
--             state by the tokens that run actually spent. Nothing is ever
--             decremented, so no refund path is needed at all.
--
-- The window and the budget are checked before the run slot is claimed, not
-- inside begin_generation_run. A lost race between the check and the claim then
-- degrades to the existing 409 run_in_progress rather than a bypass, because the
-- lease, not this function, is the gate that bounds concurrency.
--
-- begin_generation_run / finish_generation_run are intentionally untouched: the
-- pre-check is additive so their contract and tests stay valid.

-- ---------------------------------------------------------------------------
-- user_token_usage
-- ---------------------------------------------------------------------------

create table if not exists public.user_token_usage (
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- UTC, derived in the functions below and never supplied by a caller: the
  -- budget must roll over at one unambiguous instant regardless of server locale.
  day date not null,
  tokens_used bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- Like generation_runs and llm_configurations: RLS on with zero policies and no
-- client grants, so only the service-role client reaches it.
alter table public.user_token_usage enable row level security;

revoke all on public.user_token_usage from anon, authenticated;
grant all on public.user_token_usage to service_role;

-- ---------------------------------------------------------------------------
-- check_run_allowed
-- ---------------------------------------------------------------------------

-- NULL when the run may start; otherwise the refusal the route maps to a status.
-- Burst is checked first because it is the cheaper query and the one a caller can
-- trip by accident; an exhausted budget is the slower, deliberate refusal.
create or replace function public.check_run_allowed(
  p_user_id uuid,
  p_daily_token_limit bigint,
  p_burst_limit integer
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_recent integer;
  v_used bigint;
begin
  select count(*)::integer into v_recent
    from public.generation_runs
   where generation_runs.user_id = p_user_id
     and generation_runs.started_at > now() - interval '1 minute';

  if v_recent >= p_burst_limit then
    return 'rate_limited';
  end if;

  select user_token_usage.tokens_used into v_used
    from public.user_token_usage
   where user_token_usage.user_id = p_user_id
     and user_token_usage.day = (now() at time zone 'utc')::date;

  if coalesce(v_used, 0) >= p_daily_token_limit then
    return 'quota_exceeded';
  end if;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- add_token_usage / token_usage_today
-- ---------------------------------------------------------------------------

-- Adds a run's tokens to today's counter and returns the new total.
-- A non-positive p_tokens is a no-op that returns the current total, so callers
-- can report "charged nothing" without a special case.
create or replace function public.add_token_usage(
  p_user_id uuid,
  p_tokens bigint
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_total bigint;
begin
  if p_tokens <= 0 then
    select user_token_usage.tokens_used into v_total
      from public.user_token_usage
     where user_token_usage.user_id = p_user_id
       and user_token_usage.day = (now() at time zone 'utc')::date;

    return coalesce(v_total, 0);
  end if;

  insert into public.user_token_usage (user_id, day, tokens_used)
  values (p_user_id, (now() at time zone 'utc')::date, p_tokens)
  on conflict (user_id, day)
  do update
     set tokens_used = public.user_token_usage.tokens_used + excluded.tokens_used,
         updated_at = now()
  returning user_token_usage.tokens_used into v_total;

  return v_total;
end;
$$;

-- The Studio budget bar and the admin page read through this, so the definition
-- of "today" lives in exactly one place.
create or replace function public.token_usage_today(p_user_id uuid)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_used bigint;
begin
  select user_token_usage.tokens_used into v_used
    from public.user_token_usage
   where user_token_usage.user_id = p_user_id
     and user_token_usage.day = (now() at time zone 'utc')::date;

  return coalesce(v_used, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Service-role only, matching begin_generation_run. None of these is reachable
-- from a client; the routes call them through the admin client.

revoke execute on function public.check_run_allowed(uuid, bigint, integer)
  from public, anon, authenticated;
revoke execute on function public.add_token_usage(uuid, bigint)
  from public, anon, authenticated;
revoke execute on function public.token_usage_today(uuid)
  from public, anon, authenticated;

grant execute on function public.check_run_allowed(uuid, bigint, integer) to service_role;
grant execute on function public.add_token_usage(uuid, bigint) to service_role;
grant execute on function public.token_usage_today(uuid) to service_role;

comment on table public.user_token_usage is
  'Per-user, per-UTC-day token spend. Charged at each run''s terminal state for the tokens it spent; never decremented.';

comment on function public.check_run_allowed(uuid, bigint, integer) is
  'NULL when a run may start, else ''rate_limited'' (burst window) or ''quota_exceeded'' (daily budget).';

comment on function public.add_token_usage(uuid, bigint) is
  'Adds tokens to today''s counter atomically and returns the new total. Non-positive input is a no-op.';

comment on function public.token_usage_today(uuid) is
  'Today''s (UTC) token spend for a user, 0 when nothing has been charged.';
