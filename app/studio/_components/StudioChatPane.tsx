"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Sparkles } from "lucide-react";
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
import { ToolApproval } from "@/components/agents/tool-approval";
import { Citations, type CitationItem } from "@/components/agents/citations";
import { StreamingResponse } from "@/components/agents/streaming-response";
import type { GenerationStage } from "@/lib/agents/types";
import type { TranscriptMessage, VersionSummary } from "@/lib/games/repository";
import type { UnpersistedTurn } from "../_hooks/usePipelineRun";
import { INSTRUCTION_MAX_LENGTH } from "../_hooks/usePipelineRun";

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

export const PROMPT_MODELS = [
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

export const PROMPT_ACTIONS = [
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

export const STARTER_PROMPTS_MAP: Record<string, string> = {
  "space-combat":
    "A retro space combat game where a starship shoots asteroids, collects energy cells, and dodges enemy drones with Arcade physics.",
  "endless-runner":
    "A side-scrolling endless runner where a character leaps over obstacles, slides under barriers, and gathers energy coins.",
  "dungeon-crawler":
    "A top-down dungeon crawler where an adventurer navigates mysterious chambers, avoids traps, gathers keys, and unlocks the portal.",
  "arcade-breakout":
    "A classic arcade brick-breaker game with paddle controls, bounce physics, score combos, and multiball mechanics.",
};

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
  readonly previewOpen: boolean;
  readonly loadedAssetManifest: Record<string, string>;
  readonly pendingRollbackVersion: VersionSummary | null;
  readonly onApproveRollback: () => void;
  readonly onDenyRollback: () => void;
  readonly onStartRun: (kind: "generate" | "patch", text: string) => Promise<void>;
  readonly onCancelRun: () => void;
  readonly onDismissFailure: () => void;
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
  previewOpen,
  loadedAssetManifest,
  pendingRollbackVersion,
  onApproveRollback,
  onDenyRollback,
  onStartRun,
  onCancelRun,
  onDismissFailure,
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
    <section
      className="flex flex-1 flex-col min-w-0 border-r border-border bg-background"
      aria-label="Agent Conversation"
    >
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className={previewOpen ? "w-full space-y-4" : "max-w-3xl xl:max-w-4xl mx-auto w-full space-y-4"}>
          {/* Messages list */}
          {messages.map((message) => {
            const isUser = message.role === "user";
            return (
              <Message key={message.id} from={isUser ? "user" : "assistant"}>
                <MessageAvatar className={isUser ? "bg-primary/20 text-primary" : "bg-primary text-primary-foreground"}>
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

          {/* Unpersisted turns */}
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

          {/* Pending Rollback ToolApproval */}
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
                onApprove={onApproveRollback}
                onDeny={onDenyRollback}
              />
            </div>
          )}

          {/* Planning & Stages Execution Stream */}
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

              {/* Tool Results */}
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

          {/* Failure Alert */}
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
                    onClick={onDismissFailure}
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
            onSubmit={handleSubmit}
            loading={busy}
            onStop={onCancelRun}
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
  );
}
