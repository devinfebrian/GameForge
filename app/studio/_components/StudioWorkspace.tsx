"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FileCode2,
  Gamepad2,
  History,
  Layers,
  Maximize2,
  Minimize2,
  Terminal,
  X,
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
  const [pendingRollbackVersionId, setPendingRollbackVersionId] = useState<string | null>(null);

  const pendingRollbackVersion = useMemo(
    () => (pendingRollbackVersionId ? versions.find((v) => v.id === pendingRollbackVersionId) ?? null : null),
    [pendingRollbackVersionId, versions],
  );

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
                title={title}
                versionId={previewSync.previewVersionId ?? currentVersionId}
              />
              <PublishControls
                gameId={gameId}
                initialIsPublic={isPublic}
                initialPublicSlug={publicSlug}
              />
            </>
          )}
        </div>
      </header>

      {/* Main Two-Pane Studio Body */}
      <div className="flex flex-1 min-h-0 relative">
        {/* Left Pane: Chat & Prompting */}
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
          previewOpen={previewSync.previewOpen}
          loadedAssetManifest={previewSync.assetManifest}
          pendingRollbackVersion={pendingRollbackVersion}
          onApproveRollback={() => {
            const vid = pendingRollbackVersionId;
            setPendingRollbackVersionId(null);
            if (vid) {
              void previewSync.rollbackVersion(vid);
            }
          }}
          onDenyRollback={() => setPendingRollbackVersionId(null)}
          onStartRun={pipelineRun.startRun}
          onCancelRun={pipelineRun.cancelRun}
          onDismissFailure={pipelineRun.clearFailure}
        />

        {/* Right Pane: Workbench / Preview Section */}
        <section
          className={`min-h-0 bg-background transition-all duration-300 ${
            previewSync.previewExpanded
              ? "fixed inset-0 z-50 p-2 sm:p-4 flex flex-col bg-background"
              : previewSync.previewOpen
                ? "flex-1 flex flex-col relative w-full lg:w-auto"
                : "w-0 h-0 opacity-0 overflow-hidden pointer-events-none absolute top-0 right-0"
          }`}
          role="region"
          aria-label="Game Preview"
        >
          {/* Workbench Tabs Header */}
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
                {previewSync.sourceCode && (
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
                {Object.keys(previewSync.assetManifest).length > 0 && (
                  <span className="rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground font-mono">
                    {Object.keys(previewSync.assetManifest).length}
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
              {previewSync.isPreviewingOther && (
                <span className="rounded bg-blue-950/60 border border-blue-500/40 px-2 py-0.5 text-[10px] text-blue-300">
                  Previewing older snapshot
                </span>
              )}

              {/* Fullscreen Expansion Button */}
              <button
                type="button"
                onClick={() => previewSync.setPreviewExpanded(!previewSync.previewExpanded)}
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                title={previewSync.previewExpanded ? "Exit fullscreen (Esc)" : "Expand preview"}
                aria-label={previewSync.previewExpanded ? "Exit fullscreen" : "Expand preview"}
              >
                {previewSync.previewExpanded ? (
                  <Minimize2 className="size-4" />
                ) : (
                  <Maximize2 className="size-4" />
                )}
              </button>

              {/* Close Preview Panel Button */}
              <button
                type="button"
                onClick={previewSync.closePreview}
                className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-secondary transition-colors"
                title="Collapse preview panel"
                aria-label="Collapse preview panel"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          {/* Tab Views */}
          <div className="flex-1 min-h-0 relative flex flex-col">
            {activeTab === "preview" && (
              <StudioPreviewPane
                bridge={bridge}
                bootError={previewSync.bootError}
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
              <div className="flex-1 min-h-0 flex flex-col bg-background font-mono text-xs">
                <div className="flex items-center justify-between border-b border-border bg-card/60 px-4 py-2 text-muted-foreground">
                  <span className="text-xs font-sans">Live Sandbox Logs</span>
                  <span className="text-[11px] font-mono">
                    {bridge.logs.length} events
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-1 text-slate-300 bg-slate-950">
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
              </div>
            )}

            {activeTab === "versions" && (
              <div className="flex-1 min-h-0 flex flex-col bg-background p-4 overflow-y-auto">
                <VersionTimeline
                  versions={versions}
                  currentVersionId={currentVersionId}
                  previewVersionId={previewSync.previewVersionId}
                  busy={pipelineRun.busy}
                  onPreview={previewSync.previewVersion}
                  onRollback={(versionId: string) => setPendingRollbackVersionId(versionId)}
                />
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
