-- GameForge AI: reconcile the remote games / game_versions tables with the schema
-- this repository declares (Phase 3 follow-up)
--
-- The linked project carries an older prototype's version of these two tables:
--
--   games          slug!, status, is_published, plays_count!, thumbnail_url
--   game_versions  code!, change_summary, created_by_agent, is_fallback_used
--
-- where this repo declares public_slug / is_public / github_repo /
-- current_version_id / last_stable_version_id and source_code / is_stable /
-- error_log. The legacy tables hold four rows created as recently as today, so
-- something may still be writing the old column names.
--
-- This migration is strictly additive: it ADDs the missing columns and relaxes
-- the two NOT NULLs that block a declared-schema insert. It renames nothing and
-- drops nothing. Renaming slug -> public_slug and code -> source_code, and
-- retiring the legacy columns, stays a deliberate later step once the older
-- writer is confirmed gone.
--
-- persist_generation cannot succeed without it: it names source_code, is_stable,
-- error_log and current_version_id, none of which exist yet, and it omits slug,
-- which is currently NOT NULL with no default.
--
-- Replayability: `slug`, `is_published` and `code` exist only on the linked
-- prototype. A database built from this repository's own migrations already
-- declares public_slug / is_public / source_code and has no such columns, so
-- every reference to them below sits behind an information_schema guard. Without
-- that, the unguarded updates and ALTERs would abort `supabase db reset` and CI.

-- ---------------------------------------------------------------------------
-- game_versions
-- ---------------------------------------------------------------------------
-- Done before games so the version pointers below have rows to reference.

alter table public.game_versions
  add column if not exists source_code text,
  add column if not exists is_stable boolean not null default false,
  add column if not exists error_log text;

-- Carry the prototype's scene text across rather than leaving it stranded in a
-- column this app never reads. The rename itself stays a later step.
do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'game_versions'
       and column_name = 'code'
  ) then
    update public.game_versions
       set source_code = code
     where source_code is null
       and code is not null;

    -- Our inserts write source_code and leave code unset.
    alter table public.game_versions
      alter column code drop not null;
  end if;
end;
$$;

-- Version numbers come from next_version_number's advisory lock, but the
-- uniqueness backstop declared in the initial schema is missing here and belongs
-- on it. Verified safe: zero duplicate (game_id, version_number) pairs exist.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.game_versions'::regclass
       and conname = 'game_versions_game_id_version_number_key'
  ) then
    alter table public.game_versions
      add constraint game_versions_game_id_version_number_key
      unique (game_id, version_number);
  end if;
end;
$$;

create index if not exists game_versions_game_id_version_number_idx
  on public.game_versions (game_id, version_number desc);

-- Partial index matching the "which versions are usable" lookup that the Studio
-- and the Phase 5 rollback path both make.
create index if not exists game_versions_stable_idx
  on public.game_versions (game_id)
  where is_stable;

-- ---------------------------------------------------------------------------
-- games
-- ---------------------------------------------------------------------------

alter table public.games
  add column if not exists public_slug text,
  add column if not exists is_public boolean not null default false,
  add column if not exists github_repo text,
  add column if not exists current_version_id uuid,
  add column if not exists last_stable_version_id uuid;

-- The legacy slug is already in the <slugified-title>-<suffix> form this repo
-- documents, so it is copied rather than regenerated: inventing new slugs would
-- break any link already pointing at a published game. Both legacy columns are
-- absent on a database migrated from this repository, where the block is a no-op.
do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'games'
       and column_name = 'slug'
  ) then
    update public.games
       set public_slug = slug
     where public_slug is null;

    -- A new game gets its public_slug when it is published (Phase 6), not when
    -- it is created, so the legacy NOT NULL has to go for generation to insert
    -- at all.
    alter table public.games
      alter column slug drop not null;
  end if;

  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'games'
       and column_name = 'is_published'
  ) then
    update public.games
       set is_public = coalesce(is_published, false);
  end if;
end;
$$;

create unique index if not exists games_public_slug_key
  on public.games (public_slug)
  where public_slug is not null;

-- Both version pointers are added after game_versions exists, and SET NULL rather
-- than CASCADE so deleting a version can never delete its game.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.games'::regclass
       and conname = 'games_current_version_id_fkey'
  ) then
    alter table public.games
      add constraint games_current_version_id_fkey
      foreign key (current_version_id)
      references public.game_versions (id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.games'::regclass
       and conname = 'games_last_stable_version_id_fkey'
  ) then
    alter table public.games
      add constraint games_last_stable_version_id_fkey
      foreign key (last_stable_version_id)
      references public.game_versions (id) on delete set null;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Deliberately not touched
-- ---------------------------------------------------------------------------
-- RLS policies and grants stay as they are. Every Phase 3 read and write goes
-- through the service-role client, which bypasses RLS entirely, so the live
-- prototype-scoped policies are not on this feature's path. Replacing them with
-- the declared is_public-based set is Phase 4's job, done alongside the UI that
-- will actually depend on them.
--
-- games.plays_count is NOT NULL but already defaults to 0, so a declared-schema
-- insert reaches it without naming it and needs no change.
--
-- Legacy columns (status, is_published, plays_count, thumbnail_url,
-- change_summary, created_by_agent, is_fallback_used) are kept untouched so an
-- older writer cannot be broken by this migration.
