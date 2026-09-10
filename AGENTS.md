<!-- BEGIN:nextjs-agent-rules -->

## Ground rules (always)
- Be conservative, explicit, and boring.
- When unsure, ask; don’t guess.
- Make minimal, targeted changes; avoid refactors unless requested/necessary.
- Preserve existing structure, conventions, and tooling.
- Don’t add dependencies without strong justification.

## TypeScript
- Write strict, idiomatic TS; follow the repo’s tsconfig and lint rules.
- No `any` (use `unknown`, generics, or proper types).
- Prefer `interface` for public shapes; `type` for unions/helpers.
- Prefer immutability (`readonly`, `ReadonlyArray`) where practical.
- Narrow with type guards; avoid assertions and `!` except as a last resort.
- Prefer exhaustive handling (`never` checks) for unions.
- Treat caught errors as `unknown` and narrow before use.
**Component Architecture:** Server Components (`RSC`) by default. Mark Client Components explicitly with `'use client';` only when utilizing state, effects, or browser APIs.
* **Route Protection:** Next.js 16 replaced `middleware.ts` with `proxy.ts`. `proxy.ts` MUST do only two things: refresh the Supabase session via `supabase.auth.getClaims()` and perform optimistic redirects. It MUST NOT query the database or act as the authorization layer. Real enforcement lives in the Data Access Layer (`lib/dal.ts`: `requireUser()` / `requireAdmin()`), which every Route Handler, Server Action, and admin page MUST call. Never rely solely on client-side redirects, proxy matchers, or `getSession()` for authorization.
* **Naming Conventions:**
  * Components: PascalCase (e.g., `SandboxCanvas.tsx`, `PipelineStepper.tsx`).
  * Hooks: camelCase starting with `use` (e.g., `useSandboxBridge.ts`).
  * Utilities & Actions: camelCase (e.g., `generateGameSpec.ts`, `patchCode.ts`).
  * Database tables & columns: snake_case (e.g., `game_versions`, `source_code`).

## Node.js
- Target the repo’s supported Node LTS (don’t assume versions; check config/docs).
- Prefer `async/await`; never swallow rejections.
- Avoid module top-level side effects (I/O, network, reading env, global mutations) unless explicitly intended.
- Env vars: validate centrally; read at runtime (not import-time); don’t mutate in app code (tests only with scoped setup/teardown).
- Error handling: rethrow with context; preserve `cause` when available; don’t throw strings.
- Library code should not log; CLIs may log intentionally with consistent exit codes.

## Style, docs, and security
- Follow existing formatting/lint; keep functions small and readable.
- Prefer named exports.
- Update docs/comments when behavior changes (comments explain “why”, not “what”).
- Never log secrets; validate/sanitize external inputs (paths/URLs/user data).
- Dependency adds must be justified (need, alternatives, maintenance/license/security impact).

## MUST NOT
- Change public APIs or introduce breaking changes without explicit instruction.
- Perform stylistic rewrites or micro-optimizations.

<!-- END:nextjs-agent-rules -->
