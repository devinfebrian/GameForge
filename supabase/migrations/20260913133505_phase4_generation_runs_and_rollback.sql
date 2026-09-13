-- GameForge AI: one-active-run guard and version rollback (Phase 4)
--
-- Two pieces of server-side state the Studio depends on, both of which have to
-- be race-free rather than merely correct in the happy path:
--
--   generation_runs        a per-user lease, so a second run cannot start while
--                          one is in flight, and a killed run cannot lock a user
--                          out permanently.
--   rollback_game_version  repoints games.current_version_id under the SAME row
--                          lock persist_generation takes, so a rollback and a
--                          concurrent generation cannot interleave into a torn
--                          pointer.
--
-- The run guard is deliberately Postgres-backed. An in-process map would be
-- enough on a single long-lived server, but this app deploys to a serverless
-- runtime where two instances can serve the same user, which is exactly the
-- duplicate the guard exists to prevent.

-- ---------------------------------------------------------------------------
-- generation_runs
-- ---------------------------------------------------------------------------

create table if not exists public.generation_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Kept for observability. SET NULL rather than CASCADE so deleting a game
  -- cannot silently release a run that is still executing.
  game_id uuid references public.games (id) on delete set null,
  status text not null default 'running'
    constraint generation_runs_status_check
    check (status in ('running', 'expired', 'completed', 'failed', 'aborted')),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

-- The guard itself. At most one 'running' row per user; every other status is
-- excluded from the index so history accumulates freely.
create unique index if not exists generation_runs_one_active_per_user_idx
  on public.generation_runs (user_id)
  where status = 'running';

create index if not exists generation_runs_user_id_started_at_idx
  on public.generation_runs (user_id, started_at desc);

-- Like llm_configurations: RLS on with zero policies and no client grants, so
-- the API roles cannot read or write it at all. Only the service-role client
-- reaches it, from the route handlers.
alter table public.generation_runs enable row level security;

revoke all on public.generation_runs from anon, authenticated;
grant all on public.generation_runs to service_role;

-- ---------------------------------------------------------------------------
-- begin_generation_run / finish_generation_run
-- ---------------------------------------------------------------------------

-- Claims the user's single run slot and returns the new run id, or NULL when
-- another run is already active.
--
-- The expiry pass is the load-bearing part. The route releases its run in a
-- `finally`, but a serverless platform kills the process at maxDuration without
-- running it, and a row stuck at 'running' would then lock that user out
-- forever. Anything older than the route's ceiling is therefore dead by
-- definition, and the ceiling here (6 minutes) is deliberately longer than
-- /api/generate's maxDuration (5 minutes).
--
-- Expiring and inserting in one transaction is what makes this safe under
-- concurrency: two simultaneous callers both expire nothing, then race on the
-- partial unique index, and the loser is handed NULL rather than a second run.
create or replace function public.begin_generation_run(
  p_user_id uuid,
  p_game_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run_id uuid;
begin
  update public.generation_runs
     set status = 'expired',
         finished_at = now()
   where generation_runs.user_id = p_user_id
     and generation_runs.status = 'running'
     and generation_runs.started_at < now() - interval '6 minutes';

  begin
    insert into public.generation_runs (user_id, game_id)
    values (p_user_id, p_game_id)
    returning generation_runs.id into v_run_id;
  exception
    when unique_violation then
      return null;
  end;

  return v_run_id;
end;
$$;

-- Releases the slot. The `status = 'running'` predicate matters: a process that
-- outlived its own expiry must not resurrect an 'expired' row on its way out.
-- p_status is validated by the table's check constraint.
create or replace function public.finish_generation_run(
  p_run_id uuid,
  p_status text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.generation_runs
     set status = p_status,
         finished_at = now()
   where generation_runs.id = p_run_id
     and generation_runs.status = 'running';
end;
$$;

-- ---------------------------------------------------------------------------
-- rollback_game_version
-- ---------------------------------------------------------------------------

-- Repoints games.current_version_id at an earlier version, in place: no new
-- game_versions row is inserted, so version_number ordering stays append-only
-- and the unique (game_id, version_number) constraint is untouched.
--
-- `for update` on the games row is the same lock persist_generation takes, which
-- is the whole point: the two writers of current_version_id serialise instead of
-- interleaving. Whichever commits second is the final pointer, which is
-- deterministic last-writer-wins; what the lock rules out is a read-modify-write
-- race leaving the game pointing at neither writer's intent.
--
-- The version check is composite (id AND game_id) on purpose. A version id alone
-- would let a caller retarget a game at somebody else's version, so the
-- ownership predicate and the version's parent are both enforced here rather
-- than trusted from the route.
create or replace function public.rollback_game_version(
  p_user_id uuid,
  p_game_id uuid,
  p_version_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_game_id uuid;
begin
  select games.id into v_game_id
    from public.games
   where games.id = p_game_id
     and games.user_id = p_user_id
   for update;

  if not found then
    raise exception 'game % is not owned by user %', p_game_id, p_user_id
      using errcode = '42501';
  end if;

  if not exists (
    select 1
      from public.game_versions
     where game_versions.id = p_version_id
       and game_versions.game_id = p_game_id
  ) then
    raise exception 'version % does not belong to game %', p_version_id, p_game_id
      using errcode = 'P0002';
  end if;

  update public.games
     set current_version_id = p_version_id
   where games.id = p_game_id;

  return p_version_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Service-role only, matching persist_generation. None of these is reachable
-- from a client, so authorisation stays entirely inside the route + DAL.

revoke execute on function public.begin_generation_run(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.finish_generation_run(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.rollback_game_version(uuid, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.begin_generation_run(uuid, uuid) to service_role;
grant execute on function public.finish_generation_run(uuid, text) to service_role;
grant execute on function public.rollback_game_version(uuid, uuid, uuid) to service_role;

comment on function public.begin_generation_run(uuid, uuid) is
  'Claims the user''s single run slot, expiring runs older than maxDuration first. NULL when one is active.';
comment on function public.finish_generation_run(uuid, text) is
  'Releases a claimed run slot. No-op unless the run is still ''running''.';
comment on function public.rollback_game_version(uuid, uuid, uuid) is
  'Repoints games.current_version_id under the persist_generation row lock. Owner-checked, composite version check.';
