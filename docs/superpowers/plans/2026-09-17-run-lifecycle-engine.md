# Run Execution Lifecycle Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse fragmented run admission, concurrency leasing, quota billing, and streaming error recovery from `/api/generate` and `/api/patch` into a unified, deep, and in-process testable `RunLifecycleEngine` module.

**Architecture:** A two-layer functional module separating the protocol-agnostic lifecycle engine (`lib/pipeline/lifecycle.ts`) from the Next.js App Router Web Request/Response adapter (`lib/pipeline/http-adapter.ts`). The core engine guarantees that token billing and concurrency lease release occur inside a strict `finally` block, while the adapter handles DAL authentication, body parsing, pre-stream HTTP error mapping, and SSE stream creation.

**Tech Stack:** TypeScript (strict mode), Next.js 16 App Router (Route Handlers, Web Streams), Zod, Bun test runner.

**Spec:** [`docs/superpowers/specs/2026-09-17-run-lifecycle-engine-design.md`](file:///C:/Users/USER/Portofolio/GameForge/docs/superpowers/specs/2026-09-17-run-lifecycle-engine-design.md)

## Global Constraints

- Follow the repo's ground rules in [`AGENTS.md`](file:///C:/Users/USER/Portofolio/GameForge/AGENTS.md).
- Strict TypeScript: no `any` (use `unknown` or proper types), narrow with type guards, treat caught errors as `unknown`.
- Pure functions and immutable interfaces (`readonly`, `ReadonlyArray`).
- Do NOT build locally (`bun run build` is forbidden on local machine; use `bun run check-types` and `bun test`).
- Preserve all existing SSE frame contracts (`stage.started`, `stage.completed`, `error`, `run.completed`).
- Do not touch `/api/debug/route.ts` in this plan.

---

## File Structure Map

| File | Purpose | Responsibility |
| --- | --- | --- |
| `lib/pipeline/lifecycle.ts` (Create) | Core lifecycle engine | Protocol-agnostic admission checks, leasing, strategy execution, quota charging, and lease release. |
| `lib/pipeline/lifecycle.test.ts` (Create) | Lifecycle unit tests | In-process testing of quota refusals, concurrency locks, token billing, and abort settlement. |
| `lib/pipeline/http-adapter.ts` (Create) | HTTP route adapter | Bridges Next.js App Router `Request` -> `Response`, handling DAL auth, JSON parsing, pre-stream errors, and SSE wrapping. |
| `lib/pipeline/http-adapter.test.ts` (Create) | Adapter unit tests | Verifies HTTP status mapping (400, 401, 404, 409, 429, 503) and stream setup. |
| `app/api/generate/route.ts` (Modify) | Generation endpoint | Thin adapter declaring schema, resolving game ownership, and delegating to `handleStreamingRoute`. |
| `app/api/patch/route.ts` (Modify) | Patch endpoint | Thin adapter declaring schema, resolving patch base, and delegating to `handleStreamingRoute`. |

---

### Task 1: Core Lifecycle Engine Types & Admission Refusal Logic

**Files:**
- Create: `lib/pipeline/lifecycle.ts`
- Test: `lib/pipeline/lifecycle.test.ts`

**Interfaces:**
- Consumes:
  - `QuotaStore` from `lib/quota/types.ts`
  - `RunStatus` from `lib/games/run-guard.ts`
  - `GenerationOutcome` from `lib/pipeline/generate.ts`
  - `GenerationErrorCode` from `lib/llm/errors.ts`
  - `SseFrame` from `lib/pipeline/events.ts`
- Produces:
  - `RunAdmissionRequest` interface
  - `RunAdmissionRefusal` interface
  - `LifecycleDependencies` interface
  - `PipelineStrategy<TContext>` type
  - `LifecycleResult` type
  - `checkRunAdmission(admission, deps)` function

- [ ] **Step 1: Write the failing test for admission check**

Create `lib/pipeline/lifecycle.test.ts`:

```typescript
import { describe, expect, it, mock } from "bun:test";
import type { QuotaStore } from "@/lib/quota/types";
import { checkRunAdmission, type RunAdmissionRequest, type LifecycleDependencies } from "./lifecycle";

describe("checkRunAdmission", () => {
  function makeMockQuota(refusal: { code: "rate_limited" | "quota_exceeded"; message: string } | null): QuotaStore {
    return {
      checkRunAllowed: mock(async () => refusal),
      chargeRun: mock(async () => {}),
      readStatus: mock(async () => ({ dailyLimit: 1000, usedTokens: 0, runsInLastMinute: 0, burstLimit: 5 })),
    };
  }

  it("returns refusal when quota check rejects caller", async () => {
    const quotaStore = makeMockQuota({ code: "quota_exceeded", message: "Daily token limit reached." });
    const beginRun = mock(async () => "run-123");
    const finishRun = mock(async () => {});

    const admission: RunAdmissionRequest = {
      userId: "user-1",
      isAdmin: false,
      gameId: "game-1",
    };

    const deps: LifecycleDependencies = {
      quotaStore,
      beginRun,
      finishRun,
      now: () => 1000,
    };

    const result = await checkRunAdmission(admission, deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.refusal.code).toBe("quota_exceeded");
      expect(result.refusal.message).toBe("Daily token limit reached.");
    }
    expect(quotaStore.checkRunAllowed).toHaveBeenCalledWith("user-1", false);
    expect(beginRun).not.toHaveBeenCalled();
  });

  it("returns refusal when run lease is already claimed", async () => {
    const quotaStore = makeMockQuota(null);
    const beginRun = mock(async () => null);
    const finishRun = mock(async () => {});

    const admission: RunAdmissionRequest = {
      userId: "user-1",
      isAdmin: false,
      gameId: "game-1",
    };

    const deps: LifecycleDependencies = {
      quotaStore,
      beginRun,
      finishRun,
      now: () => 1000,
    };

    const result = await checkRunAdmission(admission, deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.refusal.code).toBe("run_in_progress");
    }
    expect(beginRun).toHaveBeenCalledWith("user-1", "game-1");
  });

  it("returns runId when admission is approved", async () => {
    const quotaStore = makeMockQuota(null);
    const beginRun = mock(async () => "run-456");
    const finishRun = mock(async () => {});

    const admission: RunAdmissionRequest = {
      userId: "user-1",
      isAdmin: true,
      gameId: null,
    };

    const deps: LifecycleDependencies = {
      quotaStore,
      beginRun,
      finishRun,
      now: () => 1000,
    };

    const result = await checkRunAdmission(admission, deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.runId).toBe("run-456");
    }
    expect(quotaStore.checkRunAllowed).toHaveBeenCalledWith("user-1", true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/pipeline/lifecycle.test.ts`
Expected: FAIL with module `./lifecycle` not found or function not exported.

- [ ] **Step 3: Implement minimal admission code in `lib/pipeline/lifecycle.ts`**

Create `lib/pipeline/lifecycle.ts`:

```typescript
import type { GenerationErrorCode } from "@/lib/llm/errors";
import type { QuotaStore } from "@/lib/quota/types";
import type { RunStatus } from "@/lib/games/run-guard";
import type { GenerationOutcome } from "@/lib/pipeline/generate";
import type { SseFrame } from "@/lib/pipeline/events";

export interface RunAdmissionRequest {
  readonly userId: string;
  readonly isAdmin: boolean;
  readonly gameId: string | null;
}

export interface RunAdmissionRefusal {
  readonly code: GenerationErrorCode;
  readonly message: string;
}

export interface LifecycleDependencies {
  readonly quotaStore: QuotaStore;
  readonly beginRun: (userId: string, gameId: string | null) => Promise<string | null>;
  readonly finishRun: (runId: string, status: RunStatus) => Promise<void>;
  readonly now: () => number;
}

export type PipelineStrategy<TContext> = (
  emit: (frame: SseFrame) => void,
  context: TContext,
) => Promise<GenerationOutcome>;

export type AdmissionCheckResult =
  | { readonly ok: true; readonly runId: string }
  | { readonly ok: false; readonly refusal: RunAdmissionRefusal };

export async function checkRunAdmission(
  admission: RunAdmissionRequest,
  deps: LifecycleDependencies,
): Promise<AdmissionCheckResult> {
  const refusal = await deps.quotaStore.checkRunAllowed(admission.userId, admission.isAdmin);

  if (refusal !== null) {
    return { ok: false, refusal: { code: refusal.code, message: refusal.message } };
  }

  const runId = await deps.beginRun(admission.userId, admission.gameId);

  if (runId === null) {
    return {
      ok: false,
      refusal: {
        code: "run_in_progress",
        message: "A generation is already running. Wait for it to finish before starting another.",
      },
    };
  }

  return { ok: true, runId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/pipeline/lifecycle.test.ts`
Expected: PASS (3 tests passed).

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline/lifecycle.ts lib/pipeline/lifecycle.test.ts
git commit -m "feat(pipeline): add lifecycle types and checkRunAdmission"
```

---

### Task 2: Core Lifecycle Execution & Guaranteed Settlement

**Files:**
- Modify: `lib/pipeline/lifecycle.ts`
- Modify: `lib/pipeline/lifecycle.test.ts`

**Interfaces:**
- Produces:
  - `executeRunLifecycle<TContext>(admission, deps, strategy, context, emit)`

- [ ] **Step 1: Write failing tests for `executeRunLifecycle` execution and settlement**

Append to `lib/pipeline/lifecycle.test.ts`:

```typescript
import { executeRunLifecycle } from "./lifecycle";

describe("executeRunLifecycle", () => {
  it("executes strategy and charges tokens on success", async () => {
    const chargeRun = mock(async () => {});
    const finishRun = mock(async () => {});
    const frames: SseFrame[] = [];

    const deps: LifecycleDependencies = {
      quotaStore: {
        checkRunAllowed: mock(async () => null),
        chargeRun,
        readStatus: mock(async () => ({ dailyLimit: null, usedTokens: 0, runsInLastMinute: 0, burstLimit: 5 })),
      },
      beginRun: mock(async () => "run-1"),
      finishRun,
      now: () => 1000,
    };

    const strategy = mock(async (emit: (frame: SseFrame) => void) => {
      emit({ event: "stage.started", data: { stage: "coder" } });
      return {
        status: "completed" as const,
        gameId: "game-1",
        versionId: "ver-1",
        versionNumber: 1,
        tokensUsed: 250,
      };
    });

    const result = await executeRunLifecycle(
      { userId: "u-1", isAdmin: false, gameId: "game-1" },
      deps,
      strategy,
      { prompt: "test" },
      (frame) => frames.push(frame),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome.status).toBe("completed");
    }
    expect(frames).toHaveLength(1);
    expect(frames[0].event).toBe("stage.started");
    expect(chargeRun).toHaveBeenCalledWith("u-1", 250);
    expect(finishRun).toHaveBeenCalledWith("run-1", "completed");
  });

  it("settles charge and releases lease as failed when strategy returns failure", async () => {
    const chargeRun = mock(async () => {});
    const finishRun = mock(async () => {});

    const deps: LifecycleDependencies = {
      quotaStore: {
        checkRunAllowed: mock(async () => null),
        chargeRun,
        readStatus: mock(async () => ({ dailyLimit: null, usedTokens: 0, runsInLastMinute: 0, burstLimit: 5 })),
      },
      beginRun: mock(async () => "run-2"),
      finishRun,
      now: () => 1000,
    };

    const strategy = mock(async () => ({
      status: "failed" as const,
      code: "coder_failed" as const,
      message: "Syntax error",
      stage: "coder" as const,
      versionId: null,
      tokensUsed: 120,
    }));

    const result = await executeRunLifecycle(
      { userId: "u-1", isAdmin: false, gameId: null },
      deps,
      strategy,
      {},
      () => {},
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.outcome.status).toBe("failed");
    }
    expect(chargeRun).toHaveBeenCalledWith("u-1", 120);
    expect(finishRun).toHaveBeenCalledWith("run-2", "failed");
  });

  it("settles lease as failed even when strategy throws an unhandled error", async () => {
    const chargeRun = mock(async () => {});
    const finishRun = mock(async () => {});

    const deps: LifecycleDependencies = {
      quotaStore: {
        checkRunAllowed: mock(async () => null),
        chargeRun,
        readStatus: mock(async () => ({ dailyLimit: null, usedTokens: 0, runsInLastMinute: 0, burstLimit: 5 })),
      },
      beginRun: mock(async () => "run-3"),
      finishRun,
      now: () => 1000,
    };

    const strategy = mock(async () => {
      throw new Error("Catastrophic network drop");
    });

    await expect(
      executeRunLifecycle(
        { userId: "u-1", isAdmin: false, gameId: null },
        deps,
        strategy,
        {},
        () => {},
      ),
    ).rejects.toThrow("Catastrophic network drop");

    expect(chargeRun).toHaveBeenCalledWith("u-1", 0);
    expect(finishRun).toHaveBeenCalledWith("run-3", "failed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/pipeline/lifecycle.test.ts`
Expected: FAIL with `executeRunLifecycle` is not defined.

- [ ] **Step 3: Implement `executeRunLifecycle` in `lib/pipeline/lifecycle.ts`**

Add to `lib/pipeline/lifecycle.ts`:

```typescript
export type LifecycleExecutionResult =
  | { readonly ok: true; readonly outcome: GenerationOutcome }
  | { readonly ok: false; readonly refusal: RunAdmissionRefusal };

export async function executeRunLifecycle<TContext>(
  admission: RunAdmissionRequest,
  deps: LifecycleDependencies,
  strategy: PipelineStrategy<TContext>,
  context: TContext,
  emit: (frame: SseFrame) => void,
): Promise<LifecycleExecutionResult> {
  const admissionResult = await checkRunAdmission(admission, deps);

  if (!admissionResult.ok) {
    return { ok: false, refusal: admissionResult.refusal };
  }

  const { runId } = admissionResult;
  let status: RunStatus = "failed";
  let chargeableTokens = 0;

  try {
    const outcome = await strategy(emit, context);
    status = outcome.status;
    chargeableTokens = outcome.tokensUsed;
    return { ok: true, outcome };
  } finally {
    try {
      await deps.quotaStore.chargeRun(admission.userId, chargeableTokens);
    } catch {
      // Best-effort: billing failure must not prevent releasing the concurrency lease.
    }
    await deps.finishRun(runId, status);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/pipeline/lifecycle.test.ts`
Expected: PASS (all 6 tests passed).

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline/lifecycle.ts lib/pipeline/lifecycle.test.ts
git commit -m "feat(pipeline): implement executeRunLifecycle with guaranteed settlement"
```

---

### Task 3: HTTP Route Adapter for Streaming Runs

**Files:**
- Create: `lib/pipeline/http-adapter.ts`
- Create: `lib/pipeline/http-adapter.test.ts`

**Interfaces:**
- Consumes:
  - `getCurrentProfile` from `lib/dal.ts`
  - `getServerEnv` from `lib/env/server.ts`
  - `createPostgresQuotaStore` from `lib/quota/postgres-store.ts`
  - `beginGenerationRun`, `finishGenerationRun` from `lib/games/run-guard.ts`
  - `createSseResponse` from `lib/pipeline/sse-stream.ts`
  - `preStreamFailure` from `lib/pipeline/http-status.ts`
  - `executeRunLifecycle`, `PipelineStrategy` from `lib/pipeline/lifecycle.ts`
- Produces:
  - `handleStreamingRoute<TBody, TContext>` function

- [ ] **Step 1: Write failing tests for `handleStreamingRoute`**

Create `lib/pipeline/http-adapter.test.ts`:

```typescript
import { describe, expect, it, mock } from "bun:test";
import { z } from "zod";
import { handleStreamingRoute } from "./http-adapter";

describe("handleStreamingRoute", () => {
  const dummySchema = z.object({
    prompt: z.string().min(1),
  });

  it("returns 401 pre-stream failure when user is unauthenticated", async () => {
    const request = new Request("http://localhost/api/generate", {
      method: "POST",
      body: JSON.stringify({ prompt: "Make a game" }),
    });

    const response = await handleStreamingRoute({
      request,
      schema: dummySchema,
      getProfile: async () => null,
      resolveTarget: async () => ({ ok: true, gameId: null, context: { prompt: "Make a game" } }),
      strategy: async () => ({
        status: "completed",
        gameId: "g-1",
        versionId: "v-1",
        versionNumber: 1,
        tokensUsed: 10,
      }),
      logPrefix: "[test]",
    });

    expect(response.status).toBe(401);
    const json = (await response.json()) as { error: { code: string } };
    expect(json.error.code).toBe("unauthorized");
  });

  it("returns 400 pre-stream failure when body is invalid", async () => {
    const request = new Request("http://localhost/api/generate", {
      method: "POST",
      body: JSON.stringify({ prompt: "" }),
    });

    const response = await handleStreamingRoute({
      request,
      schema: dummySchema,
      getProfile: async () => ({ id: "u-1", email: "a@b.com", role: "user" as const }),
      resolveTarget: async () => ({ ok: true, gameId: null, context: { prompt: "" } }),
      strategy: async () => ({
        status: "completed",
        gameId: "g-1",
        versionId: "v-1",
        versionNumber: 1,
        tokensUsed: 10,
      }),
      logPrefix: "[test]",
    });

    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: { code: string } };
    expect(json.error.code).toBe("invalid_body");
  });

  it("returns target resolution error (e.g. 404 game_not_found) before taking lease", async () => {
    const request = new Request("http://localhost/api/generate", {
      method: "POST",
      body: JSON.stringify({ prompt: "valid" }),
    });

    const response = await handleStreamingRoute({
      request,
      schema: dummySchema,
      getProfile: async () => ({ id: "u-1", email: "a@b.com", role: "user" as const }),
      resolveTarget: async () => ({
        ok: false,
        error: { code: "game_not_found", message: "No such game for this user." },
      }),
      strategy: async () => ({
        status: "completed",
        gameId: "g-1",
        versionId: "v-1",
        versionNumber: 1,
        tokensUsed: 10,
      }),
      logPrefix: "[test]",
    });

    expect(response.status).toBe(404);
    const json = (await response.json()) as { error: { code: string; message: string } };
    expect(json.error.code).toBe("game_not_found");
    expect(json.error.message).toBe("No such game for this user.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test lib/pipeline/http-adapter.test.ts`
Expected: FAIL with module `./http-adapter` not found.

- [ ] **Step 3: Implement `handleStreamingRoute` in `lib/pipeline/http-adapter.ts`**

Create `lib/pipeline/http-adapter.ts`:

```typescript
import { z } from "zod";
import { getCurrentProfile } from "@/lib/dal";
import { getServerEnv } from "@/lib/env/server";
import { createPostgresQuotaStore } from "@/lib/quota/postgres-store";
import { beginGenerationRun, finishGenerationRun } from "@/lib/games/run-guard";
import { createSseResponse } from "@/lib/pipeline/sse-stream";
import { preStreamFailure } from "@/lib/pipeline/http-status";
import {
  checkRunAdmission,
  type PipelineStrategy,
  type RunAdmissionRefusal,
  type LifecycleDependencies,
} from "./lifecycle";
import type { RunStatus } from "@/lib/games/run-guard";

export interface StreamingRouteProfile {
  readonly id: string;
  readonly role: "user" | "admin";
  readonly email: string | null;
}

export interface StreamingRouteOptions<TBody, TContext> {
  readonly request: Request;
  readonly schema: z.ZodType<TBody>;
  readonly getProfile?: () => Promise<StreamingRouteProfile | null>;
  readonly resolveTarget: (
    body: TBody,
    profile: StreamingRouteProfile,
  ) => Promise<
    | { readonly ok: true; readonly gameId: string | null; readonly context: TContext }
    | { readonly ok: false; readonly error: RunAdmissionRefusal }
  >;
  readonly strategy: PipelineStrategy<TContext>;
  readonly logPrefix: string;
  readonly makeLifecycleDeps?: () => LifecycleDependencies;
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function handleStreamingRoute<TBody, TContext>(
  options: StreamingRouteOptions<TBody, TContext>,
): Promise<Response> {
  const profileGetter = options.getProfile ?? getCurrentProfile;
  const profile = await profileGetter();

  if (profile === null) {
    return preStreamFailure("unauthorized", "Sign in to run games.");
  }

  const parsedBody = options.schema.safeParse(await readJsonBody(options.request));

  if (!parsedBody.success) {
    return preStreamFailure("invalid_body", "Invalid request body.");
  }

  const targetResult = await options.resolveTarget(parsedBody.data, profile);

  if (!targetResult.ok) {
    return preStreamFailure(targetResult.error.code, targetResult.error.message);
  }

  const { gameId, context } = targetResult;

  const env = getServerEnv();
  const lifecycleDeps: LifecycleDependencies = options.makeLifecycleDeps
    ? options.makeLifecycleDeps()
    : {
        quotaStore: createPostgresQuotaStore({
          dailyTokenBudget: env.dailyTokenBudget,
          runBurstPerMinute: env.runBurstPerMinute,
        }),
        beginRun: beginGenerationRun,
        finishRun: finishGenerationRun,
        now: Date.now,
      };

  const admission = await checkRunAdmission(
    {
      userId: profile.id,
      isAdmin: profile.role === "admin",
      gameId,
    },
    lifecycleDeps,
  );

  if (!admission.ok) {
    return preStreamFailure(admission.refusal.code, admission.refusal.message);
  }

  const { runId } = admission;

  return createSseResponse({
    run: async (emit) => {
      let status: RunStatus = "failed";
      let chargeableTokens = 0;

      try {
        const outcome = await options.strategy(emit, context);
        status = outcome.status;
        chargeableTokens = outcome.tokensUsed;
      } finally {
        try {
          await lifecycleDeps.quotaStore.chargeRun(profile.id, chargeableTokens);
        } catch {
          // Best-effort spend recording.
        }
        await lifecycleDeps.finishRun(runId, status);
      }
    },
    onUnexpectedError: (error) => {
      console.error(`${options.logPrefix} unhandled pipeline failure`, error);
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test lib/pipeline/http-adapter.test.ts`
Expected: PASS (3 tests passed).

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline/http-adapter.ts lib/pipeline/http-adapter.test.ts
git commit -m "feat(pipeline): implement handleStreamingRoute HTTP adapter"
```

---

### Task 4: Migrate `/api/generate/route.ts` to Use HTTP Adapter

**Files:**
- Modify: `app/api/generate/route.ts`

**Interfaces:**
- Consumes:
  - `handleStreamingRoute` from `lib/pipeline/http-adapter.ts`
  - `runGeneration` from `lib/pipeline/generate.ts`
  - `resolveLlmBootstrap` from `lib/pipeline/llm-bootstrap.ts`
- Retains:
  - `export const runtime = "nodejs"`
  - `export const dynamic = "force-dynamic"`
  - `export const maxDuration = 300`
  - `POST(request: Request)` signature

- [ ] **Step 1: Check existing `/api/generate` tests to establish baseline**

Run: `bun test app/api/generate/route.test.ts` (if exists) or all api tests: `bun test app/api`
Verify current tests pass.

- [ ] **Step 2: Refactor `app/api/generate/route.ts`**

Replace the contents of `app/api/generate/route.ts` with the slimmed adapter:

```typescript
import { z } from "zod";
import { catalogSchema } from "@/lib/assets/catalog";
import catalogJson from "@/lib/assets/catalog.json";
import { findOwnedGame } from "@/lib/games/repository";
import { getPublicEnv } from "@/lib/env/public";
import { getServerEnv } from "@/lib/env/server";
import { runGeneration } from "@/lib/pipeline/generate";
import { resolveLlmBootstrap } from "@/lib/pipeline/llm-bootstrap";
import { persistGeneration } from "@/lib/pipeline/persist";
import { handleStreamingRoute } from "@/lib/pipeline/http-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PROMPT_MAX_LENGTH = 2000;

const generateRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(PROMPT_MAX_LENGTH),
  gameId: z.uuid().nullish(),
});

type GenerateRequestBody = z.infer<typeof generateRequestSchema>;

interface GenerationContext {
  readonly prompt: string;
  readonly gameId: string | null;
  readonly userId: string;
}

export async function POST(request: Request): Promise<Response> {
  const env = getServerEnv();
  const bootstrap = await resolveLlmBootstrap(env, request.signal);

  if (!bootstrap.ok) {
    return bootstrap.response;
  }

  const { client, models } = bootstrap;
  const catalog = catalogSchema.parse(catalogJson);
  const supabaseUrl = getPublicEnv().supabaseUrl;

  return handleStreamingRoute<GenerateRequestBody, GenerationContext>({
    request,
    schema: generateRequestSchema,
    resolveTarget: async (body, profile) => {
      const gameId = body.gameId ?? null;

      if (gameId !== null && (await findOwnedGame(gameId, profile.id)) === null) {
        return {
          ok: false,
          error: {
            code: "game_not_found",
            message: "No such game for this user.",
          },
        };
      }

      return {
        ok: true,
        gameId,
        context: {
          prompt: body.prompt,
          gameId,
          userId: profile.id,
        },
      };
    },
    strategy: async (emit, context) => {
      return runGeneration(
        {
          prompt: context.prompt,
          gameId: context.gameId,
          userId: context.userId,
        },
        {
          client,
          models,
          catalog,
          supabaseUrl,
          persist: persistGeneration,
          emit,
          signal: request.signal,
          now: Date.now,
        },
      );
    },
    logPrefix: "[/api/generate]",
  });
}
```

- [ ] **Step 3: Run tests to verify compatibility**

Run: `bun test`
Expected: PASS (all pipeline and generation tests continue to pass).

- [ ] **Step 4: Commit**

```bash
git add app/api/generate/route.ts
git commit -m "refactor(api/generate): adopt handleStreamingRoute lifecycle adapter"
```

---

### Task 5: Migrate `/api/patch/route.ts` to Use HTTP Adapter

**Files:**
- Modify: `app/api/patch/route.ts`

**Interfaces:**
- Consumes:
  - `handleStreamingRoute` from `lib/pipeline/http-adapter.ts`
  - `runPatch` from `lib/pipeline/patch.ts`
  - `resolveLlmBootstrap` from `lib/pipeline/llm-bootstrap.ts`
- Retains:
  - `export const runtime = "nodejs"`
  - `export const dynamic = "force-dynamic"`
  - `export const maxDuration = 300`
  - `POST(request: Request)` signature

- [ ] **Step 1: Check existing patch pipeline tests**

Run: `bun test lib/pipeline/patch.test.ts`
Verify baseline passes.

- [ ] **Step 2: Refactor `app/api/patch/route.ts`**

Replace the contents of `app/api/patch/route.ts` with:

```typescript
import { z } from "zod";
import { catalogSchema } from "@/lib/assets/catalog";
import catalogJson from "@/lib/assets/catalog.json";
import { findPatchBase, type PatchBase } from "@/lib/games/repository";
import { getPublicEnv } from "@/lib/env/public";
import { getServerEnv } from "@/lib/env/server";
import { runPatch } from "@/lib/pipeline/patch";
import { resolveLlmBootstrap } from "@/lib/pipeline/llm-bootstrap";
import { persistGeneration } from "@/lib/pipeline/persist";
import { handleStreamingRoute } from "@/lib/pipeline/http-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const INSTRUCTION_MAX_LENGTH = 2000;

const patchRequestSchema = z.object({
  gameId: z.uuid(),
  instruction: z.string().trim().min(1).max(INSTRUCTION_MAX_LENGTH),
});

type PatchRequestBody = z.infer<typeof patchRequestSchema>;

interface PatchContext {
  readonly gameId: string;
  readonly userId: string;
  readonly instruction: string;
  readonly base: PatchBase;
}

export async function POST(request: Request): Promise<Response> {
  const env = getServerEnv();
  const bootstrap = await resolveLlmBootstrap(env, request.signal);

  if (!bootstrap.ok) {
    return bootstrap.response;
  }

  const { client, models } = bootstrap;
  const catalog = catalogSchema.parse(catalogJson);
  const supabaseUrl = getPublicEnv().supabaseUrl;

  return handleStreamingRoute<PatchRequestBody, PatchContext>({
    request,
    schema: patchRequestSchema,
    resolveTarget: async (body, profile) => {
      const base = await findPatchBase(body.gameId, profile.id);

      if (base === null) {
        return {
          ok: false,
          error: {
            code: "game_not_found",
            message: "No editable version for this game.",
          },
        };
      }

      return {
        ok: true,
        gameId: body.gameId,
        context: {
          gameId: body.gameId,
          userId: profile.id,
          instruction: body.instruction,
          base,
        },
      };
    },
    strategy: async (emit, context) => {
      return runPatch(
        {
          gameId: context.gameId,
          userId: context.userId,
          instruction: context.instruction,
          base: context.base,
        },
        {
          client,
          models,
          catalog,
          supabaseUrl,
          persist: persistGeneration,
          emit,
          signal: request.signal,
          now: Date.now,
        },
      );
    },
    logPrefix: "[/api/patch]",
  });
}
```

- [ ] **Step 3: Run test suite to verify compatibility**

Run: `bun test`
Expected: PASS (all tests pass).

- [ ] **Step 4: Commit**

```bash
git add app/api/patch/route.ts
git commit -m "refactor(api/patch): adopt handleStreamingRoute lifecycle adapter"
```

---

### Task 6: End-to-End Type Check and Full Suite Verification

**Files:**
- Verification only: all touched files.

- [ ] **Step 1: Run complete type check**

Run: `bun run check-types`
Expected: Route types generated successfully, `tsc --noEmit` exits 0 with zero type errors.

- [ ] **Step 2: Run linter**

Run: `bun run lint`
Expected: 0 lint errors or warnings.

- [ ] **Step 3: Run entire test suite**

Run: `bun test`
Expected: All 390+ tests pass cleanly.

- [ ] **Step 4: Commit any final formatting cleanups**

```bash
git status
# If clean:
echo "All checks verified and clean."
```
