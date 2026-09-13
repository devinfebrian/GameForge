"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SandboxFrame } from "@/app/_components/SandboxFrame";
import type { GenerationStage } from "@/lib/agents/types";
import type { TranscriptMessage, VersionSummary } from "@/lib/games/repository";
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
  readonly versions: ReadonlyArray<VersionSummary>;
  readonly messages: ReadonlyArray<TranscriptMessage>;
}

export function StudioWorkspace({
  gameId,
  title,
  currentVersionId,
  versions,
  messages,
}: StudioWorkspaceProps) {
  const router = useRouter();
  const bridge = useSandboxBridge();
  const { loadCode, ready } = bridge;

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

  const abortRef = useRef<AbortController | null>(null);
  // Guards against a double submit landing before React has re-rendered the
  // disabled button. The server would answer 409 anyway; this keeps the UI from
  // ever showing two runs.
  const busyRef = useRef(false);
  const bootedRef = useRef<string | null>(null);
  const turnIdRef = useRef(0);

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

      try {
        const response = await fetch(`/api/games/${gameId}/versions/${versionId}`);

        if (!response.ok) {
          setBootError("This version could not be loaded.");
          return;
        }

        const payload = (await response.json()) as BootPayload;

        if (!payload.bootable) {
          setBootError(payload.bootReason ?? "This version cannot be run.");
          return;
        }

        loadCode(payload.sourceCode, payload.assetManifest);
      } catch {
        setBootError("This version could not be loaded.");
      }
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
