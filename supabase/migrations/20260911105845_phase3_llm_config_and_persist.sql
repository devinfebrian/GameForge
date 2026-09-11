-- GameForge AI: Phase 3 agent configuration + atomic generation persistence
--
-- Phase 1 provisioned the tables; Phase 3 needs two more things from the
-- database:
--   1. An active llm_configurations row per agent that exists today, so no model
--      id is hardcoded in application code.
--   2. A single atomic write per generation run. "A client abort persists
--      nothing" and "a failed run still persists a version" cannot both be true
--      if rows are written incrementally, so every write for a run happens in
--      one function call issued only at a terminal, non-aborted state.

-- ---------------------------------------------------------------------------
-- Seed llm_configurations
-- ---------------------------------------------------------------------------

-- is_active defaults to false, and llm_configurations_active_agent_type_idx is a
-- PARTIAL unique index (agent_type where is_active), so the conflict target has
-- to repeat that predicate or the insert never matches it.
--
-- debug_agent is deliberately absent: the agent that reads it is Phase 5, and
-- seeding it now would advertise a configuration nothing consumes.
-- api_key_override_encrypted stays NULL until Phase 6 builds the AES-256-GCM
-- path; the env key is the only credential source in Phase 3.
insert into public.llm_configurations (agent_type, provider, model_name, is_active)
values
  ('spec_agent', 'anthropic', 'claude-sonnet-5', true),
  ('asset_mapper', 'anthropic', 'claude-sonnet-5', true),
  ('coder_agent', 'anthropic', 'claude-sonnet-5', true)
on conflict (agent_type) where is_active do nothing;

-- ---------------------------------------------------------------------------
-- persist_generation
-- ---------------------------------------------------------------------------

-- Writes one generation run to the database in a single transaction:
--   * creates the game when the run started without one,
--   * inserts the version snapshot (always is_stable = false, see below),
--   * moves games.current_version_id only when the run succeeded,
--   * appends the user prompt and the assistant transcript rows.
--
-- is_stable is false on every insert, including successful ones. Stability is a
-- claim about runtime behaviour, and only Phase 5's 3-second probation in the
-- sandbox is entitled to make it. A successful-but-unproven version is
-- distinguishable from a failed one by error_log IS NULL.
--
-- games.last_stable_version_id is never touched here, for the same reason.
create or replace function public.persist_generation(
  p_user_id uuid,
  p_game_id uuid,
  p_title text,
  p_description text,
  p_genre text,
  p_prompt text,
  p_spec jsonb,
  p_asset_manifest jsonb,
  p_source_code text,
  p_error_log text,
  p_promote_current boolean,
  p_model_used text,
  p_tokens_used integer,
  p_execution_time_ms integer,
  p_assistant_message text,
  out result_game_id uuid,
  out result_version_id uuid,
  out result_version_number integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_game_id uuid;
  v_version_id uuid;
  v_version_number integer;
begin
  if p_game_id is null then
    insert into public.games (user_id, title, description, genre)
    values (p_user_id, p_title, p_description, p_genre)
    returning games.id into v_game_id;
  else
    -- Ownership is re-checked here rather than trusted from the caller: this is
    -- the only place a write can escape a bad route handler. FOR UPDATE also
    -- serialises concurrent runs against the same game.
    select games.id into v_game_id
      from public.games
     where games.id = p_game_id
       and games.user_id = p_user_id
     for update;

    if not found then
      raise exception 'game % is not owned by user %', p_game_id, p_user_id
        using errcode = '42501';
    end if;
  end if;

  -- Takes the per-game advisory lock internally, so two concurrent runs cannot
  -- be handed the same version number.
  insert into public.game_versions (
    game_id,
    version_number,
    prompt,
    spec,
    asset_manifest,
    source_code,
    is_stable,
    error_log
  ) values (
    v_game_id,
    public.next_version_number(v_game_id),
    p_prompt,
    p_spec,
    p_asset_manifest,
    p_source_code,
    false,
    p_error_log
  )
  returning game_versions.id, game_versions.version_number
    into v_version_id, v_version_number;

  if p_promote_current then
    update public.games
       set current_version_id = v_version_id
     where games.id = v_game_id;
  end if;

  insert into public.game_messages (
    game_id,
    user_id,
    role,
    content
  ) values (
    v_game_id,
    p_user_id,
    'user',
    p_prompt
  );

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
    'coder_agent',
    'anthropic',
    p_model_used,
    p_tokens_used,
    p_execution_time_ms,
    false
  );

  result_game_id := v_game_id;
  result_version_id := v_version_id;
  result_version_number := v_version_number;
end;
$$;

comment on function public.persist_generation(
  uuid, uuid, text, text, text, text, jsonb, jsonb, text, text, boolean,
  text, integer, integer, text
) is 'Atomically records one Phase 3 generation run. Never called for aborted runs.';

-- Reachable only through the service-role client, like llm_configurations
-- itself. The route handler authenticates and then writes via this function.
revoke execute on function public.persist_generation(
  uuid, uuid, text, text, text, text, jsonb, jsonb, text, text, boolean,
  text, integer, integer, text
) from public, anon, authenticated;

grant execute on function public.persist_generation(
  uuid, uuid, text, text, text, text, jsonb, jsonb, text, text, boolean,
  text, integer, integer, text
) to service_role;
