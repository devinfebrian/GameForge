# Studio Workspace Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose the 1,493-line monolithic `StudioWorkspace.tsx` component into focused stream and preview adapter hooks (`usePipelineRun`, `usePreviewSync`) and modular UI panes (`StudioChatPane`, `StudioPreviewPane`, `StudioCodePane`), turning `StudioWorkspace.tsx` into a lightweight ~250-line layout shell and eliminating React hook lint errors.

**Architecture:** 
- Extract SSE connection lifecycle, abort handling, stage transitions, and error translation into `app/studio/_hooks/usePipelineRun.ts`.
- Extract preview snapshot fetching, exponential boot retry backoff, sandbox bridge sync, and probation stability into `app/studio/_hooks/usePreviewSync.ts`.
- Split UI presentation into `StudioChatPane.tsx`, `StudioPreviewPane.tsx`, and `StudioCodePane.tsx`.
- Refactor `StudioWorkspace.tsx` to serve as a pure layout orchestrator shell.

**Tech Stack:** Next.js 16 (App Router), React 19 ("use client"), TypeScript 5, Bun Test, Tailwind CSS, Lucide icons, AgentUI primitives.

**Spec:** [`docs/superpowers/specs/2026-09-18-studio-workspace-adapters-design.md`](file:///C:/Users/USER/Portofolio/GameForge/docs/superpowers/specs/2026-09-18-studio-workspace-adapters-design.md)

## Global Constraints
- Target: Next.js 16 App Router client components (`"use client"`).
- Strict TypeScript: No `any` (use `unknown`, generics, or proper types), strict null checks, immutable where practical.
- Do NOT build on local environment (e.g. `bun run build`). Use `bun test` and `bun run check-types`.
- ESLint: Code MUST pass `bun run eslint app/studio` with 0 errors and 0 warnings.
- Backward compatibility: Preserve 100% of existing user-facing functionality, AgentUI component rendering, and sandbox bridge protocol.

---

### Task 1: Extract Diff Calculation Utilities & Tests

**Files:**
- Create: `app/studio/_lib/diff.ts`
- Test: `app/studio/_lib/diff.test.ts`

**Interfaces:**
- Produces: `computeDiffLines(oldCode: string | null, newCode: string): FileDiffLine[]`

- [ ] **Step 1: Write the failing unit tests for `computeDiffLines`**

Create `app/studio/_lib/diff.test.ts`:
```typescript
import { describe, expect, test } from "bun:test";
import { computeDiffLines } from "./diff";

describe("computeDiffLines", () => {
  test("returns added lines when oldCode is null", () => {
    const code = "line 1\nline 2\nline 3";
    const diff = computeDiffLines(null, code);

    expect(diff.length).toBe(3);
    expect(diff[0]).toEqual({
      id: "add-0",
      type: "added",
      newLine: 1,
      content: "line 1",
    });
  });

  test("computes removals and additions between versions", () => {
    const oldCode = "line 1\nline 2\nline 3";
    const newCode = "line 1\nline modified\nline 3";
    const diff = computeDiffLines(oldCode, newCode);

    expect(diff).toEqual([
      { id: "rem-1", type: "removed", oldLine: 2, content: "line 2" },
      { id: "add-1", type: "added", newLine: 2, content: "line modified" },
    ]);
  });

  test("returns context lines when oldCode and newCode are identical", () => {
    const code = "line 1\nline 2";
    const diff = computeDiffLines(code, code);

    expect(diff.length).toBe(2);
    expect(diff[0].type).toBe("context");
    expect(diff[0].content).toBe("line 1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test app/studio/_lib/diff.test.ts`  
Expected: FAIL with module not found `app/studio/_lib/diff`.

- [ ] **Step 3: Implement `computeDiffLines` in `app/studio/_lib/diff.ts`**

Create `app/studio/_lib/diff.ts`:
```typescript
import type { FileDiffLine } from "@/components/agents/file-diff";

export function computeDiffLines(
  oldCode: string | null,
  newCode: string,
): FileDiffLine[] {
  if (!oldCode) {
    return newCode.split("\n").slice(0, 30).map((content, idx) => ({
      id: `add-${idx}`,
      type: "added" as const,
      newLine: idx + 1,
      content,
    }));
  }
  const oldLines = oldCode.split("\n");
  const newLines = newCode.split("\n");
  const diffs: FileDiffLine[] = [];
  const max = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < max && diffs.length < 50; i++) {
    const o = oldLines[i];
    const n = newLines[i];
    if (o !== n) {
      if (o !== undefined) {
        diffs.push({
          id: `rem-${i}`,
          type: "removed",
          oldLine: i + 1,
          content: o,
        });
      }
      if (n !== undefined) {
        diffs.push({
          id: `add-${i}`,
          type: "added",
          newLine: i + 1,
          content: n,
        });
      }
    }
  }
  return diffs.length > 0
    ? diffs
    : newLines.slice(0, 10).map((content, idx) => ({
        id: `ctx-${idx}`,
        type: "context" as const,
        newLine: idx + 1,
        content,
      }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test app/studio/_lib/diff.test.ts`  
Expected: PASS (3 tests pass).

---

### Task 2: Implement `usePipelineRun` Hook & Unit Tests

**Files:**
- Create: `app/studio/_hooks/usePipelineRun.ts`
- Test: `app/studio/_hooks/usePipelineRun.test.ts`

**Interfaces:**
- Consumes: `streamRun` (`lib/pipeline/client.ts`), `SseFrame`, `GenerationStage`
- Produces: `usePipelineRun(options: UsePipelineRunOptions): UsePipelineRunReturn`

- [ ] **Step 1: Write failing unit tests for `usePipelineRun`**

Create `app/studio/_hooks/usePipelineRun.test.ts`:
```typescript
import { describe, expect, test } from "bun:test";
import { formatRunFailure, mapActionableMessage } from "./usePipelineRun";

describe("usePipelineRun helpers", () => {
  test("mapActionableMessage translates server error codes to helpful user guidance", () => {
    expect(mapActionableMessage({ code: "run_in_progress", message: "busy" })).toContain(
      "A previous run is still in progress",
    );
    expect(mapActionableMessage({ code: "rate_limited", message: "slow down" })).toContain(
      "You've hit the rate limit",
    );
    expect(mapActionableMessage({ code: "quota_exceeded", message: "out of tokens" })).toContain(
      "You've hit the rate limit",
    );
    expect(mapActionableMessage({ code: "unauthorized", message: "login" })).toContain(
      "Your session has expired",
    );
    expect(mapActionableMessage({ code: "internal", message: "Unexpected crash" })).toBe(
      "Unexpected crash",
    );
  });

  test("formatRunFailure formats stream termination status", () => {
    expect(formatRunFailure({ kind: "stalled" })).toContain("The server stopped responding");
    expect(formatRunFailure({ kind: "incomplete" })).toContain("connection was interrupted");
    expect(formatRunFailure({ kind: "http_error", status: 409, message: "" })).toContain(
      "A run is already in progress",
    );
    expect(formatRunFailure({ kind: "http_error", status: 401, message: "" })).toContain(
      "Your session has expired",
    );
    expect(formatRunFailure({ kind: "http_error", status: 429, message: "" })).toContain(
      "Rate limited",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test app/studio/_hooks/usePipelineRun.test.ts`  
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `usePipelineRun.ts`**

Create `app/studio/_hooks/usePipelineRun.ts`:
```typescript
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GenerationStage } from "@/lib/agents/types";
import { streamRun, type StreamRunResult } from "@/lib/pipeline/client";
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

export function formatRunFailure(result: Exclude<StreamRunResult, { kind: "terminal" } | { kind: "aborted" }>): string {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test app/studio/_hooks/usePipelineRun.test.ts`  
Expected: PASS (2 tests pass).

---

### Task 3: Implement `usePreviewSync` Hook & Unit Tests

**Files:**
- Create: `app/studio/_hooks/usePreviewSync.ts`
- Test: `app/studio/_hooks/usePreviewSync.test.ts`

**Interfaces:**
- Consumes: `useSandboxBridge` return type (`SandboxBridge`)
- Produces: `usePreviewSync(options: UsePreviewSyncOptions): UsePreviewSyncReturn`

- [ ] **Step 1: Write failing unit tests for `usePreviewSync` helpers**

Create `app/studio/_hooks/usePreviewSync.test.ts`:
```typescript
import { describe, expect, test } from "bun:test";
import { parseBootFailure } from "./usePreviewSync";

describe("usePreviewSync helpers", () => {
  test("parseBootFailure handles unbootable payload message", () => {
    expect(parseBootFailure(null, "Scene failed boot gate.")).toBe("Scene failed boot gate.");
    expect(parseBootFailure(null, null)).toBe("This version cannot be run.");
  });

  test("parseBootFailure handles HTTP error codes", () => {
    expect(parseBootFailure(404, null)).toBe("This version could not be loaded (HTTP 404).");
    expect(parseBootFailure(500, null)).toBe("This version could not be loaded (HTTP 500).");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test app/studio/_hooks/usePreviewSync.test.ts`  
Expected: FAIL with module not found.

- [ ] **Step 3: Implement `usePreviewSync.ts`**

Create `app/studio/_hooks/usePreviewSync.ts`:
```typescript
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { useSandboxBridge } from "@/lib/sandbox/useSandboxBridge";

export type SandboxBridge = ReturnType<typeof useSandboxBridge>;

export const PROBATION_MS = 3000;
export const BOOT_ATTEMPTS = 3;
export const BOOT_RETRY_DELAY_MS = 400;

export interface BootPayload {
  readonly sourceCode: string;
  readonly assetManifest: Record<string, string>;
  readonly bootable: boolean;
  readonly bootReason: string | null;
  readonly previewUrl: string | null;
}

export interface UsePreviewSyncOptions {
  readonly gameId: string | null;
  readonly currentVersionId: string | null;
  readonly bridge: SandboxBridge;
}

export interface UsePreviewSyncReturn {
  readonly bootVersionId: string | null;
  readonly previewVersionId: string | null;
  readonly isPreviewingOther: boolean;
  readonly bootError: string | null;
  readonly sourceCode: string | null;
  readonly previousSourceCode: string | null;
  readonly assetManifest: Record<string, string>;
  readonly previewOpen: boolean;
  readonly previewExpanded: boolean;
  readonly openPreview: () => void;
  readonly closePreview: () => void;
  readonly togglePreview: () => void;
  readonly setPreviewExpanded: (expanded: boolean) => void;
  readonly previewVersion: (versionId: string) => void;
  readonly rollbackVersion: (versionId: string) => Promise<boolean>;
  readonly switchVersionAfterRun: (versionId: string) => void;
  readonly reloadCurrentVersion: () => void;
}

export function parseBootFailure(status: number | null, reason: string | null): string {
  if (reason !== null) {
    return reason;
  }
  if (status !== null) {
    return `This version could not be loaded (HTTP ${status}).`;
  }
  return "This version cannot be run.";
}

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

export function usePreviewSync(options: UsePreviewSyncOptions): UsePreviewSyncReturn {
  const { gameId, currentVersionId, bridge } = options;
  const { loadPreview, ready, status } = bridge;
  const router = useRouter();
  const hidden = useDocumentHidden();

  const [bootVersionId, setBootVersionId] = useState<string | null>(currentVersionId);
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(currentVersionId);
  const [evaluateVersionId, setEvaluateVersionId] = useState<string | null>(currentVersionId);

  const [loadedSourceCode, setLoadedSourceCode] = useState<string | null>(null);
  const [previousSourceCode, setPreviousSourceCode] = useState<string | null>(null);
  const [loadedAssetManifest, setLoadedAssetManifest] = useState<Record<string, string>>({});
  const [bootError, setBootError] = useState<string | null>(null);

  const [userPreviewOpen, setUserPreviewOpen] = useState<boolean | null>(null);
  const [previewExpanded, setPreviewExpanded] = useState(false);

  const bootedRef = useRef<string | null>(null);

  const previewOpen = userPreviewOpen ?? (status === "running");

  const openPreview = useCallback(() => {
    setUserPreviewOpen(true);
  }, []);

  const closePreview = useCallback(() => {
    setPreviewExpanded(false);
    setUserPreviewOpen(false);
  }, []);

  const togglePreview = useCallback(() => {
    setUserPreviewOpen((current) => !(current ?? (status === "running")));
  }, [status]);

  const boot = useCallback(
    async (versionId: string) => {
      setBootError(null);
      let lastStatus: number | null = null;

      for (let attempt = 1; attempt <= BOOT_ATTEMPTS; attempt += 1) {
        try {
          const response = await fetch(`/api/games/${gameId}/versions/${versionId}`);

          if (response.ok) {
            const payload = (await response.json()) as BootPayload;

            if (!payload.bootable) {
              setBootError(parseBootFailure(null, payload.bootReason));
              return;
            }

            setLoadedSourceCode((prev) => {
              setPreviousSourceCode(prev);
              return payload.sourceCode;
            });
            setLoadedAssetManifest(payload.assetManifest ?? {});

            if (payload.previewUrl === null) {
              setBootError("Isolated previews are not configured (NEXT_PUBLIC_PREVIEW_ORIGIN).");
              return;
            }

            loadPreview(payload.previewUrl);
            return;
          }

          lastStatus = response.status;
          if (response.status < 500) {
            setBootError(`This version could not be loaded (HTTP ${response.status}).`);
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
    [gameId, loadPreview],
  );

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
      if (gameId === null) return;

      try {
        await fetch(`/api/games/${gameId}/versions/${versionId}/stability`, {
          method: "PATCH",
        });
      } catch {
        // Best effort
      }

      setEvaluateVersionId((current) => (current === versionId ? null : current));
      router.refresh();
    },
    [gameId, router],
  );

  // Probation timer: commit stability after running continuously for PROBATION_MS
  useEffect(() => {
    if (gameId === null || evaluateVersionId === null) return;
    if (status !== "running" || hidden) return;

    const versionId = evaluateVersionId;
    const timer = setTimeout(() => {
      void commitStability(versionId);
    }, PROBATION_MS);

    return () => clearTimeout(timer);
  }, [gameId, evaluateVersionId, status, hidden, commitStability]);

  // Handle Escape key when preview is expanded
  useEffect(() => {
    if (!previewExpanded) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPreviewExpanded(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewExpanded]);

  const previewVersion = useCallback((versionId: string) => {
    setUserPreviewOpen(true);
    setPreviewVersionId(versionId);
    setBootVersionId(versionId);
    setEvaluateVersionId(null);
  }, []);

  const rollbackVersion = useCallback(
    async (versionId: string): Promise<boolean> => {
      if (gameId === null) return false;

      try {
        const response = await fetch(
          `/api/games/${gameId}/versions/${versionId}/rollback`,
          { method: "POST" },
        );

        if (!response.ok) {
          return false;
        }

        setBootVersionId(versionId);
        setPreviewVersionId(versionId);
        setEvaluateVersionId(null);
        router.refresh();
        return true;
      } catch {
        return false;
      }
    },
    [gameId, router],
  );

  const switchVersionAfterRun = useCallback((versionId: string) => {
    setBootVersionId(versionId);
    setPreviewVersionId(versionId);
    setEvaluateVersionId(versionId);
    setUserPreviewOpen(null);
  }, []);

  const reloadCurrentVersion = useCallback(() => {
    if (bootVersionId !== null) {
      bootedRef.current = null;
      void boot(bootVersionId);
    }
  }, [boot, bootVersionId]);

  const isPreviewingOther =
    previewVersionId !== null && previewVersionId !== currentVersionId;

  return {
    bootVersionId,
    previewVersionId,
    isPreviewingOther,
    bootError,
    sourceCode: loadedSourceCode,
    previousSourceCode,
    assetManifest: loadedAssetManifest,
    previewOpen,
    previewExpanded,
    openPreview,
    closePreview,
    togglePreview,
    setPreviewExpanded,
    previewVersion,
    rollbackVersion,
    switchVersionAfterRun,
    reloadCurrentVersion,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test app/studio/_hooks/usePreviewSync.test.ts`  
Expected: PASS (2 tests pass).

---

### Task 4: Implement `StudioChatPane.tsx`

**Files:**
- Create: `app/studio/_components/StudioChatPane.tsx`

**Interfaces:**
- Consumes: `TranscriptMessage`, `UnpersistedTurn`, `GenerationStage`, AgentUI components
- Produces: `StudioChatPane(props: StudioChatPaneProps)`

- [ ] **Step 1: Create `StudioChatPane.tsx`**

Create `app/studio/_components/StudioChatPane.tsx`:
```typescript
"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Rocket, Zap, Compass, Layers } from "lucide-react";
import {
  Message,
  MessageAvatar,
  MessageBubble,
  MessageBubbleContent,
  MessageContent,
  MessageHeader,
} from "@/components/agents/message";
import { PromptInput } from "@/components/agents/prompt-input";
import { TodoList } from "@/components/agents/todo-list";
import { ToolResult, ToolResultOutput } from "@/components/agents/tool-result";
import { CodeBlock } from "@/components/agents/code-block";
import { Citations, type CitationItem } from "@/components/agents/citations";
import { StreamingResponse } from "@/components/agents/streaming-response";
import type { GenerationStage } from "@/lib/agents/types";
import type { TranscriptMessage } from "@/lib/games/repository";
import type { UnpersistedTurn } from "../_hooks/usePipelineRun";
import { INSTRUCTION_MAX_LENGTH } from "../_hooks/usePipelineRun";

export const STARTER_PROMPTS = [
  {
    icon: Rocket,
    title: "Space Combat",
    desc: "Inertial arcade ship fighting asteroids and drones with particle bursts",
    prompt:
      "A retro space combat game where a starship shoots asteroids, collects energy cells, and dodges enemy drones with Arcade physics.",
  },
  {
    icon: Zap,
    title: "Endless Runner",
    desc: "Fast-paced side-scrolling platformer with jump timing and pickups",
    prompt:
      "A side-scrolling endless runner where a character leaps over obstacles, slides under barriers, and gathers energy coins.",
  },
  {
    icon: Compass,
    title: "Dungeon Explorer",
    desc: "Top-down labyrinth navigation, key collection, and hazards",
    prompt:
      "A top-down dungeon crawler where an adventurer navigates mysterious chambers, avoids traps, gathers keys, and unlocks the portal.",
  },
  {
    icon: Layers,
    title: "Arcade Breakout",
    desc: "Paddle bounce physics, destructible blocks, and score chains",
    prompt:
      "A classic arcade brick-breaker game with paddle controls, bounce physics, score combos, and multiball mechanics.",
  },
] as const;

export const PROMPT_MODELS = [
  { value: "claude-sonnet-5", label: "Claude Sonnet 5 (Default)" },
  { value: "claude-3-7-sonnet", label: "Claude 3.7 Sonnet" },
  { value: "claude-3-5-sonnet", label: "Claude 3.5 Sonnet" },
];

export const GAME_SOURCES: CitationItem[] = [
  {
    id: "kenney-assets",
    title: "Kenney 2D Game Assets (CC0 Public Domain)",
    domain: "kenney.nl",
    url: "https://kenney.nl/assets",
  },
  {
    id: "phaser-engine",
    title: "Phaser 4 Game Framework API",
    domain: "phaser.io",
    url: "https://phaser.io/phaser4",
  },
  {
    id: "web-audio",
    title: "Web Audio Synthesizer Presets",
    domain: "developer.mozilla.org",
    url: "https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API",
  },
];

const GENERATE_STAGES: ReadonlyArray<{ id: GenerationStage; label: string }> = [
  { id: "spec", label: "Spec" },
  { id: "asset_mapper", label: "Assets" },
  { id: "coder", label: "Coder" },
];

const PATCH_STAGES: ReadonlyArray<{ id: GenerationStage; label: string }> = [
  { id: "asset_mapper", label: "Assets" },
  { id: "coder", label: "Coder" },
];

export interface StudioChatPaneProps {
  readonly messages: ReadonlyArray<TranscriptMessage>;
  readonly unpersisted: ReadonlyArray<UnpersistedTurn>;
  readonly busy: boolean;
  readonly runKind: "generate" | "patch" | null;
  readonly activeStage: GenerationStage | null;
  readonly doneStages: ReadonlyArray<GenerationStage>;
  readonly failure: string | null;
  readonly warning: string | null;
  readonly isNewGame: boolean;
  readonly onStartRun: (kind: "generate" | "patch", text: string) => Promise<void>;
  readonly onCancelRun: () => void;
}

export function StudioChatPane({
  messages,
  unpersisted,
  busy,
  runKind,
  activeStage,
  doneStages,
  failure,
  warning,
  isNewGame,
  onStartRun,
  onCancelRun,
}: StudioChatPaneProps) {
  const [instruction, setInstruction] = useState("");
  const [selectedModel, setSelectedModel] = useState("claude-sonnet-5");
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, unpersisted, activeStage, failure]);

  const stages = runKind === "patch" ? PATCH_STAGES : GENERATE_STAGES;

  const handleSubmit = async () => {
    const text = instruction.trim();
    if (text.length === 0 || busy) return;
    setInstruction("");
    await onStartRun(isNewGame ? "generate" : "patch", text);
  };

  return (
    <div className="flex h-full flex-col border-r border-border bg-card">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Messages transcript */}
        {messages.map((m) => (
          <Message key={m.id} role={m.role === "assistant" ? "assistant" : "user"}>
            <MessageAvatar
              fallback={m.role === "assistant" ? "AI" : "U"}
              className={m.role === "assistant" ? "bg-primary/20 text-primary" : "bg-muted text-foreground"}
            />
            <MessageContent>
              <MessageHeader
                sender={m.role === "assistant" ? "GameForge Agent" : "You"}
                timestamp={new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              />
              <MessageBubble variant={m.role === "assistant" ? "bubble" : "flat"}>
                <MessageBubbleContent>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</p>
                </MessageBubbleContent>
              </MessageBubble>
            </MessageContent>
          </Message>
        ))}

        {/* Unpersisted turns */}
        {unpersisted.map((turn) => (
          <div key={`turn-${turn.id}`} className="space-y-2 opacity-80">
            <Message role="user">
              <MessageAvatar fallback="U" />
              <MessageContent>
                <MessageHeader sender="You" timestamp="Unsaved" />
                <MessageBubble variant="flat">
                  <MessageBubbleContent>
                    <p className="text-sm">{turn.instruction}</p>
                  </MessageBubbleContent>
                </MessageBubble>
              </MessageContent>
            </Message>
            <div className="rounded-lg border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
              {turn.note}
            </div>
          </div>
        ))}

        {/* Live streaming agent state */}
        {busy && (
          <Message role="assistant">
            <MessageAvatar fallback="AI" className="bg-primary/20 text-primary" />
            <MessageContent>
              <MessageHeader sender="GameForge Agent" timestamp="Live" />
              <MessageBubble variant="bubble">
                <MessageBubbleContent className="space-y-3">
                  <StreamingResponse isComplete={false}>
                    {activeStage ? `Building ${activeStage}...` : "Preparing generation run..."}
                  </StreamingResponse>

                  <TodoList
                    title="Agent Pipeline"
                    items={stages.map((stage) => {
                      const isDone = doneStages.includes(stage.id);
                      const isActive = activeStage === stage.id;
                      return {
                        id: stage.id,
                        title: stage.label,
                        status: isDone ? "completed" : isActive ? "in-progress" : "pending",
                      };
                    })}
                  />
                </MessageBubbleContent>
              </MessageBubble>
            </MessageContent>
          </Message>
        )}

        {/* Warning & Failure alerts */}
        {warning && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
            <AlertCircle className="size-4 shrink-0" />
            <span>{warning}</span>
          </div>
        )}

        {failure && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive-foreground">
            <AlertCircle className="size-4 shrink-0" />
            <span>{failure}</span>
          </div>
        )}

        <div ref={chatBottomRef} />
      </div>

      {/* Footer prompt input */}
      <div className="border-t border-border bg-card p-4 space-y-3">
        {messages.length === 0 && unpersisted.length === 0 && (
          <div className="grid grid-cols-2 gap-2 pb-2">
            {STARTER_PROMPTS.map((starter) => {
              const Icon = starter.icon;
              return (
                <button
                  key={starter.title}
                  type="button"
                  onClick={() => setInstruction(starter.prompt)}
                  className="flex items-start gap-2.5 rounded-lg border border-border bg-secondary/50 p-2.5 text-left text-xs transition-colors hover:bg-secondary hover:border-primary/40"
                >
                  <Icon className="size-4 text-primary shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold text-foreground">{starter.title}</div>
                    <div className="text-[11px] text-muted-foreground line-clamp-1">{starter.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <PromptInput
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onSubmit={handleSubmit}
          placeholder={
            isNewGame
              ? "Describe the game you want to build (e.g. A space shooter with Arcade physics)..."
              : "Describe what you want to change or add..."
          }
          disabled={busy}
          maxLength={INSTRUCTION_MAX_LENGTH}
        />
      </div>
    </div>
  );
}
```

---

### Task 5: Implement `StudioPreviewPane.tsx`

**Files:**
- Create: `app/studio/_components/StudioPreviewPane.tsx`

**Interfaces:**
- Consumes: `PreviewFrame`, `RuntimeControls`, `SandboxBridge`
- Produces: `StudioPreviewPane(props: StudioPreviewPaneProps)`

- [ ] **Step 1: Create `StudioPreviewPane.tsx`**

Create `app/studio/_components/StudioPreviewPane.tsx`:
```typescript
"use client";

import { AlertCircle, History, Maximize2, Minimize2, X } from "lucide-react";
import { PreviewFrame } from "@/app/_components/PreviewFrame";
import type { SandboxBridge } from "../_hooks/usePreviewSync";
import { RuntimeControls } from "./RuntimeControls";

export interface StudioPreviewPaneProps {
  readonly bridge: SandboxBridge;
  readonly previewVersionId: string | null;
  readonly currentVersionId: string | null;
  readonly isPreviewingOther: boolean;
  readonly bootError: string | null;
  readonly expanded: boolean;
  readonly onToggleExpand: () => void;
  readonly onClose: () => void;
  readonly onRollback: (versionId: string) => Promise<boolean>;
  readonly onReload: () => void;
}

export function StudioPreviewPane({
  bridge,
  previewVersionId,
  currentVersionId,
  isPreviewingOther,
  bootError,
  expanded,
  onToggleExpand,
  onClose,
  onRollback,
  onReload,
}: StudioPreviewPaneProps) {
  return (
    <div className="flex h-full flex-col bg-background relative">
      {/* Top action toolbar */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border bg-card/60 px-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground">Live Game Preview</span>
          {isPreviewingOther && previewVersionId && (
            <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-400 border border-amber-500/20">
              <History className="size-3" />
              Previewing past version
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {isPreviewingOther && previewVersionId && (
            <button
              type="button"
              onClick={() => void onRollback(previewVersionId)}
              className="rounded bg-primary/20 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/30"
            >
              Restore this version
            </button>
          )}

          <button
            type="button"
            onClick={onToggleExpand}
            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            title={expanded ? "Exit fullscreen (Esc)" : "Expand fullscreen"}
          >
            {expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            title="Close preview"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Boot error overlay */}
      {bootError && (
        <div className="m-3 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive-foreground">
          <AlertCircle className="size-4 shrink-0" />
          <span>{bootError}</span>
        </div>
      )}

      {/* Frame canvas */}
      <div className="flex-1 min-h-0 relative flex items-center justify-center bg-slate-950">
        <PreviewFrame frameRef={bridge.frameRef} />
      </div>

      {/* Bottom controls */}
      <div className="border-t border-border bg-card/60 p-2">
        <RuntimeControls
          bridge={bridge}
          onRestart={onReload}
        />
      </div>
    </div>
  );
}
```

---

### Task 6: Implement `StudioCodePane.tsx`

**Files:**
- Create: `app/studio/_components/StudioCodePane.tsx`

**Interfaces:**
- Consumes: `computeDiffLines` (`app/studio/_lib/diff.ts`), `CodeBlock`, `FileDiff`
- Produces: `StudioCodePane(props: StudioCodePaneProps)`

- [ ] **Step 1: Create `StudioCodePane.tsx`**

Create `app/studio/_components/StudioCodePane.tsx`:
```typescript
"use client";

import { useMemo, useState } from "react";
import { FileCode2, Layers } from "lucide-react";
import { CodeBlock } from "@/components/agents/code-block";
import { FileDiff } from "@/components/agents/file-diff";
import { computeDiffLines } from "../_lib/diff";

export interface StudioCodePaneProps {
  readonly activeTab: "code" | "assets";
  readonly sourceCode: string | null;
  readonly previousSourceCode: string | null;
  readonly assetManifest: Record<string, string>;
}

export function StudioCodePane({
  activeTab,
  sourceCode,
  previousSourceCode,
  assetManifest,
}: StudioCodePaneProps) {
  const [viewMode, setViewMode] = useState<"source" | "diff">("source");

  const diffLines = useMemo(
    () => (sourceCode ? computeDiffLines(previousSourceCode, sourceCode) : []),
    [previousSourceCode, sourceCode],
  );

  if (activeTab === "assets") {
    const entries = Object.entries(assetManifest);
    return (
      <div className="flex h-full flex-col bg-card overflow-y-auto p-4 space-y-3">
        <div className="flex items-center gap-2 border-b border-border pb-3">
          <Layers className="size-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Loaded Game Assets ({entries.length})</h2>
        </div>

        {entries.length === 0 ? (
          <div className="text-xs text-muted-foreground italic py-8 text-center">
            No assets assigned. Entities are rendered procedurally using geometric pixel art.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {entries.map(([entityId, url]) => (
              <div
                key={entityId}
                className="flex items-center gap-3 rounded-lg border border-border bg-secondary/30 p-2.5 text-xs"
              >
                <div className="size-10 rounded border border-border bg-slate-900 flex items-center justify-center overflow-hidden shrink-0">
                  <img
                    src={url}
                    alt={entityId}
                    className="max-h-8 max-w-8 object-contain [image-rendering:pixelated]"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-foreground font-mono truncate">{entityId}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{url}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Code Tab
  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3 text-xs">
        <div className="flex items-center gap-2">
          <FileCode2 className="size-3.5 text-primary" />
          <span className="font-semibold text-foreground">Phaser 4 Scene Code</span>
        </div>

        <div className="flex items-center rounded-lg border border-border bg-secondary/50 p-0.5">
          <button
            type="button"
            onClick={() => setViewMode("source")}
            className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
              viewMode === "source"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Source
          </button>
          <button
            type="button"
            onClick={() => setViewMode("diff")}
            className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
              viewMode === "diff"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Diff
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {sourceCode === null ? (
          <div className="text-xs text-muted-foreground italic py-12 text-center">
            No source code available yet. Generate or load a version to view code.
          </div>
        ) : viewMode === "diff" ? (
          <FileDiff
            fileName="main.js"
            lines={diffLines}
          />
        ) : (
          <CodeBlock
            code={sourceCode}
            language="javascript"
          />
        )}
      </div>
    </div>
  );
}
```

---

### Task 7: Refactor `StudioWorkspace.tsx` Shell

**Files:**
- Modify: `app/studio/_components/StudioWorkspace.tsx`

**Interfaces:**
- Consumes: `usePipelineRun`, `usePreviewSync`, `StudioChatPane`, `StudioPreviewPane`, `StudioCodePane`, `useSandboxBridge`
- Produces: `StudioWorkspace(props: StudioWorkspaceProps)` (clean ~250-line layout shell)

- [ ] **Step 1: Replace monolithic code in `StudioWorkspace.tsx` with modular layout shell**

Update `app/studio/_components/StudioWorkspace.tsx` to:
```typescript
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  FileCode2,
  Gamepad2,
  History,
  Layers,
  Terminal,
} from "lucide-react";
import { useSandboxBridge } from "@/lib/sandbox/useSandboxBridge";
import type { TranscriptMessage, VersionSummary } from "@/lib/games/repository";
import type { QuotaStatus } from "@/lib/quota/types";
import { usePipelineRun } from "../_hooks/usePipelineRun";
import { usePreviewSync } from "../_hooks/usePreviewSync";
import { StudioChatPane } from "./StudioChatPane";
import { StudioPreviewPane } from "./StudioPreviewPane";
import { StudioCodePane } from "./StudioCodePane";
import { ExportMenu } from "./ExportMenu";
import { PublishControls } from "./PublishControls";
import { VersionTimeline } from "./VersionTimeline";

export interface StudioWorkspaceProps {
  readonly gameId: string | null;
  readonly title: string | null;
  readonly currentVersionId: string | null;
  readonly isPublic: boolean;
  readonly publicSlug: string | null;
  readonly versions: ReadonlyArray<VersionSummary>;
  readonly messages: ReadonlyArray<TranscriptMessage>;
  readonly quota: QuotaStatus | null;
}

function QuotaBar({ quota }: { readonly quota: QuotaStatus | null }) {
  if (quota === null) return null;
  if (quota.dailyLimit === null) {
    return (
      <span className="rounded-md border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground">
        Tokens: Unlimited
      </span>
    );
  }

  const percent =
    quota.dailyLimit <= 0
      ? 100
      : Math.min(100, Math.round((quota.usedTokens / quota.dailyLimit) * 100));

  return (
    <div
      className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground"
      title={`${quota.usedTokens.toLocaleString("en-US")} of ${quota.dailyLimit.toLocaleString("en-US")} tokens used today`}
    >
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-secondary">
        <div
          className={`h-full transition-all ${
            percent > 90
              ? "bg-destructive"
              : percent > 75
                ? "bg-amber-400"
                : "bg-primary"
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-[11px] font-mono text-foreground">{percent}% tokens</span>
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

  const previewSync = usePreviewSync({
    gameId,
    currentVersionId,
    bridge,
  });

  const pipelineRun = usePipelineRun({
    gameId,
    onRunCompleted: (data) => {
      if (gameId === null) {
        router.replace(`/studio/${data.gameId}`);
        return;
      }
      previewSync.switchVersionAfterRun(data.versionId);
      router.refresh();
    },
    onRunFailed: () => {
      router.refresh();
    },
  });

  const [activeTab, setActiveTab] = useState<"preview" | "code" | "assets" | "console" | "versions">("preview");

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* Top Header Bar */}
      <header className="flex h-[48px] flex-shrink-0 items-center justify-between border-b border-border bg-card px-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium">GameForge</span>
            <span className="text-muted-foreground/60">/</span>
            <h1 className="font-semibold text-sm text-foreground">
              {title ?? "New game"}
            </h1>
          </div>

          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              pipelineRun.busy
                ? "bg-primary/15 text-primary border border-primary/30"
                : bridge.status === "running"
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                  : "bg-secondary text-muted-foreground border border-border"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                pipelineRun.busy
                  ? "bg-primary animate-ping"
                  : bridge.status === "running"
                    ? "bg-emerald-400"
                    : "bg-muted-foreground"
              }`}
            />
            {pipelineRun.busy ? "Agent Building..." : bridge.status === "running" ? "Live" : "Ready"}
          </span>

          {bridge.status === "running" && (
            <button
              type="button"
              onClick={previewSync.togglePreview}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all ${
                previewSync.previewOpen
                  ? "bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25"
                  : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30 animate-pulse shadow-sm"
              }`}
              title={previewSync.previewOpen ? "Hide game preview" : "Show game preview"}
            >
              <Gamepad2 className="size-3.5" />
              <span>{previewSync.previewOpen ? "Hide Preview" : "Play Game"}</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <QuotaBar quota={quota} />

          {gameId !== null && (
            <>
              <ExportMenu
                gameId={gameId}
                versionId={previewSync.previewVersionId ?? currentVersionId}
              />
              <PublishControls
                gameId={gameId}
                initialIsPublic={isPublic}
                publicSlug={publicSlug}
              />
            </>
          )}
        </div>
      </header>

      {/* Main Two-Pane Studio Body */}
      <div className="flex flex-1 min-h-0">
        {/* Left Pane: Chat & Prompting */}
        <div className="w-[450px] shrink-0 border-r border-border">
          <StudioChatPane
            messages={messages}
            unpersisted={pipelineRun.unpersisted}
            busy={pipelineRun.busy}
            runKind={pipelineRun.runKind}
            activeStage={pipelineRun.activeStage}
            doneStages={pipelineRun.doneStages}
            failure={pipelineRun.failure}
            warning={pipelineRun.warning}
            isNewGame={gameId === null}
            onStartRun={pipelineRun.startRun}
            onCancelRun={pipelineRun.cancelRun}
          />
        </div>

        {/* Right Pane: Multi-Tab Workbench */}
        <div className="flex-1 flex flex-col min-w-0 bg-card/20">
          {/* Tabs header */}
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-card px-4">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setActiveTab("preview")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  activeTab === "preview"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Gamepad2 className="size-3.5" />
                Preview
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("code")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  activeTab === "code"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <FileCode2 className="size-3.5" />
                Code
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("assets")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  activeTab === "assets"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Layers className="size-3.5" />
                Assets
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("console")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  activeTab === "console"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Terminal className="size-3.5" />
                Logs ({bridge.logs.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("versions")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  activeTab === "versions"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <History className="size-3.5" />
                History ({versions.length})
              </button>
            </div>
          </div>

          {/* Tab content area */}
          <div className="flex-1 min-h-0 relative">
            {activeTab === "preview" && (
              <StudioPreviewPane
                bridge={bridge}
                previewVersionId={previewSync.previewVersionId}
                currentVersionId={currentVersionId}
                isPreviewingOther={previewSync.isPreviewingOther}
                bootError={previewSync.bootError}
                expanded={previewSync.previewExpanded}
                onToggleExpand={() => previewSync.setPreviewExpanded(!previewSync.previewExpanded)}
                onClose={previewSync.closePreview}
                onRollback={previewSync.rollbackVersion}
                onReload={previewSync.reloadCurrentVersion}
              />
            )}

            {(activeTab === "code" || activeTab === "assets") && (
              <StudioCodePane
                activeTab={activeTab}
                sourceCode={previewSync.sourceCode}
                previousSourceCode={previewSync.previousSourceCode}
                assetManifest={previewSync.assetManifest}
              />
            )}

            {activeTab === "console" && (
              <div className="flex h-full flex-col bg-slate-950 font-mono text-xs p-4 overflow-y-auto space-y-1 text-slate-300">
                {bridge.logs.length === 0 ? (
                  <div className="text-slate-600 italic py-8 text-center">No console events captured yet.</div>
                ) : (
                  bridge.logs.map((log, idx) => (
                    <div key={`log-${idx}`} className="flex items-start gap-2">
                      <span className="text-slate-500 shrink-0">[{log.level.toUpperCase()}]</span>
                      <span className="text-slate-300">{log.message}</span>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === "versions" && (
              <div className="flex h-full flex-col overflow-y-auto p-4 bg-card">
                <VersionTimeline
                  versions={versions}
                  currentVersionId={currentVersionId}
                  previewVersionId={previewSync.previewVersionId}
                  onPreviewVersion={previewSync.previewVersion}
                  onRollbackVersion={previewSync.rollbackVersion}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

---

### Task 8: Verification & Linter Pass

**Files:**
- Verification: `bun test`
- Type Check: `bun run check-types`
- Lint: `bun run eslint app/studio`

- [ ] **Step 1: Run full test suite**
Run: `bun test`  
Expected: All tests pass (405+ pass, 0 fail).

- [ ] **Step 2: Run TypeScript check**
Run: `bun run check-types`  
Expected: 0 errors (`next typegen && tsc --noEmit`).

- [ ] **Step 3: Run ESLint on app/studio**
Run: `bun run eslint app/studio`  
Expected: 0 errors, 0 warnings. (Both previous `react-hooks/set-state-in-effect` and `react-hooks/immutability` errors resolved).
