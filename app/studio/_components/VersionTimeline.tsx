"use client";

import type { VersionSummary } from "@/lib/games/repository";
import { History } from "lucide-react";

/** Strips HTML tags and escapes XML special characters in user-supplied text. */
function escapePrompt(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const buttonClassName =
  "inline-flex items-center gap-1 rounded-md border border-border bg-secondary/80 px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40";

export interface VersionTimelineProps {
  readonly versions: ReadonlyArray<VersionSummary>;
  readonly currentVersionId: string | null;
  readonly previewVersionId: string | null;
  readonly busy: boolean;
  readonly onPreview: (versionId: string) => void;
  readonly onRollback: (versionId: string) => void;
}

/**
 * AgentUI-styled version history timeline.
 */
export function VersionTimeline({
  versions,
  currentVersionId,
  previewVersionId,
  busy,
  onPreview,
  onRollback,
}: VersionTimelineProps) {
  if (versions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card p-6 text-center">
        <History className="size-5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">No versions recorded yet.</p>
      </div>
    );
  }

  return (
    <ol className="flex flex-col gap-2">
      {versions.map((version) => {
        const isCurrent = version.id === currentVersionId;
        const isPreview = version.id === previewVersionId;

        return (
          <li
            key={version.id}
            data-testid={`version-${version.versionNumber}`}
            className={`flex flex-col gap-2 rounded-xl border p-3 text-xs transition-colors ${
              isCurrent
                ? "border-primary/50 bg-primary/10"
                : isPreview
                  ? "border-blue-500/50 bg-blue-950/20"
                  : "border-border bg-card hover:border-border/80 hover:bg-card/80"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-foreground">v{version.versionNumber}</span>
                {isCurrent ? (
                  <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                    current
                  </span>
                ) : null}
                {isPreview ? (
                  <span className="rounded border border-blue-500/40 bg-blue-950/40 px-1.5 py-0.5 text-[10px] font-semibold text-blue-300">
                    previewing
                  </span>
                ) : null}
              </div>
              <span className="text-[10px] text-muted-foreground font-mono">
                {new Date(version.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>

            {version.prompt === null ? null : (
              <p
                className="line-clamp-2 text-muted-foreground text-[11px] leading-relaxed"
                dangerouslySetInnerHTML={{ __html: escapePrompt(version.prompt) }}
              />
            )}

            <div className="flex items-center gap-2 pt-1 border-t border-border/40">
              <button
                type="button"
                className={buttonClassName}
                disabled={busy || isPreview}
                onClick={() => onPreview(version.id)}
              >
                Preview
              </button>
              <button
                type="button"
                className={buttonClassName}
                disabled={busy || isCurrent}
                onClick={() => onRollback(version.id)}
              >
                Roll back
              </button>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
