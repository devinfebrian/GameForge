-- GameForge AI: reconcile profiles schema to the declared schema (Phase 7 follow-up)
--
-- The prototype stored several columns on profiles that the declared schema
-- (20260910161224_initial_schema.sql) never includes: display_name, plan,
-- daily_prompt_count, daily_prompt_limit, quality_preference, github_access_token,
-- subscription_tier. The codebase reads only id/email/role/avatar_url, so these
-- are dead weight (and github_access_token was a plaintext-token footgun).
--
-- Ordering matters: handle_new_user() is fixed BEFORE the columns are dropped, so
-- the auth signup trigger never references a missing column. The replacement body
-- matches the canonical form exactly (id/email only, on-conflict-do-nothing,
-- security definer with a locked search_path).
--
-- Replayability: guarded with `if exists` / `create or replace`, so this migration
-- is a no-op on a database built purely from this repository's migrations.

-- 1. Reconcile handle_new_user() to the canonical form (id/email only).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do nothing;

  return new;
end;
$$;

-- 2. Drop the prototype's single-column CHECK constraints, then the columns.
alter table public.profiles
  drop constraint if exists profiles_plan_check,
  drop constraint if exists profiles_quality_preference_check,
  drop constraint if exists profiles_subscription_tier_check;

alter table public.profiles
  drop column if exists display_name,
  drop column if exists plan,
  drop column if exists daily_prompt_count,
  drop column if exists daily_prompt_limit,
  drop column if exists quality_preference,
  drop column if exists github_access_token,
  drop column if exists subscription_tier;
