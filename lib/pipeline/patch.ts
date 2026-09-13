import { mergeManifests, resolveManifest, runAssetMapper } from "@/lib/agents/asset-mapper";
import type { ResolvedManifest } from "@/lib/agents/asset-mapper/schema";
import { runCoderAgent } from "@/lib/agents/coder";
import type { GenerationStage } from "@/lib/agents/types";
import type { Catalog } from "@/lib/assets/catalog";
import type { PatchBase } from "@/lib/games/repository";
import { isAbortError, toGenerationError } from "@/lib/llm/errors";
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
  readonly client: LlmClient;
  readonly models: AgentModels;
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
  | { readonly ok: true; readonly value: T }
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

  const cumulative = (): UsageData => ({
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  });

  async function attemptStage<T>(
    stage: GenerationStage,
    body: () => Promise<{ readonly value: T; readonly usage: LlmUsage }>,
  ): Promise<StageResult<T>> {
    deps.emit({ event: "stage.started", data: { stage } });

    try {
      const result = await body();
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

      return { ok: true, value: result.value };
    } catch (error) {
      return { ok: false, error };
    }
  }

  deps.emit({ event: "run.started", data: { gameId: request.gameId } });

  // --- Asset Mapper (advisory) ---
  const mapResult = await attemptStage("asset_mapper", async () => {
    const result = await runAssetMapper({
      spec: base.spec,
      catalog: deps.catalog,
      client: deps.client,
      model: deps.models.asset_mapper,
      signal: deps.signal,
    });

    return { value: result.mapping, usage: result.usage };
  });

  let manifest: ResolvedManifest;

  if (mapResult.ok) {
    const mapped = resolveManifest({
      mapping: mapResult.value,
      spec: base.spec,
      catalog: deps.catalog,
      supabaseUrl: deps.supabaseUrl,
    });

    manifest = mergeManifests(base.manifest, mapped);
  } else if (isAborting(mapResult.error)) {
    return { status: "aborted" };
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

  async function failWithVersion(error: unknown): Promise<PatchOutcome> {
    const failure = toGenerationError(error, "coder", "coder_failed");

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
        modelUsed: deps.models.coder,
        tokensUsed: usage.inputTokens + usage.outputTokens,
        executionTimeMs: elapsed(),
        assistantMessage: `Patch failed: ${failure.message}`,
      });

      return {
        status: "failed",
        code: failure.code,
        message: failure.message,
        stage: failure.stage,
        versionId: persisted.versionId,
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
      };
    }
  }

  // --- Coder, revising the current source ---
  const coderResult = await attemptStage("coder", async () => {
    const result = await runCoderAgent({
      spec: base.spec,
      manifest,
      client: deps.client,
      model: deps.models.coder,
      signal: deps.signal,
      patch: {
        instruction: request.instruction,
        currentSource: base.sourceCode,
      },
    });

    return { value: result.code, usage: result.usage };
  });

  if (!coderResult.ok) {
    if (isAborting(coderResult.error)) {
      return { status: "aborted" };
    }

    return failWithVersion(coderResult.error);
  }

  // --- Commit ---
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
      modelUsed: deps.models.coder,
      tokensUsed: usage.inputTokens + usage.outputTokens,
      executionTimeMs: elapsed(),
      assistantMessage: patchAssistantMessage(request.instruction),
    });

    return {
      status: "completed",
      gameId: persisted.gameId,
      versionId: persisted.versionId,
      versionNumber: persisted.versionNumber,
    };
  } catch (error) {
    if (isAborting(error)) {
      return { status: "aborted" };
    }

    return {
      status: "failed",
      code: "internal",
      message: "The patch could not be recorded.",
      stage: "coder",
      versionId: null,
    };
  }
}
