-- GameForge AI: core schema (Phase 1)
--
-- Note: `auto_expose_new_tables` is unset in supabase/config.toml, so new
-- entities are NOT reachable through the Data API without explicit grants.
-- Grants to anon/authenticated/service_role live in the rls_and_policies
-- migration so privileges and policies are reviewed together.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.user_role as enum ('user', 'admin');
create type public.agent_type as enum (
  'spec_agent',
  'asset_mapper',
  'coder_agent',
  'debug_agent'
);
create type public.llm_provider as enum ('anthropic', 'openai', 'google', 'groq');
create type public.message_role as enum ('user', 'assistant', 'system');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role public.user_role not null default 'user',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  description text,
  genre text,
  public_slug text unique,
  is_public boolean not null default false,
  github_repo text,
  current_version_id uuid,
  last_stable_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index games_user_id_idx on public.games (user_id);

create table public.game_versions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  version_number integer not null,
  prompt text,
  spec jsonb,
  asset_manifest jsonb,
  source_code text,
  is_stable boolean not null default false,
  error_log text,
  created_at timestamptz not null default now(),
  constraint game_versions_game_id_version_number_key
    unique (game_id, version_number)
);

create index game_versions_game_id_version_number_idx
  on public.game_versions (game_id, version_number desc);

create index game_versions_stable_idx
  on public.game_versions (game_id)
  where is_stable;

-- Added after game_versions exists to keep the two version pointers valid.
-- Both are ON DELETE SET NULL so deleting a version cannot delete its game.
alter table public.games
  add constraint games_current_version_id_fkey
    foreign key (current_version_id)
    references public.game_versions (id) on delete set null,
  add constraint games_last_stable_version_id_fkey
    foreign key (last_stable_version_id)
    references public.game_versions (id) on delete set null;

-- Conversational transcript for the hot-patch chat, plus per-turn cost and
-- fallback telemetry retained from the earlier ad-hoc design.
create table public.game_messages (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.message_role not null,
  content text not null,
  agent_type public.agent_type,
  provider public.llm_provider,
  model_used text,
  tokens_used integer,
  execution_time_ms integer,
  is_fallback boolean not null default false,
  fallback_reason text,
  created_at timestamptz not null default now()
);

create index game_messages_game_id_created_at_idx
  on public.game_messages (game_id, created_at desc);

create table public.llm_configurations (
  id uuid primary key default gen_random_uuid(),
  agent_type public.agent_type not null,
  provider public.llm_provider not null,
  model_name text not null,
  api_key_override_encrypted text,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index llm_configurations_active_agent_type_idx
  on public.llm_configurations (agent_type)
  where is_active;

create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null default 'github',
  access_token_encrypted text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integrations_user_id_provider_key unique (user_id, provider)
);

-- ---------------------------------------------------------------------------
-- Functions & triggers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger games_set_updated_at
  before update on public.games
  for each row execute function public.set_updated_at();

create trigger llm_configurations_set_updated_at
  before update on public.llm_configurations
  for each row execute function public.set_updated_at();

create trigger integrations_set_updated_at
  before update on public.integrations
  for each row execute function public.set_updated_at();

-- Creates the profile row for every new auth user. SECURITY DEFINER is required
-- because the trigger fires on auth.users, which the API roles cannot write to.
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

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Allocates the next version number for a game. The advisory lock closes the
-- max()+1 race; the unique(game_id, version_number) constraint is the backstop.
create or replace function public.next_version_number(p_game_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  next_number integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_game_id::text, 0));

  select coalesce(max(game_versions.version_number), 0) + 1
    into next_number
    from public.game_versions
    where game_versions.game_id = p_game_id;

  return next_number;
end;
$$;
