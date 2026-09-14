"use client";

import { useEffect, useRef } from "react";
import { PreviewFrame } from "@/app/_components/PreviewFrame";
import { useSandboxBridge } from "@/lib/sandbox/useSandboxBridge";

const buttonClassName =
  "rounded border border-black/15 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-white/20";

export interface PlayFrameProps {
  readonly title: string;
  /** The published version's preview URL; null when previews are not configured. */
  readonly previewUrl: string | null;
}

/**
 * The public player.
 *
 * A published game needs no token — the preview route serves it because the game
 * is public — so this reuses the same isolated document and bridge the Studio
 * does. There is no probation, no repair and no mutation here: nothing on this
 * page may write.
 */
export function PlayFrame({ title, previewUrl }: PlayFrameProps) {
  const bridge = useSandboxBridge();
  const { ready, loadPreview } = bridge;
  // A ref, not state: React's strict mode runs the effect twice in development,
  // and a second load would restart the game under the player.
  const bootedRef = useRef(false);

  useEffect(() => {
    if (!ready || previewUrl === null || bootedRef.current) {
      return;
    }

    bootedRef.current = true;
    loadPreview(previewUrl);
  }, [ready, loadPreview, previewUrl]);

  function enterFullscreen(): void {
    void bridge.frameRef.current?.requestFullscreen();
  }

  if (previewUrl === null) {
    return <p className="text-sm opacity-70">This game cannot be played right now.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="h-[min(70vh,540px)] overflow-hidden rounded border border-black/15 bg-[#0b1020] dark:border-white/20">
        <PreviewFrame
          frameRef={bridge.frameRef}
          src={bridge.previewUrl}
          onLoad={bridge.handleFrameLoad}
          onReload={() => loadPreview(previewUrl)}
          title={title}
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className={buttonClassName}
          disabled={!bridge.ready}
          onClick={enterFullscreen}
        >
          Fullscreen
        </button>
        <span className="text-sm opacity-70" data-testid="play-status">
          status: <span className="font-mono">{bridge.status}</span>
        </span>
      </div>

      {bridge.lastError === null ? null : (
        <p className="text-sm text-red-600 dark:text-red-400">
          {bridge.lastError.phase}: {bridge.lastError.message}
        </p>
      )}
    </div>
  );
}
