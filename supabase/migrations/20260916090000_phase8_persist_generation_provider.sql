-- GameForge AI: Phase 8 — record which gateway actually produced a run, and
-- whether it came from the fallback (multi-provider failover bookkeeping).
--
-- `game_messages` has carried `provider`, `is_fallback` and `fallback_reason`
-- since Phase 1, but `persist_generation` wrote them as constants (`'anthropic'`,
-- `false`, absent). With a Groq fallback in the pipeline those constants would
-- lie in the transcript, so the three become parameters. The old signature is
-- dropped rather than overloaded, because `create or replace` only replaces on
-- an exact signature match and a new parameter list would silently leave the
-- stale 15-argument function alive next to the new one.

drop function if exists public.persist_generation(
  uuid, uuid, text, text, text, text, jsonb, jsonb, text, text, boolean,
  text, integer, integer, text
);

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
  p_provider text default 'anthropic',
  p_is_fallback boolean default false,
  p_fallback_reason text default null,
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
    is_fallback,
    fallback_reason
  ) values (
    v_game_id,
    p_user_id,
    'assistant',
    p_assistant_message,
    'coder_agent',
    case
      when p_provider in ('anthropic', 'openai', 'google', 'groq')
        then p_provider::public.llm_provider
      else null
    end,
    p_model_used,
    p_tokens_used,
    p_execution_time_ms,
    p_is_fallback,
    p_fallback_reason
  );

  result_game_id := v_game_id;
  result_version_id := v_version_id;
  result_version_number := v_version_number;
end;
$$;

comment on function public.persist_generation(
  uuid, uuid, text, text, text, text, jsonb, jsonb, text, text, boolean,
  text, integer, integer, text, text, boolean, text
) is 'Atomically records one generation run, including which gateway produced it and whether the fallback was used. Never called for aborted runs.';

-- Reachable only through the service-role client, like llm_configurations
-- itself. The route handler authenticates and then writes via this function.
revoke execute on function public.persist_generation(
  uuid, uuid, text, text, text, text, jsonb, jsonb, text, text, boolean,
  text, integer, integer, text, text, boolean, text
) from public, anon, authenticated;

grant execute on function public.persist_generation(
  uuid, uuid, text, text, text, text, jsonb, jsonb, text, text, boolean,
  text, integer, integer, text, text, boolean, text
) to service_role;
