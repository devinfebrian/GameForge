-- Consolidates the two permissive SELECT policies on public.games.
--
-- Advisor 0006 (multiple_permissive_policies) flagged that
-- `games_select_own` and `games_select_public` both applied to `authenticated`,
-- so every SELECT evaluated two policies. Semantics are unchanged:
--   authenticated -> own games OR published games
--   anon          -> published games only
--
-- Split by role instead of overlapping, so each role has exactly one SELECT
-- policy and the permissive policies no longer stack.

drop policy "games_select_public" on public.games;
drop policy "games_select_own" on public.games;

create policy "games_select_anon_public"
  on public.games
  for select
  to anon
  using (is_public);

create policy "games_select_authenticated"
  on public.games
  for select
  to authenticated
  using ((select auth.uid()) = user_id or is_public);
