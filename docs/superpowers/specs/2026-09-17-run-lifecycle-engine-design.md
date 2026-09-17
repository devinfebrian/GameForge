# Run Execution Lifecycle Engine Design Specification

- **Date**: 2026-09-17
- **Status**: Approved (Approach A)
- **Target Subsystem**: `lib/pipeline/` and `app/api/`

---

## 1. Context & Architectural Problem

Both `/api/generate/route.ts` and `/api/patch/route.ts` currently manage ~140 lines of procedural orchestration:
1. Validating user identity via Data Access Layer (`getCurrentProfile`).
2. Parsing and schema-validating input payloads (`zod`).
3. Verifying game ownership or patch base version existence.
4. Pre-checking quota limits (`quota.checkRunAllowed`) against daily token budgets and burst limits.
5. Resolving LLM clients and models via `resolveLlmBootstrap`.
6. Acquiring the single-flight user run lease via `beginGenerationRun`.
7. Constructing the Server-Sent Events (`createSseResponse`) response wrapper.
8. Executing the pipeline stage runner (`runGeneration` or `runPatch`).
9. Billing the tokens consumed to `user_token_usage` in a `finally` block.
10. Releasing the run lease with terminal status (`completed`, `failed`, `aborted`).
11. Logging unexpected runtime errors.

### Architectural Friction
- **Lack of Locality**: The financial spend ceiling (`quota.chargeRun`), concurrency mutex (`run-guard`), and stream lifecycle logic are copy-pasted across endpoints. If a route forgets the `finally` block or throws early, token budgets under-charge or user run slots deadlock.
- **Low Leverage**: Every new pipeline capability requires re-wiring the same 8-step lifecycle harness.
- **Poor In-Process Testability**: Because the lease and quota checks are tightly coupled to the Next.js `POST(request: Request)` signature, end-to-end lease acquisition, abort billing, and quota refusals cannot be verified without simulating Next.js HTTP `Request` and `Response` objects.

---

## 2. Design Vocabulary & Principles

This design adheres to the codebase design principles:
- **Module**: The Run Lifecycle Engine is a deep module encapsulating admission, leasing, execution, and terminal settlement behind a small interface.
- **Interface**: `executeRunLifecycle(...)` accepts an admission intent, dependencies, and a pluggable stage strategy. It guarantees the invariant: *if a run lease is granted, it is always released, and tokens used are always billed*.
- **Seam**: Two distinct seams are established:
  1. *Core Engine Seam* (`lib/pipeline/lifecycle.ts`): Protocol-agnostic pure TypeScript interface.
  2. *HTTP Adapter Seam* (`lib/pipeline/http-adapter.ts`): Bridges Next.js Route Handlers (Web `Request` -> Web `Response`).
- **Adapter**: `app/api/generate/route.ts` and `app/api/patch/route.ts` become thin adapters mapping HTTP JSON requests into engine calls.
- **Locality**: Lease management and quota settlement live exclusively in one source file.
- **Leverage**: A single engine drives both generation and patch pipelines.

---

## 3. Architecture & Data Flow

```
+-------------------------------------------------------------+
| Next.js App Router                                          |
| POST /api/generate                     POST /api/patch      |
+-------------------------------------------------------------+
               \                               /
                \                             /
                 v                           v
+-------------------------------------------------------------+
| HTTP Route Adapter (lib/pipeline/http-adapter.ts)           |
| - Resolves Current User & Server Env                        |
| - Maps Pre-Stream Admission Refusals to HTTP 400/401/429/503|
| - Packages Stream into createSseResponse (SSE)              |
+-------------------------------------------------------------+
                               |
                               v
+-------------------------------------------------------------+
| Run Lifecycle Engine (lib/pipeline/lifecycle.ts)            |
| 1. Admission Check (QuotaStore.checkRunAllowed)             |
| 2. Acquire Concurrency Lease (beginGenerationRun)           |
| 3. try {                                                    |
|      executeStrategy(emit, context)                         |
|    } finally {                                              |
|      quota.chargeRun(userId, tokensUsed)                    |
|      finishGenerationRun(runId, status)                     |
|    }                                                        |
+-------------------------------------------------------------+
                               |
                               v
+-------------------------------------------------------------+
| Pipeline Strategy (runGeneration / runPatch)                |
| - SpecAgent -> AssetMapper -> CoderAgent                    |
| - Emits stage.started, stage.completed, error, run.completed|
+-------------------------------------------------------------+
```

---

## 4. Interfaces & Contracts

### 4.1 Admission & Outcome Types

```typescript
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

export type LifecycleResult =
  | { readonly ok: true; readonly outcome: GenerationOutcome }
  | { readonly ok: false; readonly refusal: RunAdmissionRefusal };
```

### 4.2 Core Lifecycle Execution

```typescript
export async function executeRunLifecycle<TContext>(
  admission: RunAdmissionRequest,
  deps: LifecycleDependencies,
  strategy: PipelineStrategy<TContext>,
  context: TContext,
  emit: (frame: SseFrame) => void,
): Promise<LifecycleResult>;
```

### 4.3 HTTP Adapter

```typescript
export interface StreamingRouteOptions<TBody, TContext> {
  readonly request: Request;
  readonly schema: z.ZodType<TBody>;
  readonly resolveTarget: (
    body: TBody,
    profile: Profile,
  ) => Promise<
    | { readonly ok: true; readonly gameId: string | null; readonly context: TContext }
    | { readonly ok: false; readonly error: RunAdmissionRefusal }
  >;
  readonly strategy: PipelineStrategy<TContext>;
  readonly logPrefix: string;
}

export async function handleStreamingRoute<TBody, TContext>(
  options: StreamingRouteOptions<TBody, TContext>,
): Promise<Response>;
```

---

## 5. Settlement & Error Invariants

1. **Pre-Stream Refusal**:
   - If quota is exceeded or burst limit reached, `beginGenerationRun` is never called.
   - Return HTTP 429 with `{ error: { code, message } }`.
   - If another run is in progress (`runId === null`), return HTTP 409.
2. **Guaranteed Settlement**:
   - `chargeableTokens` starts at 0.
   - If `strategy` completes, `chargeableTokens = outcome.tokensUsed`.
   - If `strategy` throws or aborts, tokens used up to that point (if captured) are billed.
   - `finally` block executes:
     `await quotaStore.chargeRun(admission.userId, chargeableTokens)`
     `await finishRun(runId, status)`
3. **Stream Protocol Preservation**:
   - Terminal SSE frames (`error` or `run.completed`) are guaranteed to be emitted.
   - Client abort (`request.signal`) stops further execution cleanly without crashing the stream runner.

---

## 6. Testing Strategy

1. **Unit & In-Process Lifecycle Tests** (`lib/pipeline/lifecycle.test.ts`):
   - Refusal on quota check failure (no run lease created).
   - Refusal on active lease (409 conflict).
   - Successful run settlement: verifies `chargeRun` and `finishRun("completed")`.
   - Pipeline failure settlement: verifies `chargeRun` with partial tokens and `finishRun("failed")`.
   - Abort settlement: verifies `finishRun("aborted")`.
2. **HTTP Adapter Tests** (`lib/pipeline/http-adapter.test.ts`):
   - Unauthorized user -> 401.
   - Malformed body -> 400.
   - Target resolution failure -> 404.
   - Quota refusal -> 429.
   - Concurrency conflict -> 409.
   - Valid stream execution -> 200 `text/event-stream`.
3. **Route Integration**:
   - Verify `/api/generate` and `/api/patch` continue passing existing end-to-end and route test suites.
