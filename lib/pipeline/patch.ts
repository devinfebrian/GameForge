import { defaultSynthesizedSounds, mergeManifests, resolveManifest, runAssetMapper } from "@/lib/agents/asset-mapper";
import type { ResolvedManifest } from "@/lib/agents/asset-mapper/schema";
import { runCoderAgent } from "@/lib/agents/coder";
import type { GenerationStage } from "@/lib/agents/types";
import type { Catalog } from "@/lib/assets/catalog";
import type { PatchBase } from "@/lib/games/repository";
import { isAbortError, toGenerationError } from "@/lib/llm/errors";
import { GenerationError } from "@/lib/llm/errors";
import type { LlmEndpoint, LlmFallback, LlmRoute } from "@/lib/llm/failover";
import { isProviderUnavailable, runStageWithFallback } from "@/lib/llm/failover";
import type { AgentModels, LlmClient, LlmUsage } from "@/lib/llm/types";
import { EMPTY_USAGE, addUsage } from "@/lib/llm/types";
import type { SseFrame, UsageData } from "@/lib/pipeline/events";
import type { GenerationOutcome } from "@/lib/pipeline/generate";
import type {
  PersistGenerationInput,
  PersistedGeneration,
} from "@/lib/pipeline/persist";

export interface PatchRequest {
  readonly gameId: string;
  readonly userId: string;
  readonly instruction: string;
  /** The current version, whose spec and manifest are replayed into the Coder. */
  readonly base: PatchBase;
}

export interface PatchDependencies {
  /** Per-agent LLM clients, keyed by provider name. */
  readonly clients: ReadonlyMap<string, LlmClient>;
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

/** Same terminal shape as generation, so the Studio has one result contract. */
export type PatchOutcome = GenerationOutcome;

const ASSISTANT_SUMMARY_MAX = 200;

/**
 * The assistant's chat bubble for a patch.
 *
 * Deterministic on purpose: a model-written summary would be a third model call
 * per patch, and the version number is not known until after the write, so any
 * message that named one would have to be computed in the database. The
 * instruction itself is the honest content, and the timeline carries the number.
 */
export function patchAssistantMessage(instruction: string): string {
  const trimmed = instruction.trim();
  const clipped =
    trimmed.length > ASSISTANT_SUMMARY_MAX
      ? `${trimmed.slice(0, ASSISTANT_SUMMARY_MAX - 3)}...`
      : trimmed;

  return `Patch applied: ${clipped}`;
}

/**
 * Coder-only revision of the game's current version.
 *
 * Spec is deliberately skipped: the stored spec is replayed verbatim, so an edit
 * costs one or two model calls instead of three. The Asset Mapper does run, but
 * only to refine art, and its output is merged onto the existing manifest rather
 * than replacing it — see `mergeManifests`.
 *
 * The failure policy is the opposite of generation's Spec stage: a failed patch
 * IS persisted, with `promoteCurrent: false`. Phase 5 needs a broken snapshot to
 * repair, and the user's working game must keep pointing at the version that
 * still plays.
 */
export async function runPatch(
  request: PatchRequest,
  deps: PatchDependencies,
): Promise<PatchOutcome> {
  const outcome = await executePatch(request, deps);

  // Terminal frames are emitted in exactly one place, as in generation, so no
  // path can return without the client being told. An abort stays silent.
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
  } else if (outcome.status === "completed") {
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

type StageResult<T> =
  | { readonly ok: true; readonly value: T; readonly endpoint: LlmEndpoint }
  | { readonly ok: false; readonly error: unknown };

async function executePatch(
  request: PatchRequest,
  deps: PatchDependencies,
): Promise<PatchOutcome> {
  const startedAt = deps.now();
  const { base } = request;
  let usage = EMPTY_USAGE;

  const isAborting = (error: unknown): boolean =>
    deps.signal.aborted || isAbortError(error);

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

  const routeFor = (stage: GenerationStage): LlmRoute => {
    const { model, provider } = deps.models[stage];
    const client = deps.clients.get(provider);

    if (client === undefined) {
      throw new GenerationError(
        "config_missing",
        `No LLM client found for provider "${provider}" for the "${stage}" stage.`,
      );
    }

    return {
      primary: { provider, client, model },
      fallback: deps.fallback?.endpoints[stage] ?? null,
    };
  };

  /**
   * The run is about to stop because the coder failed and the primary provider
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
  ): Promise<StageResult<T>> {
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
      return { ok: false, error };
    }
  }

  deps.emit({ event: "run.started", data: { gameId: request.gameId } });

  // --- Asset Mapper (advisory) ---
  //
  // Skipped in `llm` asset mode: the coder owns all art, so a mapping call would
  // spend tokens deciding assignments it ignores. The existing manifest (already
  // all-procedural for an `llm`-mode game) is carried through unchanged.
  let manifest: ResolvedManifest;
  let assetsChanged = false;

  if (deps.assetMode === "llm") {
    manifest =
      Object.keys(base.manifest.sounds).length > 0
        ? base.manifest
        : {
            ...base.manifest,
            sounds: defaultSynthesizedSounds(base.spec),
          };
  } else {
    const mapResult = await attemptStage("asset_mapper", routeFor("asset_mapper"), async (endpoint) => {
      const result = await runAssetMapper({
        spec: base.spec,
        catalog: deps.catalog,
        client: endpoint.client,
        model: endpoint.model,
        signal: deps.signal,
        patchInstruction: request.instruction,
      });

      return { value: result.mapping, usage: result.usage };
    });

    if (mapResult.ok) {
      const mapped = resolveManifest({
        mapping: mapResult.value,
        spec: base.spec,
        catalog: deps.catalog,
        supabaseUrl: deps.supabaseUrl,
      });

      const merged = mergeManifests(base.manifest, mapped);
      assetsChanged = JSON.stringify(merged) !== JSON.stringify(base.manifest);
      manifest = merged;
    } else if (isAborting(mapResult.error)) {
      return { status: "aborted", tokensUsed: totalTokens() };
    } else {
      const warning = toGenerationError(mapResult.error, "asset_mapper", "asset_mapper_failed");

      deps.emit({
        event: "warning",
        data: {
          stage: "asset_mapper",
          code: "mapper_degraded",
          message: `Sprite mapping failed; the existing art is unchanged. ${warning.message}`,
        },
      });

      manifest = base.manifest;
    }
  }

  async function failWithVersion(error: unknown): Promise<PatchOutcome> {
    const failure = toGenerationError(error, "coder", "coder_failed");
    const attribution = coderAttribution();

    emitNoFallbackWarning("coder", failure);

    try {
      const persisted = await deps.persist({
        userId: request.userId,
        gameId: request.gameId,
        spec: base.spec,
        manifest,
        prompt: request.instruction,
        sourceCode: null,
        errorLog: `${failure.code}: ${failure.message}`,
        // Kept for Phase 5 to repair, never promoted: a failed edit must not
        // replace a version that still plays.
        promoteCurrent: false,
        modelUsed: deps.models.coder.model,
        provider: attribution.provider,
        isFallback: attribution.isFallback,
        fallbackReason: attribution.fallbackReason,
        tokensUsed: totalTokens(),
        executionTimeMs: elapsed(),
        assistantMessage: `Patch failed: ${failure.message}`,
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
      const reason =
        persistError instanceof Error ? persistError.message : "unknown persistence error";

      return {
        status: "failed",
        code: "internal",
        message: `${failure.message} Recording the failure also failed: ${reason}`,
        stage: "coder",
        versionId: null,
        tokensUsed: totalTokens(),
      };
    }
  }

  // --- Coder, revising the current source ---
  const coderResult = await attemptStage("coder", routeFor("coder"), async (endpoint) => {
    const result = await runCoderAgent({
      spec: base.spec,
      manifest,
      client: endpoint.client,
      model: endpoint.model,
      signal: deps.signal,
      patch: {
        instruction: request.instruction,
        currentSource: base.sourceCode,
        assetsChanged,
      },
    });

    return { value: result.code, usage: result.usage };
  });

  if (!coderResult.ok) {
    if (isAborting(coderResult.error)) {
      return { status: "aborted", tokensUsed: totalTokens() };
    }

    return failWithVersion(coderResult.error);
  }

  // --- Commit ---
  const attribution = coderAttribution();

  try {
    const persisted = await deps.persist({
      userId: request.userId,
      gameId: request.gameId,
      spec: base.spec,
      manifest,
      prompt: request.instruction,
      sourceCode: coderResult.value,
      errorLog: null,
      promoteCurrent: true,
      modelUsed: coderResult.endpoint.model,
      provider: attribution.provider,
      isFallback: attribution.isFallback,
      fallbackReason: attribution.fallbackReason,
      tokensUsed: totalTokens(),
      executionTimeMs: elapsed(),
      assistantMessage: patchAssistantMessage(request.instruction),
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

    return {
      status: "failed",
      code: "internal",
      message: "The patch could not be recorded.",
      stage: "coder",
      versionId: null,
      tokensUsed: totalTokens(),
    };
  }
}
