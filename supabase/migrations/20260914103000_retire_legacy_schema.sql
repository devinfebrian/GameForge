-- GameForge AI: retire legacy prototype columns and tables (Phase 7 follow-up)
--
-- The older prototype's columns and tables were deliberately kept in place by
-- 20260911173544_reconcile_remote_games_schema.sql, whose header notes that
-- "retiring the legacy columns ... stays a deliberate later step once the older
-- writer is confirmed gone." The codebase now reads and writes only the declared
-- schema (public_slug / is_public / source_code / is_stable / ...), so the
-- legacy objects below are dead weight and are retired here.
--
-- Replayability: every statement is guarded with `if exists`, so this migration
-- is a no-op on a database built purely from this repository's migrations (the
-- legacy objects are never created there). On the hosted project they physically
-- exist, so they are dropped by name.
--
-- Data safety: values that had a declared-schema home were already copied across
-- by 20260911173544 (slug -> public_slug, is_published -> is_public,
-- code -> source_code). The remaining legacy-only values (status, plays_count,
-- thumbnail_url, change_summary, created_by_agent, is_fallback_used) and the
-- orphaned tables were backed up to CSV before this migration was applied.

-- ---------------------------------------------------------------------------
-- games
-- ---------------------------------------------------------------------------

-- Unique constraint + plain index on the prototype `slug` column.
alter table public.games
  drop constraint if exists games_slug_key;
drop index if exists public.idx_games_slug;

alter table public.games
  drop column if exists slug,
  drop column if exists status,
  drop column if exists is_published,
  drop column if exists plays_count,
  drop column if exists thumbnail_url;

-- ---------------------------------------------------------------------------
-- game_versions
-- ---------------------------------------------------------------------------

alter table public.game_versions
  drop constraint if exists game_versions_created_by_agent_check;

alter table public.game_versions
  drop column if exists code,
  drop column if exists change_summary,
  drop column if exists created_by_agent,
  drop column if exists is_fallback_used;

-- ---------------------------------------------------------------------------
-- Orphaned prototype tables (never declared by this repository's migrations).
-- ---------------------------------------------------------------------------

drop table if exists public.community_examples cascade;
drop table if exists public.prompt_logs cascade;
drop table if exists public.usage_logs cascade;
drop table if exists public.llm_configs cascade;
