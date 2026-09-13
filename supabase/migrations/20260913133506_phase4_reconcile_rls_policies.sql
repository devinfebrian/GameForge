-- GameForge AI: reconcile games / game_versions RLS with the declared policies
-- (Phase 4)
--
-- 20260911173544 flagged this as Phase 4's job. The live policies on these two
-- tables belong to the older prototype and key off its `is_published` column,
-- while every policy this repository declares keys off `is_public`. Phase 3 did
-- not care because every read and write used the service-role client, which
-- bypasses RLS; Phase 4 still reads through the service role, so this is not a
-- Studio dependency either. It is paid down now because RLS is the second layer
-- of defence behind the DAL, and a policy that answers a different question than
-- the schema is worse than no policy: it looks like protection.
--
-- Scope is only these two tables. profiles, game_messages, llm_configurations
-- and integrations were never prototyped against and are left alone.
--
-- Replayability: the policy names on the linked project are unknown, because the
-- two tables were replaced after the Phase 1 migration applied, which would have
-- taken the declared policies with them and left whatever the newer writer
-- created. Dropping by name is therefore not possible, so every policy on these
-- two tables is dropped dynamically and the declared set is recreated below.
-- The collect-then-drop shape is deliberate: running DDL while a FOR loop is
-- still scanning pg_policies would invalidate the portal underneath it.

do $$
declare
  v_names text[];
  v_tables text[];
  i integer;
begin
  select array_agg(policyname), array_agg(tablename)
    into v_names, v_tables
    from pg_policies
   where schemaname = 'public'
     and tablename in ('games', 'game_versions');

  if v_names is not null then
    for i in 1 .. array_length(v_names, 1) loop
      execute format(
        'drop policy if exists %I on public.%I',
        v_names[i],
        v_tables[i]
      );
    end loop;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- games
-- ---------------------------------------------------------------------------

alter table public.games enable row level security;

-- Table-level revoke first: a column-level carve-out is only possible out of a
-- table that was not granted wholesale.
revoke all on public.games from anon, authenticated;
grant select on public.games to anon;
grant select, insert, update, delete on public.games to authenticated;
grant all on public.games to service_role;

create policy "games_select_own"
  on public.games
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Public reads are what /play/[slug] will need in Phase 6.
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
-- and error_log stay server-side, which is why this is a column grant rather
-- than a table grant.
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
