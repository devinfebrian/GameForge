"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GenerationStage } from "@/lib/agents/types";
import { streamRun, type RunStreamResult } from "@/lib/pipeline/client";
import type {
  ErrorData,
  RunCompletedData,
  SseFrame,
  StageCompletedData,
  StageStartedData,
  WarningData,
} from "@/lib/pipeline/events";

export const INSTRUCTION_MAX_LENGTH = 2000;
export const BUSY_TIMEOUT_MS = 330_000; // 5 min 30 s safety net

export interface UnpersistedTurn {
  readonly id: number;
  readonly instruction: string;
  readonly note: string;
}

export interface UsePipelineRunOptions {
  readonly gameId: string | null;
  readonly onRunCompleted?: (data: RunCompletedData) => void;
  readonly onRunFailed?: () => void;
}

export interface UsePipelineRunReturn {
  readonly busy: boolean;
  readonly runKind: "generate" | "patch" | null;
  readonly activeStage: GenerationStage | null;
  readonly doneStages: ReadonlyArray<GenerationStage>;
  readonly warning: string | null;
  readonly failure: string | null;
  readonly unpersisted: ReadonlyArray<UnpersistedTurn>;
  readonly startRun: (kind: "generate" | "patch", text: string) => Promise<void>;
  readonly cancelRun: () => void;
  readonly clearFailure: () => void;
}

export function mapActionableMessage(error: { readonly code?: string | null; readonly message: string }): string {
  if (error.code === "run_in_progress") {
    return "A previous run is still in progress. Please wait a moment, then try again. If this persists, refresh the page.";
  }
  if (error.code === "rate_limited" || error.code === "quota_exceeded") {
    return "You've hit the rate limit. Please wait a minute before trying again.";
  }
  if (error.code === "unauthorized") {
    return "Your session has expired. Please sign in again.";
  }
  return error.message;
}

export function formatRunFailure(result: Exclude<RunStreamResult, { kind: "terminal" } | { kind: "aborted" }>): string {
  if (result.kind === "stalled") {
    return "The server stopped responding (timed out). Check your internet connection, then try again.";
  }
  if (result.kind === "incomplete") {
    return "The connection was interrupted before the run finished. Please try again.";
  }
  if (result.kind === "http_error") {
    if (result.status === 409) return "A run is already in progress. Please wait a moment, then try again.";
    if (result.status === 401) return "Your session has expired. Please sign in again.";
    if (result.status === 429) return "Rate limited. Please wait a moment, then try again.";
  }
  return result.message;
}

export function usePipelineRun(options: UsePipelineRunOptions): UsePipelineRunReturn {
  const { gameId, onRunCompleted, onRunFailed } = options;

  const [busy, setBusy] = useState(false);
  const [runKind, setRunKind] = useState<"generate" | "patch" | null>(null);
  const [activeStage, setActiveStage] = useState<GenerationStage | null>(null);
  const [doneStages, setDoneStages] = useState<ReadonlyArray<GenerationStage>>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [unpersisted, setUnpersisted] = useState<ReadonlyArray<UnpersistedTurn>>([]);

  const abortRef = useRef<AbortController | null>(null);
  const timeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turnIdRef = useRef(0);

  const addUnpersistedTurn = useCallback((text: string, note: string) => {
    turnIdRef.current += 1;
    const id = turnIdRef.current;
    setUnpersisted((current) => [...current, { id, instruction: text, note }]);
  }, []);

  const clearTimeoutTimer = useCallback(() => {
    if (timeoutIdRef.current !== null) {
      clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = null;
    }
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

  const cancelRun = useCallback(() => {
    clearTimeoutTimer();
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setActiveStage(null);
  }, [clearTimeoutTimer]);

  const clearFailure = useCallback(() => {
    setFailure(null);
  }, []);

  const startRun = useCallback(
    async (kind: "generate" | "patch", promptText: string) => {
      const text = promptText.trim();
      if (text.length === 0 || text.length > INSTRUCTION_MAX_LENGTH) {
        return;
      }

      // If already running, cancel previous
      if (abortRef.current !== null) {
        abortRef.current.abort();
      }

      setBusy(true);
      setFailure(null);
      setWarning(null);
      setDoneStages([]);
      setActiveStage(null);
      setRunKind(kind);

      const controller = new AbortController();
      abortRef.current = controller;

      clearTimeoutTimer();
      timeoutIdRef.current = setTimeout(() => {
        controller.abort();
        setBusy(false);
        setActiveStage(null);
        setFailure("The previous run timed out without a response. You can try submitting again.");
      }, BUSY_TIMEOUT_MS);

      const isGenerate = kind === "generate";

      try {
        const result = await streamRun(
          isGenerate ? "/api/generate" : "/api/patch",
          isGenerate ? { prompt: text, gameId } : { gameId, instruction: text },
          { signal: controller.signal, onFrame: handleFrame },
        );

        clearTimeoutTimer();
        abortRef.current = null;
        setBusy(false);
        setActiveStage(null);

        if (result.kind === "terminal" && result.frame.event === "run.completed") {
          const data = result.frame.data as RunCompletedData;
          onRunCompleted?.(data);
          return;
        }

        if (result.kind === "terminal") {
          const data = result.frame.data as ErrorData;
          const message = mapActionableMessage(data);
          setFailure(message);
          if (data.versionId === null) {
            addUnpersistedTurn(text, message);
          }
          onRunFailed?.();
          return;
        }

        if (result.kind === "aborted") {
          addUnpersistedTurn(text, "Stopped before the run finished.");
          return;
        }

        const note = formatRunFailure(result);
        setFailure(note);
        addUnpersistedTurn(text, note);
        onRunFailed?.();
      } catch (err: unknown) {
        clearTimeoutTimer();
        abortRef.current = null;
        setBusy(false);
        setActiveStage(null);
        const message = err instanceof Error ? err.message : "Request failed.";
        setFailure(message);
        addUnpersistedTurn(text, message);
        onRunFailed?.();
      }
    },
    [addUnpersistedTurn, clearTimeoutTimer, gameId, handleFrame, onRunCompleted, onRunFailed],
  );

  // Clean up abort controller and timers on unmount
  useEffect(() => {
    return () => {
      clearTimeoutTimer();
      abortRef.current?.abort();
    };
  }, [clearTimeoutTimer]);

  return {
    busy,
    runKind,
    activeStage,
    doneStages,
    warning,
    failure,
    unpersisted,
    startRun,
    cancelRun,
    clearFailure,
  };
}
