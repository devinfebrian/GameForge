-- GameForge AI: debug agent, stability write-back, and self-healing (Phase 5)
--
-- Phase 3 writes a version with is_stable = false and never touches
-- games.last_stable_version_id: only a 3-second sandbox probation is entitled to
-- call a version stable. Phase 5 is that probation, plus what happens when it
-- fails. Three pieces are added here:
--
--   game_versions.debug_of_version_id   marks a self-healing candidate and names
--                                       the version its repair session is fixing.
--   commit_version_stability            the single atomic "this version proved
--                                       itself" write, owner-checked.
--   persist_debug_candidate             the single atomic write of one repair
--                                       attempt, non-promoted and non-stable.
--   reset_game_current_to_stable        the pointer-safety move made before the
--                                       first repair attempt.
--
-- The counter that bounds the retry loop is not a column: it is the number of
-- candidate rows already rooted at a version, which is durable, reload-safe, and
-- already implied by the write below.

-- ---------------------------------------------------------------------------
-- llm_configurations: the debug agent
-- ---------------------------------------------------------------------------

-- Phase 3 deliberately left debug_agent unseeded because nothing consumed it.
-- Phase 5's debug route is that consumer, so the row lands here rather than
-- waiting on the Phase 6 admin dashboard.
insert into public.llm_configurations (agent_type, provider, model_name, is_active)
values ('debug_agent', 'anthropic', 'claude-sonnet-5', true)
on conflict (agent_type) where is_active do nothing;

-- ---------------------------------------------------------------------------
-- game_versions.debug_of_version_id
-- ---------------------------------------------------------------------------

-- A non-null value marks a row as a repair candidate and points at the version
-- the whole repair session is trying to fix (the root, not the immediate
-- parent), which is what makes the attempt count a single flat query instead of
-- a recursive walk. Ordinary generated and patched versions leave it null.
alter table public.game_versions
  add column if not exists debug_of_version_id uuid
    references public.game_versions (id) on delete set null;

create index if not exists game_versions_game_id_debug_of_version_id_idx
  on public.game_versions (game_id, debug_of_version_id)
  where debug_of_version_id is not null;

-- ---------------------------------------------------------------------------
-- persist_debug_candidate
-- ---------------------------------------------------------------------------

-- Records one repair attempt in a single transaction:
--   * checks the game belongs to the user, taking the same row lock
--     persist_generation and rollback_game_version take,
--   * copies the root version's spec, manifest and prompt so the candidate is
--     bootable through the normal /api/games/.../versions/:id path,
--   * never touches games.current_version_id: a candidate is promoted only by
--     commit_version_stability, once the sandbox has actually run it.
--
-- p_source_code is null for an attempt whose fix failed the server-side boot
-- gate. That is a tombstone in the same sense a failed patch already is: the
-- attempt is counted and auditable, but no unparseable code is ever stored.
create or replace function public.persist_debug_candidate(
  p_user_id uuid,
  p_game_id uuid,
  p_root_version_id uuid,
  p_source_code text,
  p_error_log text,
  p_model_used text,
  p_tokens_used integer,
  p_execution_time_ms integer,
  p_assistant_message text,
  out result_version_id uuid,
  out result_version_number integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_game_id uuid;
  v_spec jsonb;
  v_asset_manifest jsonb;
  v_prompt text;
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

  select game_versions.spec, game_versions.asset_manifest, game_versions.prompt
    into v_spec, v_asset_manifest, v_prompt
    from public.game_versions
   where game_versions.id = p_root_version_id
     and game_versions.game_id = p_game_id;

  if not found then
    raise exception 'version % does not belong to game %', p_root_version_id, p_game_id
      using errcode = 'P0002';
  end if;

  insert into public.game_versions (
    game_id,
    version_number,
    prompt,
    spec,
    asset_manifest,
    source_code,
    is_stable,
    error_log,
    debug_of_version_id
  ) values (
    v_game_id,
    public.next_version_number(v_game_id),
    v_prompt,
    v_spec,
    v_asset_manifest,
    p_source_code,
    false,
    p_error_log,
    p_root_version_id
  )
  returning game_versions.id, game_versions.version_number
    into result_version_id, result_version_number;

  insert into public.game_messages (
    game_id,
    user_id,
    role,
    content,
    agent_type,
    provider,
    model_used,
    tokens_used,
    execution_time_ms,
    is_fallback
  ) values (
    v_game_id,
    p_user_id,
    'assistant',
    p_assistant_message,
    'debug_agent',
    'anthropic',
    p_model_used,
    p_tokens_used,
    p_execution_time_ms,
    false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- reset_game_current_to_stable
-- ---------------------------------------------------------------------------

-- Repoints games.current_version_id at last_stable_version_id, which is the
-- pointer-safety move made the moment probation fails rather than after three
-- attempts. NULL last_stable_version_id is not an error: it is the first-ever
-- version case, where the game has nothing good to fall back to and is left
-- with no current version until a repair succeeds or the user regenerates.
--
-- Idempotent, so a reload mid-repair cannot leave the pointer anywhere else.
create or replace function public.reset_game_current_to_stable(
  p_user_id uuid,
  p_game_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_game_id uuid;
  v_current uuid;
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

  update public.games
     set current_version_id = games.last_stable_version_id
   where games.id = p_game_id
   returning games.current_version_id into v_current;

  return v_current;
end;
$$;

-- ---------------------------------------------------------------------------
-- commit_version_stability
-- ---------------------------------------------------------------------------

-- The one write entitled to set is_stable = true, idempotent by version id.
--
-- Ordinary versions (debug_of_version_id is null) are only confirmed while they
-- are still games.current_version_id. That is the original probation rule: a
-- hot-patch that superseded this version wins, and the late callback is ignored
-- rather than rewriting last_stable_version_id to a version the game no longer
-- points at.
--
-- A candidate is different: it is never current before it proves itself, so
-- "ignore unless current" would discard every repair's own success. It is
-- instead promoted here, guarded by version_number so a version the user
-- promoted in the meantime is never overwritten.
create or replace function public.commit_version_stability(
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
  v_version_number integer;
  v_is_candidate boolean;
  v_current uuid;
  v_current_number integer;
begin
  select games.id, games.current_version_id
    into v_game_id, v_current
    from public.games
   where games.id = p_game_id
     and games.user_id = p_user_id
   for update;

  if not found then
    raise exception 'game % is not owned by user %', p_game_id, p_user_id
      using errcode = '42501';
  end if;

  select game_versions.version_number,
         game_versions.debug_of_version_id is not null
    into v_version_number, v_is_candidate
    from public.game_versions
   where game_versions.id = p_version_id
     and game_versions.game_id = p_game_id;

  if not found then
    raise exception 'version % does not belong to game %', p_version_id, p_game_id
      using errcode = 'P0002';
  end if;

  if v_is_candidate then
    update public.game_versions
       set is_stable = true
     where game_versions.id = p_version_id;

    -- The current version's own number, to decide whether the candidate is newer.
    select game_versions.version_number into v_current_number
      from public.game_versions
     where game_versions.id = v_current;

    if v_current is null
       or (v_current_number is not null and v_current_number < v_version_number) then
      update public.games
         set current_version_id = p_version_id,
             last_stable_version_id = p_version_id
       where games.id = p_game_id;

      v_current := p_version_id;
    end if;
  elsif v_current = p_version_id then
    update public.game_versions
       set is_stable = true
     where game_versions.id = p_version_id;

    update public.games
       set last_stable_version_id = p_version_id
     where games.id = p_game_id;
  end if;

  return v_current;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Service-role only, matching persist_generation and rollback_game_version.
-- Nothing here is reachable by a client, so authorisation stays in the route
-- handler and the DAL.

revoke execute on function public.persist_debug_candidate(
  uuid, uuid, uuid, text, text, text, integer, integer, text
) from public, anon, authenticated;
revoke execute on function public.reset_game_current_to_stable(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.commit_version_stability(uuid, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.persist_debug_candidate(
  uuid, uuid, uuid, text, text, text, integer, integer, text
) to service_role;
grant execute on function public.reset_game_current_to_stable(uuid, uuid)
  to service_role;
grant execute on function public.commit_version_stability(uuid, uuid, uuid)
  to service_role;

comment on function public.persist_debug_candidate(
  uuid, uuid, uuid, text, text, text, integer, integer, text
) is 'Records one self-healing attempt as a non-promoted, non-stable candidate. Null source is a boot-gate tombstone.';

comment on function public.reset_game_current_to_stable(uuid, uuid) is
  'Repoints games.current_version_id at last_stable_version_id (possibly NULL) after a probation failure.';

comment on function public.commit_version_stability(uuid, uuid, uuid) is
  'Atomically marks a version stable; promotes a proven repair candidate unless a newer version is current. Idempotent by version id.';
