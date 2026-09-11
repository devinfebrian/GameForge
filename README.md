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

## Sandbox and assets

`bun install` copies the browser builds of Phaser and jsfxr into
`public/sandbox/vendor/` via `postinstall`. That directory is generated and is not
committed. The sandbox frame is a plain static document at `/sandbox/index.html`,
embedded with `sandbox="allow-scripts"` and no `allow-same-origin` — omitting the
latter is what gives it an opaque origin. Its CSP is sent as a header from
`next.config.ts`.

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
   `Access-Control-Allow-Origin: *` — required, because the frame requests assets from
   an opaque origin.

The bucket is declared in `supabase/config.toml` under `[storage.buckets."game-assets"]`,
but that declaration only applies to local development (`supabase start`) and Supabase
branching. It is **not** applied to the linked project: `supabase config push` neither
creates nor removes buckets, and there is no `storage bucket create` command. Verified
against CLI 2.117.0 — with the declaration present and the bucket absent, the push
reported "Remote Storage config is up to date" and created nothing. `bun run assets:sync`
therefore creates the bucket itself with the service-role key, mirroring the declared
properties.

Be aware that `supabase config push` sends the whole `config.toml`, `[auth]` included.

`/dev/sandbox` is a development-only harness for the postMessage bridge.

## Architecture

See [`gameforge_architecture_plan.md`](./gameforge_architecture_plan.md) for the
full system design, and [`AGENTS.md`](./AGENTS.md) for implementation rules.

Authorization is two-tier: `proxy.ts` only refreshes the Supabase session and
performs optimistic redirects, while real enforcement lives in the Data Access
Layer (`lib/dal.ts`), which every Route Handler and Server Action must call.
