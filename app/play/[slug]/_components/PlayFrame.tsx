"use client";

import { useEffect, useRef } from "react";
import { SandboxFrame } from "@/app/_components/SandboxFrame";
import { useSandboxBridge } from "@/lib/sandbox/useSandboxBridge";

const buttonClassName =
  "rounded border border-black/15 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-white/20";

export interface PlayFrameProps {
  readonly title: string;
  readonly sourceCode: string;
  readonly assetManifest: Record<string, string>;
}

/**
 * The public player.
 *
 * It reuses the sandbox document and the bridge rather than a bespoke runtime:
 * the same opaque-origin frame, the same `LOAD_CODE` contract, and the same CSP
 * already cover this case, and a second runtime would be a second thing to keep
 * in step with the scene contract.
 *
 * There is no probation, no repair and no mutation here — nothing on this page
 * may write. Sound unlocks on the visitor's first click via the runner's own
 * gesture handler.
 */
export function PlayFrame({ title, sourceCode, assetManifest }: PlayFrameProps) {
  const bridge = useSandboxBridge();
  const { ready, loadCode } = bridge;
  // A ref, not state: React's strict mode runs the effect twice in development,
  // and a second LOAD_CODE would restart the game under the player.
  const bootedRef = useRef(false);

  useEffect(() => {
    if (!ready || bootedRef.current) {
      return;
    }

    bootedRef.current = true;
    loadCode(sourceCode, assetManifest);
  }, [ready, loadCode, sourceCode, assetManifest]);

  function enterFullscreen(): void {
    void bridge.frameRef.current?.requestFullscreen();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="h-[min(70vh,540px)] overflow-hidden rounded border border-black/15 bg-[#0b1020] dark:border-white/20">
        <SandboxFrame
          frameRef={bridge.frameRef}
          onLoad={bridge.handleFrameLoad}
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
