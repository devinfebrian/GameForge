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
bun run build
```

## Architecture

See [`gameforge_architecture_plan.md`](./gameforge_architecture_plan.md) for the
full system design, and [`AGENTS.md`](./AGENTS.md) for implementation rules.

Authorization is two-tier: `proxy.ts` only refreshes the Supabase session and
performs optimistic redirects, while real enforcement lives in the Data Access
Layer (`lib/dal.ts`), which every Route Handler and Server Action must call.
