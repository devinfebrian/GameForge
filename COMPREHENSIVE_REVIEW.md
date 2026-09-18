# GameForge AI — Full Project Review
**Date:** 2026-09-17
**Scope:** Security · Architecture · Agent Pipeline · Improvements · Test Scenarios

---

## 1. Architecture Overview

```
User Prompt (Studio UI)
    │
    ▼  /api/generate  (SSE stream)
┌─────────────────────────────────────────────────────┐
│  Spec Agent  →  Asset Mapper  →  Coder Agent        │
│  (JSON GameSpec)   (Kenney CC0)   (Phaser 4 JS)    │
└─────────────────────────────────────────────────────┘
    │                                          │
    ▼                                          ▼
 Supabase DB                           /sandbox/ (iframe)
 game_versions row                    opaque origin
 + game record                        sandbox="allow-scripts"
    │
    ▼
 /play/[slug]  (public URL)

Patch flow: User chat → /api/patch → Coder Agent (patch mode)
Debug flow: Runtime error → /api/debug → Debug Agent (max 3 retries)
```

**Tech stack:**
- Next.js 16 App Router (TypeScript, strict mode)
- Phaser 4.2.1 (game renderer, in sandboxed iframe)
- Supabase (Auth + Postgres + Storage CDN)
- SSE streaming (no WebSockets, no polling)
- AES-256-GCM for stored credentials

---

## 2. Security Analysis

### ✅ Well-Done

| Area | Implementation |
|------|---------------|
| **Sandbox isolation** | `sandbox="allow-scripts"` (no `allow-same-origin`), opaque origin, `contentWindow` equality check on postMessage |
| **API key storage** | AES-256-GCM encrypted at rest, env-var default, conflict detection across rows |
| **Auth** | Supabase session + RLS, `requireUser` / `requireAdmin` on all protected routes |
| **CSP headers** | Built per-request from `getPublicEnv()`, explicit origins only (no `'self'`), `frame-ancestors` locked |
| **CORS on assets** | Storage bucket serves `Access-Control-Allow-Origin: *` for opaque-origin iframe |
| **Message framing** | Zod schema validation on all postMessage payloads, sender identity check |
| **Error codes** | Closed enum (`GenerationErrorCode`), never leaked raw provider errors to client |
| **Rate limiting** | Burst cap (runs/min) + daily token budget, admin exempt, `limitless` mode |
| **No hardcoded credentials** | All secrets from env vars or encrypted DB rows |
| **Prompt injection** | `provider_content_blocked` code for gateway WAF blocks, reported distinctly |

### ⚠️ Areas to Improve

**1. No middleware.ts for `/api/*` route protection**
```
❌ app/api/generate/route.ts — no auth check before running expensive LLM calls
✅ getCurrentProfile() is called inside POST — works, but a middleware would
   block unauthenticated requests BEFORE any Supabase connection is made
```
Fix: Add `middleware.ts` at `app/` level that redirects unauthenticated users from `/api/*` before they hit route handlers.

**2. No prompt input sanitization**
```
❌ User prompt goes straight into LLM prompt with no length/content check
❌ Max 2000 chars enforced at schema level, but no XSS/script filtering
   for cases where generated code surfaces in the UI
```
The generated code itself is sandboxed — this is low risk — but the prompt text is stored in `game_versions.prompt` and displayed in the UI. Stored XSS is possible if a malicious prompt is saved and rendered without escaping.

**3. No CSRF protection on PATCH/POST**
```
❌ No CSRF token on /api/games/[gameId] PATCH (publish toggle)
❌ Supabase session cookie is vulnerable to CSRF on state-changing operations
```
Fix: Use `SameSite=Lax` cookie (Supabase handles this by default) or add a custom CSRF header check.

**4. `/api/generate` has no request timeout at route level**
```
❌ maxDuration=300s is set, but the pre-stream auth + quota + bootstrap
   happens before the SSE response starts, consuming part of that budget
```
Minor: The pipeline is already designed for long runs. This is a documentation gap.

**5. API key override conflict is warning-only**
```
⚠️  Gateway key rows disagree → banner in admin UI but no hard block
❌  A conflicting key means some agents use key A, some use key B
```
This is already flagged in the admin UI. Low risk if admin acts on warnings.

**6. No input rate limiting (IP-level)**
```
❌  Rate limiting is per-user (burst + daily budget) but not per-IP
❌  An attacker with many accounts could bypass per-user limits
```
Fix: Add Upstash Redis or Cloudflare Rate Limiting at the edge.

---

## 3. Agent Pipeline Flow (Deep Dive)

### Stage 1: Spec Agent
- **Input:** User prompt + catalog context + system prompt
- **Output:** `GameSpec` (JSON, validated by Zod)
- **Model:** From `llm_configurations` (spec agent row)
- **Key constraints injected:**
  - Fixed 480×320 canvas
  - Phaser 4 Arcade Physics only
  - `difficulty`, `feel[]`, min 3 entities (player + 2 others)
  - Multi-level progression (2–3 distinct levels)
  - Dual controls (Arrow keys AND WASD)
  - Guaranteed traversability, corner hitbox tuning

### Stage 2: Asset Mapper (Kenney CC0)
- **Input:** Validated `GameSpec` + Kenney catalog JSON
- **Output:** `AssetMapping` (sprite assignments + sound presets)
- **Model:** From `llm_configurations` (asset_mapper row)
- **Fallback:** If no match found → all entities get `null` → Coder draws procedurally
- **Token cost:** Zero for Kenney (deterministic keyword matching)

### Stage 3: Coder Agent
- **Input:** GameSpec + ResolvedManifest + Phaser 4 skills (compiled from `skills.sh`)
- **Output:** `class MainScene extends Phaser.Scene` (~150–250 lines)
- **Model:** From `llm_configurations` (coder row)
- **Anti-hallucination:**
  - Must use `window.__MAIN_SCENE__ = MainScene`
  - Must use manifest texture keys exactly as assigned
  - Max 4,096 output tokens
  - PRD structure: Physics → Level Layout → HUD → Win/Loss

### Stage 4: Debug Agent (on-demand)
- **Trigger:** `bridge.lastError !== null` (postMessage from sandbox)
- **Input:** Failing source + error + spec
- **Output:** Fixed `MainScene` source
- **Retry cap:** `DEBUG_ATTEMPT_LIMIT = 3` (enforced in `lib/pipeline/debug.ts`)
- **Auto-trigger:** Not yet wired — needs "Fix Error" button in UI

### Persistence
- One DB write at terminal state only
- Success → `is_stable = false`, `last_stable_version_id` NOT set yet (set on sandbox probation pass)
- Coder failure → `is_stable = false`, `error_log` populated
- Spec failure → nothing persisted
- Abort → nothing persisted, but already-billed tokens charged

---

## 4. Recommended Improvements

### 🔴 High Priority

**1. Wire "Fix Error" button to Debug Agent** (P1-2 — in progress)
Currently the diagnostic banner shows the error but the Fix button is not connected.

**2. Add middleware.ts for API route protection**
```ts
// middleware.ts
export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const session = await getSession(); // lightweight check
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
}
```
Saves Supabase connection on every unauthenticated API hit.

**3. Escape prompt text before storing/displaying**
`game_versions.prompt` is user-controlled text rendered in the UI. Use a sanitization library or at minimum HTML-encode before displaying.

### 🟡 Medium Priority

**4. Provider fallback not wired to UI warning**
`provider_exhausted` warning fires in the pipeline but the Studio UI doesn't display it. A toast notification should appear when the system auto-switches providers.

**5. Quality tier selector wired to model routing** (P1-1 — in progress)
Currently `quality` is accepted by the API but has no effect. The architecture supports per-agent model selection in `llm_configurations` — the missing piece is reading a `quality` column or mapping tiers to model IDs.

**6. No sandbox health check on game publish**
A game is published (`isPublic = true`) even if its source crashes on load. The `bootTimedOut` state is detected but not blocking. Consider requiring a `SCENE_READY` event before enabling publish.

**7. Token billing has no refund path**
A client disconnect mid-stream is charged for tokens already spent. This is documented but could frustrate users on flaky connections. Consider a grace period or explicit abort-credit.

### 🟢 Low Priority

**8. No multi-scene support (Level 1 → Level 2)**
Current architecture supports only one `MainScene`. Games have `this.level` state but it's all in one scene. True multi-scene would need `scene.start("Level2Scene")` — possible but complex.

**9. No game thumbnail/OG image for sharing**
`/play/[slug]` has no og:image. The schema comment explicitly defers it, but sharing a link on Discord/Twitter without a preview image hurts conversion.

**10. No session replay for failed runs**
A failed generation that spent tokens is not recoverable by the user. A "retry failed run" feature that replays the same prompt would save credit.

---

## 5. Test Scenarios

### 5.1 Happy Path — New Game Generation
```
1.  Sign up / sign in
2.  Click "New Game" → /studio/new
3.  Type: "A brick-breaker with neon glow effects and power-ups"
4.  Submit → SSE stream starts
5.  Watch 3 stages: [Spec ✓] → [Assets ✓] → [Code ✓]
6.  Game boots in sandbox → "Live" status
7.  Click Publish → public URL generated
8.  Open /play/[slug] in incognito → game playable
```

**Expected:** Game loads, paddle moves with mouse, ball bounces, bricks break.

### 5.2 Hot-Patch — Change Game Mechanics
```
1.  From a running game in Studio
2.  Type: "Make the enemies twice as fast and add a lives counter"
3.  Submit → PATCH flow (bypasses Spec + Asset Mapper)
4.  Watch: [Patch ✓] in stage indicator
5.  Game reloads with new behavior
```

**Expected:** Enemies faster, HUD shows lives.

### 5.3 Self-Healing — Runtime Error Recovery
```
1.  Game is running (Live)
2.  Inject error: manually trigger a code scenario that crashes Phaser
    OR: wait for natural crash (e.g., bad collision callback)
3.  Sandbox posts RUNTIME_ERROR to bridge
4.  Status shows "error" (red dot)
5.  Banner: "[update] Cannot read property 'x' of undefined"
6.  Click "Fix Error" button
7.  Debug agent runs (max 3 attempts)
8.  Game reboots with fix applied
```

**Expected:** After fix, game runs without the same error.

### 5.4 Asset Mapper Degradation
```
1.  Generate a game with unusual entity: "a game about collecting space gems"
2.  Kenney has no "space gem" sprite → mapper returns null
3.  Pipeline continues with warning: "mapper_degraded"
4.  Coder draws procedural pixel-art gem
5.  Game works with placeholder art
```

**Expected:** Game runs; gem appears as generated pixel art, not a Kenney sprite.

### 5.5 Provider Fallback (Simulated)
```
1.  Configure a second provider (e.g., Gemini via admin panel)
2.  Primary API returns 429 (rate limited)
3.  Pipeline catches error, switches to fallback
4.  Amber toast: "Notice: Primary model credit limit reached.
    Smoothly transitioned to Gemini 2.0 Flash"
5.  Generation completes on fallback provider
```

**Expected:** Game still generates successfully despite primary failure.

### 5.6 Spec Validation Rejection
```
1.  Type a prompt that produces a bad spec: "make a game"
2.  Model returns minimal spec (no mechanics, no entities)
3.  Zod validation fails on GameSpec schema
4.  Pipeline stops: "spec_failed"
5.  User sees: "The game design could not be generated.
    Try being more specific about mechanics and goals."
6.  No DB write, no tokens wasted beyond the spec call
```

**Expected:** Clean error message, no crash, no partial game saved.

### 5.7 Unauthorized Access
```
1.  Copy a /play/[slug] URL from a published game
2.  Open in browser → game playable (public)
3.  Try to access /studio/[gameId] for someone else's game
    → "No such game for this user" (not "not found", to prevent enumeration)
4.  Try to POST /api/games/[otherId] with publish toggle
    → 401 unauthorized
```

**Expected:** Proper authorization at every endpoint.

### 5.8 Export — HTML Standalone
```
1.  Complete a game in Studio
2.  Click Export menu → "Download HTML"
3.  Browser downloads a single .html file
4.  Open file locally (file://) → game runs without server
5.  All assets embedded (base64) or CDN-linked
```

**Expected:** Game playable offline, no external dependencies.

### 5.9 Export — ZIP Bundle
```
1.  Complete a game in Studio
2.  Click Export menu → "Download ZIP"
3.  Browser downloads .zip containing:
    - index.html (boot page)
    - /assets/ (sprites if local)
    - /sounds/ (audio)
4.  Host the extracted folder on any static server
5.  Game runs
```

**Expected:** Self-contained package, deployable anywhere.

### 5.10 Rate Limit / Quota Exhaustion
```
1.  Free user, daily budget nearly exhausted
2.  Try to generate a new game
3.  Pre-stream check: quota exceeded
4.  User sees: "Daily token limit reached. Come back tomorrow
    or upgrade to Creator for 100 generations/day."
5.  Admin user with limitless mode → same flow → succeeds
```

**Expected:** Clear message, no partial generation charged.

### 5.11 Concurrent Run Prevention
```
1.  Start a generation (takes ~20s)
2.  While still running, submit another prompt
3.  Second request: 409 Conflict
    "A generation is already running. Wait for it to finish."
4.  First run completes successfully
5.  Second request now succeeds
```

**Expected:** No overlapping runs per user, race-condition free.

### 5.12 Boot Timeout
```
1.  Generate a game with a bug in preload()
2.  Scene never fires SCENE_READY within 10 seconds
3.  Bridge sets bootTimedOut = true
4.  UI shows: "The game did not start within ten seconds."
5.  Fix Error button appears
6.  User clicks Fix → debug cycle begins
```

**Expected:** Graceful degradation, actionable feedback.

---

## 6. Current Test Coverage Summary

| Area | Tests | Status |
|------|-------|--------|
| `lib/agents/spec/` schema + prompt | 17 | ✅ Pass |
| `lib/agents/coder/` prompt + skills | ~30 | ✅ Pass |
| `lib/agents/asset-mapper/` | ~12 | ✅ Pass |
| `lib/agents/debug/` | ~5 | ✅ Pass |
| `lib/pipeline/generate.ts` | ~18 | ✅ Pass |
| `lib/pipeline/patch.ts` | ~10 | ✅ Pass |
| `lib/pipeline/debug.ts` | ~8 | ✅ Pass |
| `lib/export/` (HTML + ZIP) | 57 | ✅ Pass |
| `lib/pipeline/` SSE + events | ~15 | ✅ Pass |
| **Total** | **~175** | **All ✅** |

**Missing test coverage:**
- No E2E/Playwright tests for the full user flow (sign up → generate → publish)
- No integration tests for the sandbox postMessage protocol
- No tests for `/api/games/[gameId]` PATCH endpoint (publish toggle)
- No tests for the quota store behavior under edge conditions
