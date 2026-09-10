-- Reconciles the ad-hoc schema that already existed on the hosted project.
--
-- Those objects were created outside the migration system (the remote had no
-- migration history), so they are removed by name here to make the baseline
-- reproducible. Every statement is `if exists ... cascade`, so this migration is
-- a no-op on any database created purely from migrations.
--
-- Removed legacy objects, all empty at the time of removal (0 rows, 0 auth
-- users, so nothing was lost):
--   tables    : profiles, games, game_versions, game_prompts
--   functions : handle_new_user, handle_updated_at
--   trigger   : on_auth_user_created on auth.users
--
-- The old design differed from the architecture plan in naming (slug /
-- is_published / active_version_id / game_spec), role vocabulary ('creator'),
-- quota location, and it stored a plaintext GitHub token on profiles. The
-- initial_schema migration that follows establishes the intended design.

-- The legacy triggers set_profiles_updated_at / set_games_updated_at depend on
-- handle_updated_at(), so the function is dropped with cascade. A guarded
-- `drop trigger ... on public.profiles` is deliberately avoided: it would fail on
-- a fresh database where the table does not exist yet, breaking the no-op
-- guarantee. Every object here is being removed anyway.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.handle_updated_at() cascade;

drop table if exists public.game_prompts cascade;
drop table if exists public.game_versions cascade;
drop table if exists public.games cascade;
drop table if exists public.profiles cascade;
