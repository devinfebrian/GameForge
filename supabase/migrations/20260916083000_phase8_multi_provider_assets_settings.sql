-- GameForge AI: Phase 8 — global asset mode, token-limit mode, and a second
-- (fallback) LLM provider per agent.
--
-- Three concerns, all additive and none touching the existing working path:
--
--   1. app_settings — a tiny key/value store for global, admin-only switches.
--      asset_mode:       'kenney' (map Kenney sprites, procedural fallback) vs
--                        'llm' (skip the catalog; the coder draws every entity
--                        procedurally via makeTexturedSprite).
--      token_limit_mode: 'limited' (the existing daily budget + burst limiter)
--                        vs 'limitless' (admin-only testing escape hatch).
--
--   2. llm_providers — one row per gateway. 'anthropic' is seeded with NULL
--      base_url/key to mean "use the env credential / existing gateway
--      override"; 'groq' (and later 'openrouter') carry a base_url and an
--      encrypted key the admin stores through the panel.
--
--   3. llm_configurations.fallback_* — each agent keeps its single active
--      primary row and may additionally name a fallback provider + model. The
--      one-active-per-agent invariant is untouched, so the existing
--      loadAgentModels continues to work unchanged until the code that reads
--      the fallback ships.

-- ---------------------------------------------------------------------------
-- 1. app_settings
-- ---------------------------------------------------------------------------

create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- Same access model as llm_configurations and user_token_usage: RLS on with zero
-- policies and no client grants, so only the service-role client reaches it.
alter table public.app_settings enable row level security;

revoke all on public.app_settings from anon, authenticated;
grant all on public.app_settings to service_role;

insert into public.app_settings (key, value) values
  ('asset_mode', 'kenney'),
  ('token_limit_mode', 'limited')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. llm_providers
-- ---------------------------------------------------------------------------

create table if not exists public.llm_providers (
  id uuid primary key default gen_random_uuid(),
  provider public.llm_provider not null unique,
  -- NULL means "read this provider's credential from the environment" —
  -- base_url from ANTHROPIC_BASE_URL, key from the existing gateway override
  -- or ANTHROPIC_API_KEY. A non-NULL row carries its own gateway (e.g. Groq).
  base_url text,
  api_key_encrypted text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.llm_providers enable row level security;

revoke all on public.llm_providers from anon, authenticated;
grant all on public.llm_providers to service_role;

-- anthropic is the env-backed default; the admin adds 'groq' (and later
-- 'openrouter') with a base_url and encrypted key through the panel.
insert into public.llm_providers (provider, base_url, api_key_encrypted, is_active)
values ('anthropic', null, null, true)
on conflict (provider) do nothing;

-- ---------------------------------------------------------------------------
-- 3. llm_configurations fallback columns
-- ---------------------------------------------------------------------------

alter table public.llm_configurations
  add column if not exists fallback_provider public.llm_provider,
  add column if not exists fallback_model_name text;

-- A fallback names a provider and a model together, or not at all.
alter table public.llm_configurations
  drop constraint if exists llm_configurations_fallback_pair_check;

alter table public.llm_configurations
  add constraint llm_configurations_fallback_pair_check
  check (
    (fallback_provider is null and fallback_model_name is null)
    or
    (fallback_provider is not null and fallback_model_name is not null)
  );

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------

comment on table public.app_settings is
  'Global, admin-only switches (asset_mode, token_limit_mode). Service-role only.';

comment on table public.llm_providers is
  'One row per LLM gateway. NULL base_url/key means the env credential / gateway override for that provider.';

comment on column public.llm_configurations.fallback_provider is
  'Optional fallback gateway for this agent, tried after the primary fails on a retryable error.';

comment on column public.llm_configurations.fallback_model_name is
  'Model id on the fallback provider. Set iff fallback_provider is set.';
