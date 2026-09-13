-- GameForge AI: Phase 5 follow-up — keep is_stable and last_stable_version_id in step
--
-- commit_version_stability previously set is_stable = true on a proven repair
-- candidate before deciding whether to promote it. When the user had already
-- moved the game on to a newer version, that left the candidate marked stable
-- while games.last_stable_version_id pointed elsewhere: a version the game does
-- not rest on, and one no rollback target should ever be derived from.
--
-- The flag now moves only in the same branch that moves last_stable_version_id,
-- so "is_stable = true" and "this is the version the game rests on" cannot
-- disagree. Everything else about the function is unchanged, so this replaces the
-- body in place: create or replace keeps the existing signature, owner and
-- grants, and no overload is introduced.

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
    -- The current version's own number, to decide whether the candidate is newer.
    select game_versions.version_number into v_current_number
      from public.game_versions
     where game_versions.id = v_current;

    if v_current is null
       or (v_current_number is not null and v_current_number < v_version_number) then
      update public.game_versions
         set is_stable = true
       where game_versions.id = p_version_id;

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

comment on function public.commit_version_stability(uuid, uuid, uuid) is
  'Atomically marks the version the game rests on stable; promotes a proven repair candidate unless a newer version is current. Idempotent by version id.';
