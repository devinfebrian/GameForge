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

