"use client";

import type { SandboxBridge } from "@/lib/sandbox/useSandboxBridge";
import {
  Maximize,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";

const controlBtnClass =
  "inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/80 px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40";

export interface RuntimeControlsProps {
  readonly bridge: SandboxBridge;
}

/**
 * AgentUI-styled media transport controls for the game preview canvas.
 */
export function RuntimeControls({ bridge }: RuntimeControlsProps) {
  const idle = bridge.status === "idle";
  const paused = bridge.status === "paused";
  const running = bridge.status === "running";
  const isError = bridge.status === "error";

  function enterFullscreen(): void {
    void bridge.frameRef.current?.requestFullscreen();
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card/80 px-3 py-2 shadow-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className={controlBtnClass}
          disabled={!bridge.ready || idle || !paused}
          onClick={bridge.resume}
          title="Play"
        >
          <Play className="size-3 text-emerald-400 fill-emerald-400" />
          Play
        </button>

        <button
          type="button"
          className={controlBtnClass}
          disabled={!bridge.ready || idle || paused}
          onClick={bridge.pause}
          title="Pause"
        >
          <Pause className="size-3 text-amber-400 fill-amber-400" />
          Pause
        </button>

        <button
          type="button"
          className={controlBtnClass}
          disabled={!bridge.ready || idle}
          onClick={bridge.restart}
          title="Restart"
        >
          <RotateCcw className="size-3 text-muted-foreground" />
          Restart
        </button>

        <button
          type="button"
          className={controlBtnClass}
          disabled={!bridge.ready}
          aria-pressed={bridge.muted}
          onClick={() => bridge.setMuted(!bridge.muted)}
          title={bridge.muted ? "Unmute" : "Mute"}
        >
          {bridge.muted ? (
            <>
              <VolumeX className="size-3 text-rose-400" />
              Unmute
            </>
          ) : (
            <>
              <Volume2 className="size-3 text-muted-foreground" />
              Mute
            </>
          )}
        </button>

        <button
          type="button"
          className={controlBtnClass}
          disabled={!bridge.ready}
          onClick={enterFullscreen}
          title="Fullscreen"
        >
          <Maximize className="size-3 text-muted-foreground" />
          Fullscreen
        </button>
      </div>

      <div
        className="flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-2.5 py-0.5 text-xs text-muted-foreground"
        data-testid="sandbox-status"
      >
        <span
          className={`size-2 rounded-full ${
            running
              ? "bg-emerald-400 animate-pulse"
              : paused
                ? "bg-amber-400"
                : isError
                  ? "bg-rose-500"
                  : "bg-muted-foreground"
          }`}
        />
        <span>
          status: <span className="font-mono font-medium text-foreground">{bridge.status}</span>
        </span>
      </div>
    </div>
  );
}
