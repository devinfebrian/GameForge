import { defaultSynthesizedSounds, resolveManifest, runAssetMapper } from "@/lib/agents/asset-mapper";
import type { AssetMapping, ResolvedManifest } from "@/lib/agents/asset-mapper/schema";
import { runCoderAgent } from "@/lib/agents/coder";
import { runSpecAgent } from "@/lib/agents/spec";
import type { GameSpec } from "@/lib/agents/spec/schema";
import type { GenerationStage } from "@/lib/agents/types";
import type { Catalog } from "@/lib/assets/catalog";
import {
  GenerationError,
  isAbortError,
  toGenerationError,
  type GenerationErrorCode,
} from "@/lib/llm/errors";
import type { LlmEndpoint, LlmFallback, LlmRoute } from "@/lib/llm/failover";
import { isProviderUnavailable, runStageWithFallback } from "@/lib/llm/failover";
import type { AgentModels, LlmClient, LlmUsage } from "@/lib/llm/types";
import { EMPTY_USAGE, addUsage } from "@/lib/llm/types";
import type { SseFrame, UsageData } from "@/lib/pipeline/events";
import type {
  PersistGenerationInput,
  PersistedGeneration,
} from "@/lib/pipeline/persist";

export interface GenerationRequest {
  readonly prompt: string;
  readonly gameId: string | null;
  readonly userId: string;
  /** Quality tier for model selection. Currently decorative — backend uses admin-configured models. */
  readonly quality?: "fast" | "balanced" | "best";
}

export interface GenerationDependencies {
  readonly client: LlmClient;
  readonly models: AgentModels;
  /** Per-stage fallback endpoints; absent or null means primary-only. */
  readonly fallback?: LlmFallback | null;
  /** `llm` skips the Asset Mapper so the coder draws everything procedurally. */
  readonly assetMode?: "kenney" | "llm";
  readonly catalog: Catalog;
  readonly supabaseUrl: string;
  readonly persist: (input: PersistGenerationInput) => Promise<PersistedGeneration>;
  readonly emit: (frame: SseFrame) => void;
  readonly signal: AbortSignal;
  readonly now: () => number;
}

export type GenerationOutcome =
  | {
      readonly status: "completed";
      readonly gameId: string;
      readonly versionId: string;
      readonly versionNumber: number;
      readonly tokensUsed: number;
    }
  | {
      readonly status: "failed";
      readonly code: GenerationErrorCode;
      readonly message: string;
      readonly stage: GenerationStage | null;
      readonly versionId: string | null;
      readonly tokensUsed: number;
    }
  | { readonly status: "aborted"; readonly tokensUsed: number };

interface StageSuccess<T> {
  readonly ok: true;
  readonly value: T;
  readonly endpoint: LlmEndpoint;
}

interface StageFailure {
  readonly ok: false;
  readonly error: unknown;
}

export async function runGeneration(
  request: GenerationRequest,
  deps: GenerationDependencies,
): Promise<GenerationOutcome> {
  const outcome = await executeGeneration(request, deps);

  // Terminal frames are emitted in exactly one place, so no failure path can
  // return without the client being told. An aborted run is silent by design:
  // nobody is left reading the stream.
  if (outcome.status === "failed") {
    deps.emit({
      event: "error",
      data: {
        code: outcome.code,
        message: outcome.message,
        stage: outcome.stage,
        versionId: outcome.versionId,
      },
    });
  }

  if (outcome.status === "completed") {
    deps.emit({
      event: "run.completed",
      data: {
        gameId: outcome.gameId,
        versionId: outcome.versionId,
        versionNumber: outcome.versionNumber,
      },
    });
  }

  return outcome;
}

/**
 * Spec -> Asset Mapper -> Coder, then exactly one database write.
 *
 * The asymmetry in the middle is deliberate and load-bearing:
 *
 * - A Spec failure persists nothing. There is no design, no manifest and no code
 *   to snapshot, and a row of nulls would only pollute the version timeline.
 * - An Asset Mapper failure is not a failure at all. Every entity degrades to
 *   procedural art and the run continues, because a sprite is cosmetic and the
 *   rest of the pipeline does not depend on which picture was chosen.
 * - A Coder failure does persist, carrying the spec and manifest that did
 *   validate, so Phase 5's debug agent has something to repair.
 *
 * An abort is checked before any of that, and short-circuits the write entirely.
 */
async function executeGeneration(
  request: GenerationRequest,
  deps: GenerationDependencies,
): Promise<GenerationOutcome> {
  const startedAt = deps.now();
  let usage = EMPTY_USAGE;

  const isAborting = (error: unknown): boolean =>
    deps.signal.aborted ||
    isAbortError(error) ||
    (error instanceof GenerationError && error.code === "aborted");

  const elapsed = (): number => Math.max(0, Math.round(deps.now() - startedAt));

  // Reported on every terminal outcome so the route can charge without
  // re-deriving the run's billable total.
  const totalTokens = (): number => usage.inputTokens + usage.outputTokens;

  const cumulative = (): UsageData => ({
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  });

  // Tracks which stage fell back and why, so the persisted transcript records
  // the gateway that actually produced the answer rather than the primary.
  const fallbackByStage = new Map<
    GenerationStage,
    { readonly provider: string; readonly reason: string }
  >();

  const routeFor = (stage: GenerationStage): LlmRoute => ({
    primary: { provider: "anthropic", client: deps.client, model: deps.models[stage] },
    fallback: deps.fallback?.endpoints[stage] ?? null,
  });

  /**
   * The run is about to stop because `stage` failed and the primary provider
   * could not take the request (quota, rate limit, or a rejected credential)
   * with no fallback to route around it. Surface that distinctly: a generic
   * stage failure would hide that a backup would have helped.
   */
  const emitNoFallbackWarning = (stage: GenerationStage, failure: GenerationError): void => {
    if (routeFor(stage).fallback !== null || !isProviderUnavailable(failure)) {
      return;
    }

    deps.emit({
      event: "warning",
      data: {
        stage,
        code: "provider_exhausted",
        message: `The primary provider could not take the ${stage} request: ${failure.message} No fallback is configured, so the run stopped here.`,
      },
    });
  };

  // The assistant transcript is written for the coder's output, so its provider,
  // fallback flag and reason describe the coder stage specifically.
  const coderAttribution = (): {
    readonly provider: string;
    readonly isFallback: boolean;
    readonly fallbackReason: string | null;
  } => {
    const fallback = fallbackByStage.get("coder");

    return {
      provider: fallback?.provider ?? "anthropic",
      isFallback: fallback !== undefined,
      fallbackReason: fallback?.reason ?? null,
    };
  };

  async function attemptStage<T>(
    stage: GenerationStage,
    route: LlmRoute,
    body: (
      endpoint: LlmEndpoint,
    ) => Promise<{ readonly value: T; readonly usage: LlmUsage }>,
  ): Promise<StageSuccess<T> | StageFailure> {
    deps.emit({ event: "stage.started", data: { stage } });

    try {
      const result = await runStageWithFallback(route, body, (endpoint, primaryError) => {
        const reason =
          primaryError instanceof GenerationError
            ? primaryError.message
            : "unknown error";

        fallbackByStage.set(stage, { provider: endpoint.provider, reason });

        deps.emit({
          event: "warning",
          data: {
            stage,
            code: "provider_fallback",
            message: `Primary provider failed; retrying on ${endpoint.provider}. ${reason}`,
          },
        });
      });

      usage = addUsage(usage, result.usage);
      deps.emit({
        event: "stage.completed",
        data: {
          stage,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
        },
      });
      deps.emit({ event: "usage", data: cumulative() });

      return { ok: true, value: result.value, endpoint: result.endpoint };
    } catch (error) {
      // A stage can fail after the provider has already billed for its response
      // (a bad payload, a rejected tool call). Those tokens still count, so they
      // are folded into the total and reported before the failure propagates.
      const spent = error instanceof GenerationError ? error.usage : null;

      if (spent !== null) {
        usage = addUsage(usage, spent);
        deps.emit({ event: "usage", data: cumulative() });
      }

      return { ok: false, error };
    }
  }

  /** A failure with no version to point at — the Spec stage's own failure. */
  function failWithoutPersist(error: unknown, stage: GenerationStage, code: GenerationErrorCode) {
    const failure = toGenerationError(error, stage, code);

    emitNoFallbackWarning(stage, failure);

    return {
      status: "failed",
      code: failure.code,
      message: failure.message,
      stage: failure.stage,
      versionId: null,
      tokensUsed: totalTokens(),
    } as const;
  }

  async function failWithVersion(
    error: unknown,
    stage: GenerationStage,
    code: GenerationErrorCode,
    spec: GameSpec,
    manifest: ResolvedManifest,
  ): Promise<GenerationOutcome> {
    const failure = toGenerationError(error, stage, code);
    const attribution = coderAttribution();

    emitNoFallbackWarning(stage, failure);

    try {
      const persisted = await deps.persist({
        userId: request.userId,
        gameId: request.gameId,
        spec,
        manifest,
        prompt: request.prompt,
        sourceCode: null,
        errorLog: `${failure.code}: ${failure.message}`,
        promoteCurrent: false,
        modelUsed: deps.models.coder,
        provider: attribution.provider,
        isFallback: attribution.isFallback,
        fallbackReason: attribution.fallbackReason,
        tokensUsed: totalTokens(),
        executionTimeMs: elapsed(),
        assistantMessage: spec.summary,
      });

      return {
        status: "failed",
        code: failure.code,
        message: failure.message,
        stage: failure.stage,
        versionId: persisted.versionId,
        tokensUsed: totalTokens(),
      };
    } catch (persistError) {
      // Losing the snapshot is a second, separate failure: report the original
      // stage honestly, but carry the persistence reason too. Without it a broken
      // write looks identical to a healthy pipeline that merely failed to
      // generate, which is exactly how a schema-drift bug stayed hidden here.
      const reason =
        persistError instanceof Error ? persistError.message : "unknown persistence error";

      return {
        status: "failed",
        code: "internal",
        message: `${failure.message} Recording the failure also failed: ${reason}`,
        stage,
        versionId: null,
        tokensUsed: totalTokens(),
      };
    }
  }

  deps.emit({ event: "run.started", data: { gameId: request.gameId } });

  // --- Spec ---
  const specResult = await attemptStage("spec", routeFor("spec"), async (endpoint) => {
    const result = await runSpecAgent({
      prompt: request.prompt,
      catalog: deps.catalog,
      client: endpoint.client,
      model: endpoint.model,
      signal: deps.signal,
    });

    return { value: result.spec, usage: result.usage };
  });

  if (!specResult.ok) {
    if (isAborting(specResult.error)) {
      return { status: "aborted", tokensUsed: totalTokens() };
    }

    return failWithoutPersist(specResult.error, "spec", "spec_failed");
  }

  const spec = specResult.value;

  // --- Asset Mapper (advisory: failure degrades, it does not abort the run) ---
  //
  // In `llm` asset mode the mapper is skipped entirely: the coder is expected to
  // draw every entity procedurally via `makeTexturedSprite`, so a mapping call
  // would only spend tokens deciding assignments the coder is about to ignore.
  let mapping: AssetMapping | null = null;

  if (deps.assetMode !== "llm") {
    const mapResult = await attemptStage("asset_mapper", routeFor("asset_mapper"), async (endpoint) => {
      const result = await runAssetMapper({
        spec,
        catalog: deps.catalog,
        client: endpoint.client,
        model: endpoint.model,
        signal: deps.signal,
      });

      return { value: result.mapping, usage: result.usage };
    });

    if (mapResult.ok) {
      mapping = mapResult.value;
    } else if (isAborting(mapResult.error)) {
      return { status: "aborted", tokensUsed: totalTokens() };
    } else {
      const warning = toGenerationError(mapResult.error, "asset_mapper", "asset_mapper_failed");

      deps.emit({
        event: "warning",
        data: {
          stage: "asset_mapper",
          code: "mapper_degraded",
          message: `Sprite mapping failed; every entity will be drawn procedurally. ${warning.message}`,
        },
      });
    }
  }

  const rawManifest = resolveManifest({
    mapping,
    spec,
    catalog: deps.catalog,
    supabaseUrl: deps.supabaseUrl,
  });

  const manifest: ResolvedManifest =
    deps.assetMode === "llm" || Object.keys(rawManifest.sounds).length === 0
      ? {
          ...rawManifest,
          sounds: { ...defaultSynthesizedSounds(spec), ...rawManifest.sounds },
        }
      : rawManifest;

  // --- Coder ---
  const coderResult = await attemptStage("coder", routeFor("coder"), async (endpoint) => {
    const result = await runCoderAgent({
      spec,
      manifest,
      client: endpoint.client,
      model: endpoint.model,
      signal: deps.signal,
    });

    return { value: result.code, usage: result.usage };
  });

  if (!coderResult.ok) {
    if (isAborting(coderResult.error)) {
      return { status: "aborted", tokensUsed: totalTokens() };
    }

    return failWithVersion(coderResult.error, "coder", "coder_failed", spec, manifest);
  }

  // --- Commit ---
  const attribution = coderAttribution();

  try {
    const persisted = await deps.persist({
      userId: request.userId,
      gameId: request.gameId,
      spec,
      manifest,
      prompt: request.prompt,
      sourceCode: coderResult.value,
      errorLog: null,
      // The scene was generated, not proven: is_stable stays false and
      // last_stable_version_id is Phase 5's to set. This only moves the pointer
      // the Studio should be showing.
      promoteCurrent: true,
      modelUsed: coderResult.endpoint.model,
      provider: attribution.provider,
      isFallback: attribution.isFallback,
      fallbackReason: attribution.fallbackReason,
      tokensUsed: totalTokens(),
      executionTimeMs: elapsed(),
      assistantMessage: spec.summary,
    });

    return {
      status: "completed",
      gameId: persisted.gameId,
      versionId: persisted.versionId,
      versionNumber: persisted.versionNumber,
      tokensUsed: totalTokens(),
    };
  } catch (error) {
    if (isAborting(error)) {
      return { status: "aborted", tokensUsed: totalTokens() };
    }

    return failWithoutPersist(error, "coder", "internal");
  }
}
