# GameForge AI

Turn natural-language prompts into interactive, production-ready 2D web games using multi-agent orchestration, Phaser 4, and an injected foundation engine.

---

## Features & Highlights

- **Multi-Agent Orchestration Pipeline:**
  - **Spec Agent:** Acts as the Lead Game Systems Architect. Translates user prompts into a rigorous Game PRD specifying exact physical constants (gravity, jump velocities, safe approach spacing), distinct per-level layouts, and guaranteed traversability (minimum 64px corridors).
  - **Asset Mapper:** Automatically matches entities and sound events with curated Kenney CC0 vector/pixel art and audio assets, or generates procedural sound synthesis presets (`jsfxr`).
  - **Coder Agent:** Produces concise, bug-free Phaser 4 scene code (typically under 200 lines) leveraging pre-injected engine primitives.
  - **Debug Agent:** Self-healing runtime diagnostic agent capable of catching, analyzing, and auto-repairing runtime errors in real time.
- **Pre-Injected Foundation Engine Layer (`window.GameForge`):**
  - **Platformer Controller:** Built-in coyote time (120ms), jump input buffering (120ms), variable jump height cutoff (`jumpCut = 0.4`), auto-run support, and clean `.reset(x, y)` to prevent physics teleportation/explosions.
  - **State Machine:** Formal run lifecycle management (`running`, `dead`, `won`) eliminating ad-hoc booleans and memory leaks.
  - **Unified Screen-Space HUD:** Automatically anchored (`scrollFactor: 0, depth: 100`) score, lives, wave counters, and result modals with single-press restart protection (`GameForge.input.justDown`).
  - **Game Feel & Juice:** Easy camera shakes, damage flashes, floating score text, and particle bursts.
  - **Delta Clamping:** Automatic frame delta capping (`Math.min(delta, 50)`) preventing physics tunneling when switching browser tabs.
- **Dual Asset Generation Modes:**
  - **Kenney CC0 Assets Mode:** Curated spritesheets and sound effects hosted on Supabase Storage CDN.
  - **Full LLM Procedural Mode:** Crash-proof procedural pixel art rendering via `makeTexturedSprite` and real-time synthesized sound effects with `jsfxr`.
- **Admin Panel & Auto-Deciding Fallback System (`/admin`):**
  - Primary LLM gateway (Anthropic / Claude Sonnet 3.5 / 3.7 / 5).
  - Multi-provider support: Groq Cloud (`llama-3.3-70b-versatile`), OpenAI (`gpt-4o-mini`), Google Gemini (`gemini-2.5-flash`).
  - One-click auto-failover routing that synchronizes across all four agents.
- **Isolated Sandbox & Standalone Exports:**
  - Game previews run inside an isolated iframe with a strict Content Security Policy (CSP).
  - One-click standalone zip download that runs offline without any external build step.

---

## Architecture Overview

```
User Prompt (Studio UI)
    │
    ▼  /api/generate  (SSE Stream)
┌───────────────────────────────────────────────────────────┐
│  1. Spec Agent     → Generates comprehensive Game PRD     │
│  2. Asset Mapper   → Maps Kenney assets / jsfxr presets   │
│  3. Coder Agent    → Generates clean Phaser 4 scene code  │
└───────────────────────────────────────────────────────────┘
    │                                          │
    ▼                                          ▼
 Supabase DB                           /preview/[versionId]
 game_versions row                     Opaque origin sandbox
 + game record                         window.GameForge injected
    │                                          │
    ▼                                          ▼
 /play/[slug] (Public URL)             Export to Standalone Zip

Patch Flow: User Chat → /api/patch → Coder Agent (Ground-truth patch mode)
Debug Flow: Runtime Error → /api/debug → Debug Agent (Self-healing auto repair)
```

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (v1.1+) or Node.js LTS (v20+)
- [Supabase CLI](https://supabase.com/docs/guides/cli)

### 1. Install Dependencies

```bash
bun install
```

> **Note:** The `postinstall` script automatically vendors the browser builds of Phaser 4 and jsfxr into `public/sandbox/vendor/`.

### 2. Configure Environment Variables

Copy `.env.example` to `.env.local` and configure your credentials:

```bash
cp .env.example .env.local
```

Key environment variables:

| Variable | Description |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase anon / publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (server-only) |
| `ADMIN_EMAILS` | Comma-separated emails promoted to `admin` on sign-in |
| `NEXT_PUBLIC_APP_ORIGIN` | App public origin (`http://localhost:5055` in dev) |
| `NEXT_PUBLIC_PREVIEW_ORIGIN` | Isolated preview origin (`http://127.0.0.1:5055` in dev) |
| `ANTHROPIC_API_KEY` | Gateway API key or token for primary generation |
| `ANTHROPIC_BASE_URL` | Base URL of the OpenAI-compatible gateway fronting Claude |
| `INTEGRATION_ENCRYPTION_KEY` | 32-byte Base64 key for encrypting provider keys at rest |

Generate an encryption key with:
```bash
openssl rand -base64 32
```

### 3. Database Migrations

Link your remote Supabase project and apply the schema migrations:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

### 4. Start the Development Server

```bash
bun run dev
```

The application will be accessible at [http://localhost:5055](http://localhost:5055).

---

## Verification & Testing

To run the complete automated test suite and static analysis:

```bash
# Run all 430+ unit and integration tests
bun test

# TypeScript strict type checking
bun run check-types

# ESLint code quality checks
bun run lint
```

### End-to-End Tests

Playwright tests exercise the end-to-end studio workflow, sandbox iframe, and CSP isolation:

```bash
bunx playwright install chromium webkit
bun run test:e2e
```

---

## Foundation Engine Library (`window.GameForge`)

The sandbox automatically injects the `GameForge` engine library before any scene script boots.

### Available Primitives

```javascript
// 1. Platformer Engine (Coyote time, Jump buffer, Jump cut, Auto-run)
this.platformer = GameForge.createPlatformer(this, this.player, {
  speed: 220,
  jumpForce: -380,
  jumpCut: 0.4,
  coyoteMs: 120,
  bufferMs: 120,
  autoRun: false,
});

// Update in scene update()
this.platformer.update(Math.min(delta, 50), {
  left: this.cursors.left.isDown || this.wasd.left.isDown,
  right: this.cursors.right.isDown || this.wasd.right.isDown,
  jumpDown: this.spaceKey.isDown,
  jumpJustDown: GameForge.input.justDown(this.spaceKey),
  jumpReleased: Phaser.Input.Keyboard.JustUp(this.spaceKey),
});

// Clean level reset (zeroes velocity & timers)
this.platformer.reset(spawnX, spawnY);

// 2. State Machine Lifecycle
this.stateMachine = GameForge.createStateMachine(this, {
  running: { enter: () => {}, update: (dt) => {} },
  dead: {
    enter: () => {
      this.physics.pause();
      this.hud.showResult("GAME OVER", "Score: " + this.score, () => this.scene.restart());
    }
  },
  won: {
    enter: () => {
      this.physics.pause();
      this.hud.showResult("VICTORY!", "All Levels Cleared!", () => this.scene.restart());
    }
  }
}, "running");

// 3. Screen-Space Anchored HUD
this.hud = GameForge.createHUD(this, {
  initialScore: 0,
  initialLives: 3,
  initialWave: 1,
  maxWaves: 3,
  controlsHint: "WASD / Arrows: Move | Space: Jump",
});

// 4. Game Feel & Juice
GameForge.juice.shake(this.cameras.main, 100, 0.01);
GameForge.juice.flash(this.player, 0xff3333, 120);
GameForge.juice.floatText(this, x, y, "+100", "#ffff00");
GameForge.juice.burst(this, x, y, "particle_key", 15);
```

---

## Assets Management

To synchronize or rebuild the Kenney asset catalog:

```bash
# 1. Download Kenney asset packs to assets-src/
bun run assets:fetch

# 2. Upload sprites and generate lib/assets/catalog.json
bun run assets:sync

# 3. Verify catalog integrity and CORS headers
bun run assets:check
```

---

## Security & Architecture Guidelines

- **Two-Tier Authorization:** Route protection uses Next.js 16's `proxy.ts` strictly for optimistic redirects and session refreshes. Real authorization lives in the Data Access Layer (`lib/dal.ts`), enforced on every Server Action and Route Handler.
- **Sandboxed Execution:** Generated scenes execute in an isolated origin (`/preview/[versionId]`) using `sandbox="allow-scripts"` with a strict Content Security Policy preventing storage access or network exfiltration.
- **Secrets at Rest:** Custom provider credentials entered through `/admin` are encrypted using AES-256-GCM before database storage.
