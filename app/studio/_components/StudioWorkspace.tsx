"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SandboxFrame } from "@/app/_components/SandboxFrame";
import type { DebugErrorReport } from "@/lib/agents/debug/prompt";
import type { GenerationStage } from "@/lib/agents/types";
import type { TranscriptMessage, VersionSummary } from "@/lib/games/repository";
import type { QuotaStatus } from "@/lib/quota/types";
import { streamRun } from "@/lib/pipeline/client";
import type {
  ErrorData,
  RunCompletedData,
  SseFrame,
  StageCompletedData,
  StageStartedData,
  WarningData,
} from "@/lib/pipeline/events";
import { useSandboxBridge } from "@/lib/sandbox/useSandboxBridge";
import { AgentStepper, stageSteps } from "./AgentStepper";
import { ExportMenu } from "./ExportMenu";
import { PublishControls } from "./PublishControls";
import { RuntimeControls } from "./RuntimeControls";
import { VersionTimeline } from "./VersionTimeline";

const GENERATE_STAGES: ReadonlyArray<{ id: GenerationStage; label: string }> = [
  { id: "spec", label: "Spec" },
  { id: "asset_mapper", label: "Assets" },
  { id: "coder", label: "Coder" },
];

// A patch skips Spec entirely, so showing a Spec step would be a lie about what
// the run is doing.
const PATCH_STAGES: ReadonlyArray<{ id: GenerationStage; label: string }> = [
  { id: "asset_mapper", label: "Assets" },
  { id: "coder", label: "Coder" },
];

const buttonClassName =
  "rounded border border-black/15 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-white/20";

const INSTRUCTION_MAX_LENGTH = 2000;

// Three seconds of clean execution makes a version stable. It is wall-clock, and
// the timer below is torn down whenever the tab is hidden or the game is paused,
// so neither can fail a game that is actually fine.
const PROBATION_MS = 3000;

// Fetching the boot payload used to be a single attempt, and its "already
// booted" ref is set before the request resolves, so one dropped connection left
// the studio stuck on a permanent "could not be loaded" that even Preview could
// not clear. A few short attempts ride out a blip; a definitive answer still
// stops immediately.
const BOOT_ATTEMPTS = 3;
const BOOT_RETRY_DELAY_MS = 400;

// The report sent when the frame never reached SCENE_READY. There is no
// RUNTIME_ERROR to forward in that case, only the timeout.
const BOOT_TIMEOUT_REPORT: DebugErrorReport = {
  message: "The game did not start within ten seconds.",
  stack: null,
  line: null,
  column: null,
  phase: "create",
};

type DebugResponse =
  | { readonly status: "candidate"; readonly candidateVersionId: string; readonly attempt: number; readonly remaining: number }
  | { readonly status: "gate_failed"; readonly attempt: number; readonly remaining: number }
  | { readonly status: "exhausted"; readonly attempt: number };

function useDocumentHidden(): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const update = (): void => setHidden(document.hidden);

    update();
    document.addEventListener("visibilitychange", update);

    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  return hidden;
}

interface RunFailure {
  readonly code: string | null;
  readonly message: string;
}

/**
 * Reads the `{ error: { code, message } }` envelope the routes return. `fallback`
 * is what to show when the body is not that envelope, so each caller can name its
 * own failure instead of inheriting one that belongs to another flow.
 */
async function readFailure(
  response: Response,
  fallback = "Automatic repair could not be started.",
): Promise<RunFailure> {
  try {
    const payload: unknown = await response.json();

    if (
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof (payload as { error: unknown }).error === "object" &&
      (payload as { error: unknown }).error !== null
    ) {
      const { code, message } = (
        payload as { error: { code?: unknown; message?: unknown } }
      ).error;

      return {
        code: typeof code === "string" ? code : null,
        message: typeof message === "string" ? message : fallback,
      };
    }
  } catch {
    // Fall through.
  }

  return { code: null, message: fallback };
}

interface BootPayload {
  readonly sourceCode: string;
  readonly assetManifest: Record<string, string>;
  readonly bootable: boolean;
  readonly bootReason: string | null;
}

/**
 * A turn the user typed that the database has no row for.
 *
 * A Spec failure persists nothing at all and an abort persists nothing by
 * design, so a chat rendered purely from `game_messages` would silently swallow
 * the prompt the user just wrote. These are shown until the server has a version
 * that represents them.
 */
interface UnpersistedTurn {
  readonly id: number;
  readonly instruction: string;
  readonly note: string;
}

export interface StudioWorkspaceProps {
  readonly gameId: string | null;
  readonly title: string | null;
  readonly currentVersionId: string | null;
  /** Whether `/play/[slug]` is currently serving this game. */
  readonly isPublic: boolean;
  /** Assigned on first publish, reserved afterwards. Null until then. */
  readonly publicSlug: string | null;
  readonly versions: ReadonlyArray<VersionSummary>;
  readonly messages: ReadonlyArray<TranscriptMessage>;
  /** Today's token usage for the signed-in user, or null when it could not be read. */
  readonly quota: QuotaStatus | null;
}

/**
 * The signed-in user's share of today's token budget. An admin has no ceiling,
 * so there is no bar to draw; the exact counts live in the tooltip rather than
 * the label so the header stays quiet. A null quota means the read failed, so
 * the bar is omitted rather than showing a misleading figure.
 */
function QuotaBar({ quota }: { readonly quota: QuotaStatus | null }) {
  if (quota === null) {
    return null;
  }

  if (quota.dailyLimit === null) {
    return <span className="text-xs opacity-70">Unlimited</span>;
  }

  const percent =
    quota.dailyLimit <= 0
      ? 100
      : Math.min(100, Math.round((quota.usedTokens / quota.dailyLimit) * 100));

  return (
    <div
      className="flex items-center gap-2"
      title={`${quota.usedTokens.toLocaleString("en-US")} of ${quota.dailyLimit.toLocaleString("en-US")} tokens used today`}
    >
      <div className="h-2 w-24 overflow-hidden rounded bg-black/10 dark:bg-white/15">
        <div className="h-full bg-foreground" style={{ width: `${percent}%` }} />
      </div>
      <span className="text-xs opacity-70">{percent}% of today&apos;s tokens</span>
    </div>
  );
}

export function StudioWorkspace({
  gameId,
  title,
  currentVersionId,
  isPublic,
  publicSlug,
  versions,
  messages,
  quota,
}: StudioWorkspaceProps) {
  const router = useRouter();
  const bridge = useSandboxBridge();
  const { loadCode, ready } = bridge;
  // A hidden tab throttles rAF to a standstill, so probation is suspended rather
  // than failed while the document is in the background.
  const hidden = useDocumentHidden();

  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [runKind, setRunKind] = useState<"generate" | "patch" | null>(null);
  const [activeStage, setActiveStage] = useState<GenerationStage | null>(null);
  const [doneStages, setDoneStages] = useState<ReadonlyArray<GenerationStage>>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [unpersisted, setUnpersisted] = useState<ReadonlyArray<UnpersistedTurn>>([]);
  const [bootError, setBootError] = useState<string | null>(null);

  // Which version the frame should be running. Seeded from the server, replaced
  // after a completed run, and repointed by Preview/Roll back.
  const [bootVersionId, setBootVersionId] = useState<string | null>(currentVersionId);
  // Separates "what the frame is showing" from "what the game points at".
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(currentVersionId);

  // The version currently under probation. Null while previewing an older version
  // or once a version has proved itself, which is what stops an old preview from
  // being marked stable.
  const [evaluateVersionId, setEvaluateVersionId] = useState<string | null>(currentVersionId);
  const [repairNotice, setRepairNotice] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  // Guards against a double submit landing before React has re-rendered the
  // disabled button. The server would answer 409 anyway; this keeps the UI from
  // ever showing two runs.
  const busyRef = useRef(false);
  const bootedRef = useRef<string | null>(null);
  const turnIdRef = useRef(0);
  // A repair is one in-flight request sequence at a time, and each distinct
  // failure is handled once, so a re-render or a duplicate error cannot fan out
  // into parallel attempts.
  const repairBusyRef = useRef(false);
  // The version the frame is actually running, set only once LOAD_CODE has been
  // sent. It is what stops a stale error from the previous version being
  // attributed to a freshly requested candidate before that candidate has booted.
  const runningVersionRef = useRef<string | null>(null);
  const handledErrorRef = useRef<unknown>(null);
  const handledTimeoutForRef = useRef<string | null>(null);

  const addUnpersistedTurn = useCallback((text: string, note: string) => {
    turnIdRef.current += 1;
    const id = turnIdRef.current;
    setUnpersisted((current) => [...current, { id, instruction: text, note }]);
  }, []);

  const handleFrame = useCallback((frame: SseFrame) => {
    if (frame.event === "stage.started") {
      setActiveStage((frame.data as StageStartedData).stage);
      return;
    }

    if (frame.event === "stage.completed") {
      const data = frame.data as StageCompletedData;
      setDoneStages((current) =>
        current.includes(data.stage) ? current : [...current, data.stage],
      );
      setActiveStage(null);
      return;
    }

    if (frame.event === "warning") {
      setWarning((frame.data as WarningData).message);
    }
  }, []);

  const boot = useCallback(
    async (versionId: string) => {
      setBootError(null);

      // Null means the request never produced a status (it threw), which is the
      // connection case; otherwise it holds the last server status we saw.
      let lastStatus: number | null = null;

      for (let attempt = 1; attempt <= BOOT_ATTEMPTS; attempt += 1) {
        try {
          const response = await fetch(`/api/games/${gameId}/versions/${versionId}`);

          if (response.ok) {
            const payload = (await response.json()) as BootPayload;

            if (!payload.bootable) {
              setBootError(payload.bootReason ?? "This version cannot be run.");
              return;
            }

            // Recorded only once LOAD_CODE is about to be sent: probation and
            // repair must never be attributed to a version that never booted.
            runningVersionRef.current = versionId;
            loadCode(payload.sourceCode, payload.assetManifest);
            return;
          }

          lastStatus = response.status;

          // A 4xx is the server's final answer — retrying returns it again.
          if (response.status < 500) {
            setBootError(
              (await readFailure(response, "This version could not be loaded.")).message,
            );
            return;
          }
        } catch {
          lastStatus = null;
        }

        if (attempt < BOOT_ATTEMPTS) {
          await new Promise((resolve) => {
            setTimeout(resolve, BOOT_RETRY_DELAY_MS * attempt);
          });
        }
      }

      setBootError(
        lastStatus === null
          ? "This version could not be loaded. Check the connection and try again."
          : `This version could not be loaded (HTTP ${lastStatus}).`,
      );
    },
    [gameId, loadCode],
  );

  // Boots the selected version once the frame can receive it. The ref keeps a
  // strict-mode double effect, or any unrelated re-render, from re-loading the
  // same version and restarting the player's game underneath them.
  useEffect(() => {
    if (!ready || bootVersionId === null) {
      return;
    }

    if (bootedRef.current === bootVersionId) {
      return;
    }

    bootedRef.current = bootVersionId;
    void boot(bootVersionId);
  }, [ready, bootVersionId, boot]);

  const commitStability = useCallback(
    async (versionId: string) => {
      if (gameId === null) {
        return;
      }

      try {
        await fetch(`/api/games/${gameId}/versions/${versionId}/stability`, {
          method: "PATCH",
        });
      } catch {
        // Best-effort: the version simply stays unproven and a later boot retries.
      }

      setEvaluateVersionId((current) => (current === versionId ? null : current));
      router.refresh();
    },
    [gameId, router],
  );

  const attemptRepair = useCallback(
    async (baseVersionId: string, report: DebugErrorReport) => {
      if (gameId === null || repairBusyRef.current) {
        return;
      }

      repairBusyRef.current = true;
      setRepairNotice("Repairing the game automatically...");

      try {
        const base = baseVersionId;

        // A gate failure has no candidate to boot, so it is retried inline within
        // the same budget instead of bouncing off the frame. The server enforces
        // the ceiling, so the loop bound is belt-and-braces.
        for (let step = 0; step < 4; step += 1) {
          const response = await fetch("/api/debug", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              gameId,
              versionId: base,
              error: {
                message: report.message,
                stack: report.stack,
                line: report.line,
                column: report.column,
                phase: report.phase,
              },
            }),
          });

          if (!response.ok) {
            const failure = await readFailure(response);

            // A refusal is not a repair failure, so the quota codes get their own
            // wording instead of the generic "could not be started".
            setRepairNotice(
              failure.code === "quota_exceeded"
                ? "Daily token budget reached; automatic repair resumes tomorrow."
                : failure.code === "rate_limited"
                  ? "Too many runs in a minute. Try again shortly."
                  : failure.message,
            );
            router.refresh();
            return;
          }

          const data = (await response.json()) as DebugResponse;

          if (data.status === "candidate") {
            setRepairNotice(`Applying an automatic repair (attempt ${data.attempt} of 3).`);
            setEvaluateVersionId(data.candidateVersionId);
            setBootVersionId(data.candidateVersionId);
            // The attempt was billed, so the budget bar is re-read from the server.
            router.refresh();
            return;
          }

          if (data.status === "gate_failed") {
            if (data.remaining > 0) {
              continue;
            }

            setEvaluateVersionId(null);
            setRepairNotice("Automatic repair could not produce a usable game.");
            router.refresh();
            return;
          }

          setEvaluateVersionId(null);
          setRepairNotice(
            "Automatic repair stopped after three attempts. Regenerate to start over.",
          );
          router.refresh();
          return;
        }

        // Belt-and-braces: every server status above returns from inside the
        // loop, so reaching here means the bound ran out without a terminal
        // answer. Say so rather than leaving "Repairing..." on screen forever.
        setEvaluateVersionId(null);
        setRepairNotice("Automatic repair could not be completed. Try again.");
        router.refresh();
      } catch {
        setRepairNotice("Automatic repair could not be started.");
        router.refresh();
      } finally {
        repairBusyRef.current = false;
      }
    },
    [gameId, router],
  );

  // Probation: a booted version survives PROBATION_MS of error-free execution
  // while visible and unpaused, and is then confirmed stable. The timer is torn
  // down on pause or a hidden tab, so neither can fail a healthy game.
  useEffect(() => {
    if (gameId === null || evaluateVersionId === null) {
      return;
    }

    if (bridge.status !== "running" || hidden) {
      return;
    }

    const versionId = evaluateVersionId;
    const timer = setTimeout(() => {
      void commitStability(versionId);
    }, PROBATION_MS);

    return () => clearTimeout(timer);
  }, [gameId, evaluateVersionId, bridge.status, hidden, commitStability]);

  // Repair: a runtime error, or a boot that never reached SCENE_READY, on the
  // version the frame is actually running. Anything else is a stale error from a
  // version that has already been superseded.
  useEffect(() => {
    if (gameId === null || evaluateVersionId === null) {
      return;
    }

    if (bridge.status !== "error" || evaluateVersionId !== runningVersionRef.current) {
      return;
    }

    if (bridge.lastError !== null) {
      if (handledErrorRef.current === bridge.lastError) {
        return;
      }

      handledErrorRef.current = bridge.lastError;
    } else {
      if (handledTimeoutForRef.current === evaluateVersionId) {
        return;
      }

      handledTimeoutForRef.current = evaluateVersionId;
    }

    void attemptRepair(evaluateVersionId, bridge.lastError ?? BOOT_TIMEOUT_REPORT);
  }, [gameId, evaluateVersionId, bridge.status, bridge.lastError, attemptRepair]);

  // A run must not outlive the page: navigating away cancels the fetch, which
  // fires request.signal server-side and is what makes "an aborted run persists
  // nothing" true through the UI as well as in tests.
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const startRun = useCallback(
    async (kind: "generate" | "patch") => {
      const text = instruction.trim();

      if (busyRef.current || text.length === 0 || text.length > INSTRUCTION_MAX_LENGTH) {
        return;
      }

      busyRef.current = true;
      setBusy(true);
      setFailure(null);
      setWarning(null);
      setBootError(null);
      setRepairNotice(null);
      setDoneStages([]);
      setActiveStage(null);
      setRunKind(kind);

      const controller = new AbortController();
      abortRef.current = controller;

      const isGenerate = kind === "generate";

      const result = await streamRun(
        isGenerate ? "/api/generate" : "/api/patch",
        isGenerate ? { prompt: text, gameId } : { gameId, instruction: text },
        { signal: controller.signal, onFrame: handleFrame },
      );

      abortRef.current = null;
      busyRef.current = false;
      setBusy(false);
      setActiveStage(null);
      setInstruction("");

      if (result.kind === "terminal" && result.frame.event === "run.completed") {
        const data = result.frame.data as RunCompletedData;

        if (gameId === null) {
          // A brand-new game: the workspace for it is a different route, and
          // navigating re-reads everything from the server.
          router.replace(`/studio/${data.gameId}`);
          return;
        }

        setBootVersionId(data.versionId);
        setPreviewVersionId(data.versionId);
        setEvaluateVersionId(data.versionId);
        router.refresh();
        return;
      }

      if (result.kind === "terminal") {
        const data = result.frame.data as ErrorData;

        setFailure(data.message);

        // A persisted failure already wrote the turn, so a refresh brings it
        // back. Only an unpersisted one has to be remembered here.
        if (data.versionId === null) {
          addUnpersistedTurn(text, data.message);
        }

        router.refresh();
        return;
      }

      if (result.kind === "aborted") {
        addUnpersistedTurn(text, "Stopped before the run finished.");
        return;
      }

      const note =
        result.kind === "stalled"
          ? "The run stopped responding and was cancelled."
          : result.kind === "incomplete"
            ? "The run ended without reporting a result."
            : result.message;

      setFailure(note);
      addUnpersistedTurn(text, note);
    },
    [addUnpersistedTurn, gameId, handleFrame, instruction, router],
  );

  const rollback = useCallback(
    async (versionId: string) => {
      if (gameId === null) {
        return;
      }

      setFailure(null);

      try {
        const response = await fetch(
          `/api/games/${gameId}/versions/${versionId}/rollback`,
          { method: "POST" },
        );

        if (!response.ok) {
          setFailure("That version could not be restored.");
          return;
        }

        setBootVersionId(versionId);
        setPreviewVersionId(versionId);
        setEvaluateVersionId(null);
        router.refresh();
      } catch {
        setFailure("That version could not be restored.");
      }
    },
    [gameId, router],
  );

  const preview = useCallback((versionId: string) => {
    setPreviewVersionId(versionId);
    setBootVersionId(versionId);
    // A preview is not on probation: an old version must not be marked stable by
    // watching it, and a crash in it must not trigger a repair.
    setEvaluateVersionId(null);
  }, []);

  const isPreviewingOther =
    previewVersionId !== null && previewVersionId !== currentVersionId;
  const stages = runKind === "patch" ? PATCH_STAGES : GENERATE_STAGES;
  const canSubmit = !busy && instruction.trim().length > 0;
  const isNewGame = gameId === null;

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{title ?? "New game"}</h1>
        <div className="flex flex-wrap items-center gap-4">
          <PublishControls
            gameId={gameId}
            initialIsPublic={isPublic}
            initialPublicSlug={publicSlug}
          />
          <ExportMenu
            gameId={gameId}
            title={title}
            versionId={previewVersionId ?? currentVersionId}
          />
          <QuotaBar quota={quota} />
        </div>
      </div>

      <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col gap-3">
          <div className="flex min-h-[240px] flex-col gap-3 overflow-y-auto rounded border border-black/15 p-3 dark:border-white/20">
            {messages.length === 0 && unpersisted.length === 0 ? (
              <p className="text-sm opacity-70">
                Describe the game you want. You can keep editing it here afterwards.
              </p>
            ) : null}

            {messages.map((message) => (
              <div key={message.id} className="text-sm">
                <span className="font-medium">
                  {message.role === "user" ? "You" : "GameForge"}
                </span>
                <p className="whitespace-pre-wrap">{message.content}</p>
              </div>
            ))}

            {unpersisted.map((turn) => (
              <div key={turn.id} className="text-sm opacity-80">
                <span className="font-medium">You</span>
                <p className="whitespace-pre-wrap">{turn.instruction}</p>
                <p className="text-xs opacity-70">{turn.note}</p>
              </div>
            ))}
          </div>

          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void startRun(isNewGame ? "generate" : "patch");
            }}
          >
            <label className="text-sm font-medium" htmlFor="studio-instruction">
              {isNewGame ? "Describe your game" : "Ask for a change"}
            </label>
            <textarea
              id="studio-instruction"
              className="min-h-[80px] rounded border border-black/15 p-2 text-sm dark:border-white/20"
              maxLength={INSTRUCTION_MAX_LENGTH}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              disabled={busy}
              placeholder={
                isNewGame
                  ? "A side-scrolling runner where a fox collects coins"
                  : "Make the player move twice as fast"
              }
            />
            <div className="flex items-center gap-2">
              <button type="submit" className={buttonClassName} disabled={!canSubmit}>
                {isNewGame ? "Generate" : "Apply change"}
              </button>
              <button
                type="button"
                className={buttonClassName}
                disabled={!busy}
                onClick={() => abortRef.current?.abort()}
              >
                Stop
              </button>
              <span className="text-sm opacity-70">
                {instruction.length}/{INSTRUCTION_MAX_LENGTH}
              </span>
            </div>
          </form>

          {runKind === null ? null : (
            <AgentStepper
              steps={stageSteps(stages, doneStages, activeStage)}
              warning={warning}
            />
          )}

          {failure === null ? null : (
            <p className="text-sm text-red-600 dark:text-red-400">{failure}</p>
          )}

          {repairNotice === null ? null : (
            <p className="text-sm text-amber-600 dark:text-amber-400">{repairNotice}</p>
          )}
        </section>

        <section className="flex min-h-0 flex-col gap-3">
          <div className="h-[360px] overflow-hidden rounded border border-black/15 bg-[#0b1020] dark:border-white/20">
            <SandboxFrame frameRef={bridge.frameRef} onLoad={bridge.handleFrameLoad} />
          </div>

          <RuntimeControls bridge={bridge} />

          {isPreviewingOther ? (
            <p className="text-xs opacity-70">
              Previewing an older version. Edits still apply to the current version.
            </p>
          ) : null}

          {bridge.bootTimedOut ? (
            <p className="text-sm text-red-600 dark:text-red-400">
              The game did not start within ten seconds.
            </p>
          ) : null}

          {bootError === null ? null : (
            <p className="text-sm text-red-600 dark:text-red-400">{bootError}</p>
          )}

          {bridge.lastError === null ? null : (
            <p className="text-sm text-red-600 dark:text-red-400">
              {bridge.lastError.phase}: {bridge.lastError.message}
            </p>
          )}

          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Versions</h2>
            <VersionTimeline
              versions={versions}
              currentVersionId={currentVersionId}
              previewVersionId={previewVersionId}
              busy={busy}
              onPreview={preview}
              onRollback={(versionId) => void rollback(versionId)}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
