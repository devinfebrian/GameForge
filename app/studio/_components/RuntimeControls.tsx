"use client";

import type { SandboxBridge } from "@/lib/sandbox/useSandboxBridge";

const buttonClassName =
  "rounded border border-black/15 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-white/20";

export interface RuntimeControlsProps {
  readonly bridge: SandboxBridge;
}

/**
 * Transport controls for the preview.
 *
 * Every control is disabled until the frame can actually receive a message: the
 * frame ignores everything until its own `load` has fired, and a control that
 * silently does nothing reads as a broken game rather than a disabled button.
 */
export function RuntimeControls({ bridge }: RuntimeControlsProps) {
  const idle = bridge.status === "idle";
  const paused = bridge.status === "paused";

  function enterFullscreen(): void {
    // The frame is the fullscreen target, not the page: the sandboxed document
    // is what the player is watching.
    void bridge.frameRef.current?.requestFullscreen();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={buttonClassName}
        disabled={!bridge.ready || idle || !paused}
        onClick={bridge.resume}
      >
        Play
      </button>
      <button
        type="button"
        className={buttonClassName}
        disabled={!bridge.ready || idle || paused}
        onClick={bridge.pause}
      >
        Pause
      </button>
      <button
        type="button"
        className={buttonClassName}
        disabled={!bridge.ready || idle}
        onClick={bridge.restart}
      >
        Restart
      </button>
      <button
        type="button"
        className={buttonClassName}
        disabled={!bridge.ready}
        aria-pressed={bridge.muted}
        onClick={() => bridge.setMuted(!bridge.muted)}
      >
        {bridge.muted ? "Unmute" : "Mute"}
      </button>
      <button
        type="button"
        className={buttonClassName}
        disabled={!bridge.ready}
        onClick={enterFullscreen}
      >
        Fullscreen
      </button>
      <span className="text-sm opacity-70" data-testid="sandbox-status">
        status: <span className="font-mono">{bridge.status}</span>
      </span>
    </div>
  );
}
