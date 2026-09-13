"use client";

import type { VersionSummary } from "@/lib/games/repository";

const buttonClassName =
  "rounded border border-black/15 px-2 py-1 text-xs disabled:opacity-40 dark:border-white/20";

export interface VersionTimelineProps {
  readonly versions: ReadonlyArray<VersionSummary>;
  readonly currentVersionId: string | null;
  readonly previewVersionId: string | null;
  readonly busy: boolean;
  readonly onPreview: (versionId: string) => void;
  readonly onRollback: (versionId: string) => void;
}

/**
 * Every snapshot of the game, newest first.
 *
 * No stability badge: versions are written with `is_stable = false` and only
 * Phase 5's probation is entitled to change that, so a badge now would read
 * "unproven" on every row and mean nothing.
 *
 * "Preview" and "Roll back" are different operations on purpose. Previewing
 * swaps what the frame is running without touching the game; rolling back moves
 * `current_version_id`, which also changes what the next edit builds on.
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
    return <p className="text-sm opacity-70">No versions yet.</p>;
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
            className="flex flex-col gap-1 rounded border border-black/15 p-2 text-sm dark:border-white/20"
          >
            <div className="flex items-center gap-2">
              <span className="font-medium">v{version.versionNumber}</span>
              {isCurrent ? (
                <span className="rounded bg-foreground px-1.5 py-0.5 text-xs text-background">
                  current
                </span>
              ) : null}
              {isPreview ? (
                <span className="rounded border border-black/20 px-1.5 py-0.5 text-xs dark:border-white/25">
                  previewing
                </span>
              ) : null}
            </div>
            {version.prompt === null ? null : (
              <p className="line-clamp-2 text-xs opacity-70">{version.prompt}</p>
            )}
            <div className="flex gap-2">
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
