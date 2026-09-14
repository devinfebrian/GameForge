# GameForge AI

Turn natural-language prompts into interactive 2D web games.

## Local setup

1. Install dependencies:

   ```bash
   bun install
   ```

2. Copy `.env.example` to `.env.local` and fill it in. Values come from the
   Supabase dashboard under **Project Settings > API**:

   | Variable | Notes |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable / anon key, safe for the browser |
   | `SUPABASE_SERVICE_ROLE_KEY` | Server-only. Never expose to the client |
   | `ADMIN_EMAILS` | Comma-separated. These accounts get `role = 'admin'` on sign-in |
   | `NEXT_PUBLIC_APP_ORIGIN` | `http://localhost:3000` in dev |

3. Link the Supabase project and apply the migrations:

   ```bash
   supabase link --project-ref <project-ref>
   supabase db push
   ```

4. Start the dev server:

   ```bash
   bun run dev
   ```

## Checks

```bash
bun run check-types   # next typegen + tsc --noEmit
bun run lint
bun test
```

`bun run build` is run by the deploy platform, not locally (see [`AGENTS.md`](./AGENTS.md)).

### End-to-end tests

```bash
bunx playwright install chromium webkit   # once
bun run test:e2e
```

The suite runs against **its own Supabase project**, configured in a gitignored
`.env.e2e.local` (copy [`.env.e2e.example`](./.env.e2e.example)). It must not point
at the linked project: it writes real games and versions. When the file is absent
the suite starts no server and every spec skips, rather than falling back to
`.env.local`.

The dev server runs with `GENERATION_FAKE=1`, which swaps the gateway for a
deterministic in-process fake in `/api/generate` and `/api/patch`. That is why a
run needs no model credentials, spends no tokens, and is reproducible. The flag
is refused outright when `NODE_ENV` is `production`, and the fake itself is only
reachable from those two route handlers.

Playwright covers Chromium and WebKit. WebKit is what exercises the sandbox's
opaque-origin CSP, which cannot be reproduced in Chromium and cannot be tested on
Windows any other way. Not verifiable headlessly, and therefore still manual:
audible mute, actual fullscreen, and audio output.


## Preview and assets

`bun install` copies the browser builds of Phaser and jsfxr into
`public/sandbox/vendor/` via `postinstall`. That directory is generated and is not
committed. Previews are served as isolated documents from a dedicated origin
(`NEXT_PUBLIC_PREVIEW_ORIGIN`, e.g. `http://127.0.0.1:3000` in local development)
at `/preview/[versionId]`, protected by their own CSP header emitted from `next.config.ts`.

Phaser is pinned to `~3.90.0` on purpose: npm's `latest` tag is 4.x, and Phaser 4 is
not a drop-in replacement. `scripts/copy-vendor.ts` refuses to vendor a 4.x build.

Sprites are deliberately not committed. To rebuild the asset bucket from scratch:

1. `bun run assets:fetch` downloads the Kenney CC0 packs into `assets-src/`
   (gitignored). Kenney's zip URLs embed a per-release hash, so the script scrapes each
   asset page rather than hardcoding links.
2. `lib/assets/curation.json` lists which sprites to publish and the object path each
   one gets.
3. `bun run assets:sync` uploads them and regenerates `lib/assets/catalog.json`.
4. `bun run assets:check` verifies catalog drift and that every object is served with
   `Access-Control-Allow-Origin: *`.

The bucket is declared in `supabase/config.toml` under `[storage.buckets."game-assets"]`,
but that declaration only applies to local development (`supabase start`) and Supabase
branching. It is **not** applied to the linked project: `supabase config push` neither
creates nor removes buckets, and there is no `storage bucket create` command. Verified
against CLI 2.117.0 — with the declaration present and the bucket absent, the push
reported "Remote Storage config is up to date" and created nothing. `bun run assets:sync`
therefore creates the bucket itself with the service-role key, mirroring the declared
properties.

Be aware that `supabase config push` sends the whole `config.toml`, `[auth]` included.

## Architecture

See [`gameforge_architecture_plan.md`](./gameforge_architecture_plan.md) for the
full system design, and [`AGENTS.md`](./AGENTS.md) for implementation rules.

Authorization is two-tier: `proxy.ts` only refreshes the Supabase session and
performs optimistic redirects, while real enforcement lives in the Data Access
Layer (`lib/dal.ts`), which every Route Handler and Server Action must call.
