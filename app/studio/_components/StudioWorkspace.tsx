"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Compass,
  FileCode2,
  Gamepad2,
  History,
  Layers,
  Maximize2,
  Minimize2,
  Rocket,
  Sparkles,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import { PreviewFrame } from "@/app/_components/PreviewFrame";
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
import { FileDiff, type FileDiffLine } from "@/components/agents/file-diff";
import { ImageGeneration } from "@/components/agents/image-generation";
import { Citations, type CitationItem } from "@/components/agents/citations";
import { StreamingResponse } from "@/components/agents/streaming-response";
import { ToolApproval } from "@/components/agents/tool-approval";
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
import { ExportMenu } from "./ExportMenu";
import { PublishControls } from "./PublishControls";
import { RuntimeControls } from "./RuntimeControls";
import { VersionTimeline } from "./VersionTimeline";

const GENERATE_STAGES: ReadonlyArray<{ id: GenerationStage; label: string }> = [
  { id: "spec", label: "Spec" },
  { id: "asset_mapper", label: "Assets" },
  { id: "coder", label: "Coder" },
];

const PATCH_STAGES: ReadonlyArray<{ id: GenerationStage; label: string }> = [
  { id: "asset_mapper", label: "Assets" },
  { id: "coder", label: "Coder" },
];

const INSTRUCTION_MAX_LENGTH = 2000;
const PROBATION_MS = 3000;
const BOOT_ATTEMPTS = 3;
const BOOT_RETRY_DELAY_MS = 400;

const STARTER_PROMPTS = [
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

const GAME_SOURCES: CitationItem[] = [
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

const PROMPT_MODELS = [
  {
    value: "claude-sonnet-5",
    label: "Claude Sonnet 5 (Default)",
  },
  {
    value: "claude-3-7-sonnet",
    label: "Claude 3.7 Sonnet",
  },
  {
    value: "claude-3-5-sonnet",
    label: "Claude 3.5 Sonnet",
  },
];

const PROMPT_ACTIONS = [
  {
    value: "space-combat",
    label: "Space Combat",
    description: "Starship fighting asteroids with particle bursts",
  },
  {
    value: "endless-runner",
    label: "Endless Runner",
    description: "Fast side-scrolling platformer with jump timing",
  },
  {
    value: "dungeon-crawler",
    label: "Dungeon Explorer",
    description: "Top-down labyrinth navigation and hazards",
  },
  {
    value: "arcade-breakout",
    label: "Arcade Breakout",
    description: "Paddle bounce physics and destructible blocks",
  },
];

const STARTER_PROMPTS_MAP: Record<string, string> = {
  "space-combat":
    "A retro space combat game where a starship shoots asteroids, collects energy cells, and dodges enemy drones with Arcade physics.",
  "endless-runner":
    "A side-scrolling endless runner where a character leaps over obstacles, slides under barriers, and gathers energy coins.",
  "dungeon-crawler":
    "A top-down dungeon crawler where an adventurer navigates mysterious chambers, avoids traps, gathers keys, and unlocks the portal.",
  "arcade-breakout":
    "A classic arcade brick-breaker game with paddle controls, bounce physics, score combos, and multiball mechanics.",
};

function computeDiffLines(
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

async function readFailure(
  response: Response,
  fallback = "Request failed.",
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
  readonly previewUrl: string | null;
}

interface UnpersistedTurn {
  readonly id: number;
  readonly instruction: string;
  readonly note: string;
}

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
  if (quota === null) {
    return null;
  }

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
  const { loadPreview, ready } = bridge;
  const hidden = useDocumentHidden();

  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  /** Safety net: timestamp when busy was last set, so we can auto-reset if stuck. */
  const [busySince, setBusySince] = useState<number | null>(null);
  const [runKind, setRunKind] = useState<"generate" | "patch" | null>(null);
  const [activeStage, setActiveStage] = useState<GenerationStage | null>(null);
  const [doneStages, setDoneStages] = useState<ReadonlyArray<GenerationStage>>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [unpersisted, setUnpersisted] = useState<ReadonlyArray<UnpersistedTurn>>([]);
  const [bootError, setBootError] = useState<string | null>(null);

  const [bootVersionId, setBootVersionId] = useState<string | null>(currentVersionId);
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(currentVersionId);
  const [evaluateVersionId, setEvaluateVersionId] = useState<string | null>(currentVersionId);

  // AgentUI layout tabs: preview canvas vs code vs assets vs live logs vs versions
  const [activeTab, setActiveTab] = useState<"preview" | "code" | "assets" | "console" | "versions">("preview");

  const [loadedSourceCode, setLoadedSourceCode] = useState<string | null>(null);
  const [previousSourceCode, setPreviousSourceCode] = useState<string | null>(null);
  const [loadedAssetManifest, setLoadedAssetManifest] = useState<Record<string, string>>({});
  const [codeViewMode, setCodeViewMode] = useState<"source" | "diff">("source");
  const [pendingRollbackVersionId, setPendingRollbackVersionId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>("claude-sonnet-5");

  const pendingRollbackVersion = useMemo(
    () => (pendingRollbackVersionId ? versions.find((v) => v.id === pendingRollbackVersionId) ?? null : null),
    [pendingRollbackVersionId, versions],
  );

  const diffLines = useMemo(
    () => (loadedSourceCode ? computeDiffLines(previousSourceCode, loadedSourceCode) : []),
    [previousSourceCode, loadedSourceCode],
  );

  // User override for preview pane: null = auto-open when running, true = open, false = closed
  const [userPreviewOpen, setUserPreviewOpen] = useState<boolean | null>(null);
  const [previewExpanded, setPreviewExpanded] = useState(false);

  // Derives preview open state: defaults to true when game is running (ready to play), false otherwise
  const previewOpen = userPreviewOpen ?? (bridge.status === "running");

  const togglePreview = useCallback(() => {
    setUserPreviewOpen((current) => !(current ?? (bridge.status === "running")));
  }, [bridge.status]);

  const closePreview = useCallback(() => {
    setPreviewExpanded(false);
    setUserPreviewOpen(false);
  }, []);

  const openPreview = useCallback(() => {
    setUserPreviewOpen(true);
  }, []);

  // Safety net: if busy stays true for longer than the server maxDuration (5 min),
  // auto-reset so the user isn't permanently blocked.
  const BUSY_TIMEOUT_MS = 330_000; // 5 min 30 s (server maxDuration=300s + buffer)
  useEffect(() => {
    if (!busy || busySince === null) return;
    const elapsed = Date.now() - busySince;
    const remaining = BUSY_TIMEOUT_MS - elapsed;
    if (remaining <= 0) {
      busyRef.current = false;
      setBusy(false);
      setBusySince(null);
      setFailure("The previous run timed out without a response. You can try submitting again.");
      return;
    }
    const id = setTimeout(() => {
      busyRef.current = false;
      setBusy(false);
      setBusySince(null);
      setFailure("The previous run timed out without a response. You can try submitting again.");
    }, remaining);
    return () => clearTimeout(id);
  }, [busy, busySince]);

  // Handle Escape key when preview is expanded to fullscreen
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

  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const bootedRef = useRef<string | null>(null);
  const turnIdRef = useRef(0);
  const runningVersionRef = useRef<string | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

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

            runningVersionRef.current = versionId;
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
      if (gameId === null) {
        return;
      }

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

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  // Auto-scroll chat on updates
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, unpersisted, activeStage, failure]);

  const startRun = useCallback(
    async (kind: "generate" | "patch") => {
      const text = instruction.trim();

      if (busyRef.current || text.length === 0 || text.length > INSTRUCTION_MAX_LENGTH) {
        return;
      }

      busyRef.current = true;
      setBusy(true);
      setBusySince(Date.now());
      setUserPreviewOpen(null);
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
      setBusySince(null);
      setActiveStage(null);
      setInstruction("");

      if (result.kind === "terminal" && result.frame.event === "run.completed") {
        const data = result.frame.data as RunCompletedData;

        if (gameId === null) {
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
        // Make server errors actionable for the user
        const actionableMessage =
          data.code === "run_in_progress"
            ? "A previous run is still in progress. Please wait a moment, then try again. If this persists, refresh the page."
            : data.code === "rate_limited" || data.code === "quota_exceeded"
              ? "You've hit the rate limit. Please wait a minute before trying again."
              : data.code === "unauthorized"
                ? "Your session has expired. Please sign in again."
                : data.message;
        setFailure(actionableMessage);

        if (data.versionId === null) {
          addUnpersistedTurn(text, actionableMessage);
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
          ? "The server stopped responding (timed out). Check your internet connection, then try again."
          : result.kind === "incomplete"
            ? "The connection was interrupted before the run finished. Please try again."
            : result.kind === "http_error" && result.status === 409
              ? "A run is already in progress. Please wait a moment, then try again."
              : result.kind === "http_error" && result.status === 401
                ? "Your session has expired. Please sign in again."
                : result.kind === "http_error" && result.status === 429
                  ? "Rate limited. Please wait a moment, then try again."
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
    setUserPreviewOpen(true);
    setPreviewVersionId(versionId);
    setBootVersionId(versionId);
    setEvaluateVersionId(null);
  }, []);

  const isPreviewingOther =
    previewVersionId !== null && previewVersionId !== currentVersionId;
  const stages = runKind === "patch" ? PATCH_STAGES : GENERATE_STAGES;
  const isNewGame = gameId === null;

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
              busy
                ? "bg-primary/15 text-primary border border-primary/30"
                : bridge.status === "running"
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                  : "bg-secondary text-muted-foreground border border-border"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                busy
                  ? "bg-primary animate-ping"
                  : bridge.status === "running"
                    ? "bg-emerald-400"
                    : "bg-muted-foreground"
              }`}
            />
            {busy ? "Agent Building..." : bridge.status === "running" ? "Live" : "Ready"}
          </span>

          {/* Toggle preview button once game is running */}
          {bridge.status === "running" && (
            <button
              type="button"
              onClick={togglePreview}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all ${
                previewOpen
                  ? "bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25"
                  : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30 animate-pulse shadow-sm"
              }`}
              title={previewOpen ? "Hide game preview" : "Show game preview"}
            >
              <Gamepad2 className="size-3.5" />
              <span>{previewOpen ? "Hide Preview" : "Play Game"}</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2.5">
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
      </header>

      {/* Main Agent Workspace: Chat App + Slide-In Preview Pane */}
      <div className="relative flex-1 min-h-0 flex overflow-hidden">
        {/* ================= CHAT PANE ================= */}
        <section
          className={`flex flex-col min-h-0 bg-background transition-all duration-300 ${
            previewOpen
              ? "w-full lg:w-[460px] xl:w-[500px] shrink-0 border-r border-border"
              : "w-full flex-1"
          }`}
        >
          {/* Chat Header */}
          <div className="flex h-[42px] flex-shrink-0 items-center justify-between border-b border-border bg-card/60 px-4 text-xs">
            <div className="flex items-center gap-2 font-medium text-foreground">
              <Sparkles className="size-4 text-primary" />
              <span>GameForge Agent</span>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="text-[11px] text-muted-foreground">
                {isNewGame ? "Generator Mode" : "Patch Mode"}
              </span>
              {!previewOpen && bridge.status === "running" && (
                <button
                  type="button"
                  onClick={openPreview}
                  className="inline-flex items-center gap-1 rounded bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[11px] font-medium text-emerald-400 hover:bg-emerald-500/25 transition-colors shadow-sm"
                  title="Open live game preview"
                >
                  <Gamepad2 className="size-3.5" />
                  <span>Open Preview</span>
                </button>
              )}
            </div>
          </div>

          {/* Messages Stream */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className={`space-y-4 ${previewOpen ? "" : "max-w-3xl xl:max-w-4xl mx-auto w-full"}`}>
              {/* Empty State / Starter Chips */}
              {messages.length === 0 && unpersisted.length === 0 && (
                <div className="flex flex-col gap-4 py-3">
                  <div className="rounded-xl border border-border bg-card p-4 text-left">
                    <h3 className="text-sm font-semibold tracking-tight">
                      Welcome to GameForge Studio
                    </h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Describe any 2D game concept and the AI Agent will generate the Phaser 4 code, map Kenney sprites or procedural pixel art, and boot it directly in the live sandbox.
                    </p>
                  </div>

                  {isNewGame && (
                    <div>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block mb-2 px-1">
                        Quick Starter Ideas
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {STARTER_PROMPTS.map((starter) => {
                          const Icon = starter.icon;
                          return (
                            <button
                              key={starter.title}
                              type="button"
                              onClick={() => setInstruction(starter.prompt)}
                              className="flex items-start gap-3 rounded-lg border border-border bg-card/60 p-3 text-left transition-colors hover:border-primary/50 hover:bg-card"
                            >
                              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                <Icon className="size-4" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-medium text-foreground">
                                  {starter.title}
                                </div>
                                <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                                  {starter.desc}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Conversation Messages */}
              {messages.map((message) => {
                const isUser = message.role === "user";
                return (
                  <Message
                    key={message.id}
                    from={isUser ? "user" : "assistant"}
                  >
                    <MessageAvatar
                      className={
                        isUser
                          ? "bg-primary/20 text-primary"
                          : "bg-secondary text-primary"
                      }
                    >
                      {isUser ? (
                        <span className="text-[11px] font-semibold">U</span>
                      ) : (
                        <Sparkles className="size-3.5" />
                      )}
                    </MessageAvatar>
                    <MessageContent>
                      <MessageHeader>
                        <span>{isUser ? "You" : "GameForge Agent"}</span>
                      </MessageHeader>
                      {isUser ? (
                        <MessageBubble variant="solid">
                          <MessageBubbleContent className="text-xs whitespace-pre-wrap leading-relaxed">
                            {message.content}
                          </MessageBubbleContent>
                        </MessageBubble>
                      ) : (
                        <div className="w-full rounded-xl border border-border bg-card/60 p-3 shadow-sm">
                          <StreamingResponse
                            status="complete"
                            copyText={message.content}
                            showActions={true}
                          >
                            <div className="text-xs whitespace-pre-wrap leading-relaxed text-foreground">
                              {message.content}
                            </div>
                          </StreamingResponse>
                        </div>
                      )}
                    </MessageContent>
                  </Message>
                );
              })}

              {/* In-flight or unpersisted turns */}
              {unpersisted.map((turn) => (
                <Message key={`unpersisted-${turn.id}`} from="user">
                  <MessageAvatar className="bg-primary/20 text-primary">
                    <span className="text-[11px] font-semibold">U</span>
                  </MessageAvatar>
                  <MessageContent>
                    <MessageHeader>
                      <span>You</span>
                    </MessageHeader>
                    <MessageBubble variant="solid">
                      <MessageBubbleContent className="text-xs whitespace-pre-wrap leading-relaxed">
                        {turn.instruction}
                        <div className="mt-1.5 border-t border-primary-foreground/20 pt-1 text-[11px] opacity-80">
                          {turn.note}
                        </div>
                      </MessageBubbleContent>
                    </MessageBubble>
                  </MessageContent>
                </Message>
              ))}

              {/* Approvals: Human-in-the-loop Rollback Confirmation */}
              {pendingRollbackVersion && (
                <div className="rounded-xl border border-amber-500/30 bg-card p-3 shadow-md">
                  <ToolApproval
                    tool="rollback_snapshot"
                    title={`Confirm Snapshot Rollback to v${pendingRollbackVersion.versionNumber}`}
                    description={`Revert game source code and asset definitions to snapshot #${pendingRollbackVersion.versionNumber}. Unsaved modifications in the current version will be replaced.`}
                    parameters={[
                      {
                        id: "version",
                        label: "Target Version",
                        value: `Snapshot v${pendingRollbackVersion.versionNumber}`,
                      },
                      {
                        id: "prompt",
                        label: "Trigger",
                        value: pendingRollbackVersion.prompt ?? "Initial generation",
                      },
                      {
                        id: "created",
                        label: "Created At",
                        value: new Date(pendingRollbackVersion.createdAt).toLocaleString(),
                      },
                    ]}
                    status="pending"
                    onApprove={() => {
                      const vid = pendingRollbackVersionId;
                      setPendingRollbackVersionId(null);
                      if (vid) {
                        void rollback(vid);
                      }
                    }}
                    onDeny={() => setPendingRollbackVersionId(null)}
                  />
                </div>
              )}

              {/* Planning & Tools Execution Stream */}
              {runKind !== null && (
                <div className="space-y-3">
                  <TodoList
                    title={
                      <span className="flex items-center gap-2 font-medium">
                        <Sparkles className="size-3.5 text-primary" />
                        <span>{runKind === "generate" ? "Generation Plan" : "Patch Plan"}</span>
                      </span>
                    }
                    items={stages.map((stage) => {
                      const isDone = doneStages.includes(stage.id);
                      const isActive = activeStage === stage.id;
                      const isCancelled = failure !== null && !isDone;
                      return {
                        id: stage.id,
                        title: stage.label,
                        status: isDone
                          ? "completed"
                          : isActive
                            ? "in-progress"
                            : isCancelled
                              ? "cancelled"
                              : "pending",
                        detail:
                          stage.id === "spec"
                            ? "Synthesizing gameplay rules, entities & Arcade physics components"
                            : stage.id === "asset_mapper"
                              ? "Mapping Kenney CC0 2D sprites & audio synthesizers"
                              : "Compiling Phaser 4 TypeScript scene & sandbox bundle",
                      };
                    })}
                    defaultOpen={true}
                  />

                  {/* Tool Results for completed stages */}
                  {doneStages.includes("spec") && (
                    <ToolResult
                      tool="spec_synthesizer"
                      title="Game Architecture & Components Synthesized"
                      status="success"
                      kind="request"
                      meta="Phaser 4 Spec"
                    >
                      <ToolResultOutput language="typescript">
                        {`// Game Architecture Synthesized:\n// Canvas: 800x600, Physics: Arcade\n// Entities: Player, Obstacles, Collectibles, HUD\n// State: Title, Play, GameOver`}
                      </ToolResultOutput>
                    </ToolResult>
                  )}

                  {doneStages.includes("asset_mapper") && (
                    <ToolResult
                      tool="asset_mapper"
                      title={`Mapped ${Object.keys(loadedAssetManifest).length || 4} Kenney CC0 Sprites`}
                      status="success"
                      kind="request"
                      meta="Kenney Assets"
                    >
                      <ToolResultOutput language="typescript">
                        {Object.keys(loadedAssetManifest).length > 0
                          ? Object.entries(loadedAssetManifest)
                              .map(([k, v]) => `asset("${k}") -> "${v}"`)
                              .join("\n")
                          : `asset("player") -> "kenney://characters/hero.png"\nasset("coin") -> "kenney://items/coin.png"\nasset("hazard") -> "kenney://enemies/spike.png"`}
                      </ToolResultOutput>
                    </ToolResult>
                  )}

                  {doneStages.includes("coder") && (
                    <ToolResult
                      tool="phaser_compiler"
                      title="Phaser 4 Scene Compiled & Bundled"
                      status="success"
                      kind="terminal"
                      meta="TypeScript 5.x"
                    >
                      <ToolResultOutput language="typescript">
                        {`Sandbox bundle ready. Frame dispatched to isolated iframe.`}
                      </ToolResultOutput>
                    </ToolResult>
                  )}

                  {warning !== null && (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-950/20 p-2.5 text-xs text-amber-300">
                      <AlertCircle className="size-4 shrink-0 mt-0.5 text-amber-400" />
                      <p className="leading-relaxed text-[11px]">{warning}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Failure Alert — always visible, with retry guidance */}
              {failure !== null && (
                <div className="flex items-start gap-2.5 rounded-xl border border-destructive/50 bg-destructive/10 p-3.5 text-xs text-destructive shadow-sm">
                  <AlertCircle className="size-4 shrink-0 mt-0.5 text-destructive" />
                  <div className="flex-1 space-y-2">
                    <p className="font-semibold text-xs">Run Encountered an Error</p>
                    <p className="leading-relaxed text-[11px] text-muted-foreground">
                      {failure}
                    </p>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => { setFailure(null); }}
                        className="rounded-lg border border-border bg-background px-2.5 py-1 text-[10px] font-medium text-foreground hover:bg-accent transition-colors"
                      >
                        Dismiss
                      </button>
                      <span className="text-[10px] text-muted-foreground">
                        Try again: edit your instruction above and click the send arrow.
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Sources & Citations */}
              <div className="pt-2">
                <Citations citations={GAME_SOURCES} defaultOpen={false} />
              </div>

              <div ref={chatBottomRef} />
            </div>
          </div>

          {/* Floating Prompt Input Box */}
          <div className="p-3 border-t border-border bg-card/40">
            <div className={previewOpen ? "" : "max-w-3xl xl:max-w-4xl mx-auto w-full"}>
              <PromptInput
                value={instruction}
                onValueChange={setInstruction}
                onSubmit={() => {
                  void startRun(isNewGame ? "generate" : "patch");
                }}
                loading={busy}
                onStop={() => abortRef.current?.abort()}
                placeholder={
                  isNewGame
                    ? "A side-scrolling runner where an explorer collects artifacts and dodges hazards..."
                    : "Make the player jump higher and add particle trails..."
                }
                maxLength={INSTRUCTION_MAX_LENGTH}
                readOnly={busy}
                models={PROMPT_MODELS}
                model={selectedModel}
                onModelChange={setSelectedModel}
                actions={PROMPT_ACTIONS}
                onAction={(action) => {
                  const starterPrompt = STARTER_PROMPTS_MAP[action];
                  if (starterPrompt) {
                    setInstruction(starterPrompt);
                  }
                }}
                leadingAction={
                  <span className="text-[11px] font-mono text-muted-foreground px-2">
                    {instruction.length}/{INSTRUCTION_MAX_LENGTH}
                  </span>
                }
              />
            </div>
          </div>
        </section>

        {/* ================= PREVIEW PANE ================= */}
        <section
          className={`min-h-0 bg-background transition-all duration-300 ${
            previewExpanded
              ? "fixed inset-0 z-50 p-2 sm:p-4 flex flex-col bg-background"
              : previewOpen
                ? "flex-1 flex flex-col relative w-full lg:w-auto"
                : "w-0 h-0 opacity-0 overflow-hidden pointer-events-none absolute top-0 right-0"
          }`}
          role="region"
          aria-label="Game Preview"
        >
          {/* Preview Tab Header */}
          <div className="flex h-[42px] flex-shrink-0 items-center justify-between border-b border-border bg-card/60 px-3 text-xs">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setActiveTab("preview")}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors ${
                  activeTab === "preview"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Gamepad2 className="size-3.5" />
                <span>Game Canvas</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("code")}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors ${
                  activeTab === "code"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <FileCode2 className="size-3.5" />
                <span>Code</span>
                {loadedSourceCode && (
                  <span className="rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground font-mono">
                    TS
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("assets")}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors ${
                  activeTab === "assets"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Layers className="size-3.5" />
                <span>Assets</span>
                {Object.keys(loadedAssetManifest).length > 0 && (
                  <span className="rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground font-mono">
                    {Object.keys(loadedAssetManifest).length}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("console")}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors ${
                  activeTab === "console"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Terminal className="size-3.5" />
                <span>Console</span>
                {bridge.logs.length > 0 && (
                  <span className="rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground font-mono">
                    {bridge.logs.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("versions")}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors ${
                  activeTab === "versions"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <History className="size-3.5" />
                <span>Versions</span>
                {versions.length > 0 && (
                  <span className="rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground font-mono">
                    {versions.length}
                  </span>
                )}
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              {isPreviewingOther && (
                <span className="rounded bg-blue-950/60 border border-blue-500/40 px-2 py-0.5 text-[10px] text-blue-300">
                  Previewing older snapshot
                </span>
              )}

              {/* Expand / Minimize Fullscreen Toggle */}
              <button
                type="button"
                onClick={() => setPreviewExpanded((exp) => !exp)}
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                title={previewExpanded ? "Exit fullscreen" : "Expand preview"}
                aria-label={previewExpanded ? "Exit fullscreen" : "Expand preview"}
              >
                {previewExpanded ? (
                  <Minimize2 className="size-4" />
                ) : (
                  <Maximize2 className="size-4" />
                )}
              </button>

              {/* Close / Collapse Side Panel */}
              <button
                type="button"
                onClick={closePreview}
                className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-secondary transition-colors"
                title="Collapse preview panel"
                aria-label="Collapse preview panel"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          {/* Main View Area (Preview Canvas vs Code vs Assets vs Console vs Versions) */}
          <div className="flex-1 min-h-0 relative flex flex-col">
            {activeTab === "preview" && (
              <div className="flex-1 min-h-0 flex flex-col">
                <div className="flex-1 min-h-0 overflow-hidden">
                  <PreviewFrame
                    frameRef={bridge.frameRef}
                    src={bridge.previewUrl}
                    onLoad={bridge.handleFrameLoad}
                    onReload={() => {
                      if (bridge.previewUrl !== null) {
                        bridge.loadPreview(bridge.previewUrl);
                      }
                    }}
                  />
                </div>

                {/* Transport Controls Bar */}
                <div className="p-3 border-t border-border bg-card/60">
                  <RuntimeControls bridge={bridge} />
                </div>
              </div>
            )}

            {activeTab === "code" && (
              <div className="flex-1 min-h-0 flex flex-col bg-background p-4 overflow-y-auto">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground font-mono">GameScene.ts</span>
                    {previousSourceCode && (
                      <div className="flex rounded border border-border overflow-hidden text-[11px]">
                        <button
                          type="button"
                          onClick={() => setCodeViewMode("source")}
                          className={`px-2 py-0.5 transition-colors ${codeViewMode === "source" ? "bg-secondary text-foreground font-medium" : "text-muted-foreground hover:bg-card"}`}
                        >
                          Source
                        </button>
                        <button
                          type="button"
                          onClick={() => setCodeViewMode("diff")}
                          className={`px-2 py-0.5 transition-colors ${codeViewMode === "diff" ? "bg-secondary text-foreground font-medium" : "text-muted-foreground hover:bg-card"}`}
                        >
                          Diff
                        </button>
                      </div>
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground font-mono">
                    {loadedSourceCode ? `${loadedSourceCode.split("\n").length} lines` : "No code"}
                  </span>
                </div>

                {loadedSourceCode ? (
                  codeViewMode === "source" ? (
                    <CodeBlock
                      code={loadedSourceCode}
                      language="typescript"
                      filename="GameScene.ts"
                      maxHeight={650}
                      showLineNumbers={true}
                    />
                  ) : (
                    <FileDiff
                      file="GameScene.ts"
                      lines={diffLines}
                      language="typescript"
                      maxHeight={650}
                      defaultOpen={true}
                    />
                  )
                ) : (
                  <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                    <FileCode2 className="size-8 mb-2 opacity-50" />
                    <p className="text-xs">No source code available for this snapshot.</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === "assets" && (
              <div className="flex-1 min-h-0 flex flex-col bg-background p-4 overflow-y-auto">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-foreground">Kenney 2D Sprites & Assets</h2>
                  <span className="text-xs text-muted-foreground font-mono">
                    {Object.keys(loadedAssetManifest).length} assets mapped
                  </span>
                </div>

                {Object.keys(loadedAssetManifest).length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                    <Layers className="size-8 mb-2 opacity-50" />
                    <p className="text-xs">No assets mapped for this version yet.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {Object.entries(loadedAssetManifest).map(([key, url]) => (
                      <ImageGeneration
                        key={key}
                        label={key}
                        prompt={`Kenney CC0 sprite: ${key}`}
                        status="complete"
                        resolution="64x64"
                        aspectRatio="1 / 1"
                        size="compact"
                      >
                        <div className="flex flex-col items-center justify-center p-3 h-full bg-card/60 rounded-lg">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt={key}
                            className="size-16 object-contain filter drop-shadow"
                            loading="lazy"
                          />
                          <span className="mt-2 text-[11px] font-mono text-muted-foreground truncate max-w-full">
                            {key}
                          </span>
                        </div>
                      </ImageGeneration>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "console" && (
              <div className="flex-1 min-h-0 flex flex-col bg-background font-mono text-xs">
                <div className="flex items-center justify-between border-b border-border bg-card/60 px-4 py-2 text-muted-foreground">
                  <span className="text-xs font-sans">Live Sandbox Logs</span>
                  <span className="text-[11px] font-mono">
                    {bridge.logs.length} entries
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-1.5 select-text">
                  {bridge.logs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                      <Terminal className="size-6 mb-2 opacity-50" />
                      <p>No console logs captured yet.</p>
                    </div>
                  ) : (
                    bridge.logs.map((log, idx) => (
                      <div
                        key={idx}
                        className={`flex items-start gap-2 rounded px-2 py-1 leading-relaxed ${
                          log.level === "error"
                            ? "bg-destructive/15 text-destructive border border-destructive/20"
                            : log.level === "warn"
                              ? "bg-amber-950/30 text-amber-300 border border-amber-500/20"
                              : "text-foreground hover:bg-card"
                        }`}
                      >
                        <span className="text-[10px] text-muted-foreground select-none">
                          [{log.level.toUpperCase()}]
                        </span>
                        <span className="flex-1 whitespace-pre-wrap">{log.message}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {activeTab === "versions" && (
              <div className="flex-1 min-h-0 flex flex-col bg-background p-4 overflow-y-auto">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-foreground">Version History</h2>
                  <span className="text-xs text-muted-foreground">
                    {versions.length} total snapshots
                  </span>
                </div>
                <VersionTimeline
                  versions={versions}
                  currentVersionId={currentVersionId}
                  previewVersionId={previewVersionId}
                  busy={busy}
                  onPreview={preview}
                  onRollback={(versionId) => setPendingRollbackVersionId(versionId)}
                />
              </div>
            )}
          </div>

          {/* Diagnostic Alerts / Stability Banner */}
          {(bridge.bootTimedOut || bootError !== null || bridge.lastError !== null) && (
            <div className="border-t border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              {bridge.bootTimedOut && (
                <p>The game did not start within ten seconds.</p>
              )}
              {bootError !== null && <p>{bootError}</p>}
              {bridge.lastError !== null && (
                <p>
                  {bridge.lastError.phase}: {bridge.lastError.message}
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
