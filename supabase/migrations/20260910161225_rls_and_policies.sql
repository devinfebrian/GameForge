-- GameForge AI: RLS policies and Data API grants (Phase 1)
--
-- Grants and RLS are independent controls: a grant decides whether a role can
-- touch the table at all, a policy decides which rows. Both must be correct.
--
-- Column-level privileges cannot be carved out of a table-level grant in
-- Postgres, so every table that exposes a subset of columns is revoked at table
-- level first and then re-granted column by column.

grant usage on schema public to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

-- Revoked at table level, then re-granted per column: `role` must never be
-- writable by a client, otherwise any signed-in user can self-promote to admin.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (email, avatar_url) on public.profiles to authenticated;
grant all on public.profiles to service_role;

create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- ---------------------------------------------------------------------------
-- games
-- ---------------------------------------------------------------------------

alter table public.games enable row level security;

revoke all on public.games from anon, authenticated;
grant select on public.games to anon;
grant select, insert, update, delete on public.games to authenticated;
grant all on public.games to service_role;

create policy "games_select_own"
  on public.games
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "games_select_public"
  on public.games
  for select
  to anon, authenticated
  using (is_public);

create policy "games_insert_own"
  on public.games
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- WITH CHECK stops a user reassigning user_id to somebody else.
create policy "games_update_own"
  on public.games
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "games_delete_own"
  on public.games
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- game_versions
-- ---------------------------------------------------------------------------

alter table public.game_versions enable row level security;

-- anon only needs what the public player renders. prompt, spec, asset_manifest
-- and error_log stay server-side.
revoke all on public.game_versions from anon, authenticated;
grant select (id, game_id, version_number, source_code, is_stable, created_at)
  on public.game_versions to anon;
grant select, insert, update, delete on public.game_versions to authenticated;
grant all on public.game_versions to service_role;

create policy "game_versions_select_public"
  on public.game_versions
  for select
  to anon
  using (
    exists (
      select 1
      from public.games
      where games.id = game_versions.game_id
        and games.is_public
    )
  );

create policy "game_versions_select_own"
  on public.game_versions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.games
      where games.id = game_versions.game_id
        and games.user_id = (select auth.uid())
    )
  );

create policy "game_versions_insert_own"
  on public.game_versions
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.games
      where games.id = game_versions.game_id
        and games.user_id = (select auth.uid())
    )
  );

create policy "game_versions_update_own"
  on public.game_versions
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.games
      where games.id = game_versions.game_id
        and games.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.games
      where games.id = game_versions.game_id
        and games.user_id = (select auth.uid())
    )
  );

create policy "game_versions_delete_own"
  on public.game_versions
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.games
      where games.id = game_versions.game_id
        and games.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- game_messages
-- ---------------------------------------------------------------------------

alter table public.game_messages enable row level security;

-- Transcripts are private: no anon access at all. Messages are append-only, so
-- no UPDATE grant either.
revoke all on public.game_messages from anon, authenticated;
grant select, insert, delete on public.game_messages to authenticated;
grant all on public.game_messages to service_role;

create policy "game_messages_select_own"
  on public.game_messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.games
      where games.id = game_messages.game_id
        and games.user_id = (select auth.uid())
    )
  );

create policy "game_messages_insert_own"
  on public.game_messages
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.games
      where games.id = game_messages.game_id
        and games.user_id = (select auth.uid())
    )
  );

create policy "game_messages_delete_own"
  on public.game_messages
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.games
      where games.id = game_messages.game_id
        and games.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- llm_configurations & integrations
-- ---------------------------------------------------------------------------

-- RLS enabled with zero policies and no client grants: deny-all for API roles.
-- Server code reaches these through the service-role client only.
alter table public.llm_configurations enable row level security;
alter table public.integrations enable row level security;

revoke all on public.llm_configurations from anon, authenticated;
revoke all on public.integrations from anon, authenticated;
grant all on public.llm_configurations to service_role;
grant all on public.integrations to service_role;

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

grant execute on function public.next_version_number(uuid) to authenticated, service_role;
