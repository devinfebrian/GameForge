"use client";

import { AlertCircle } from "lucide-react";
import { PreviewFrame } from "@/app/_components/PreviewFrame";
import type { SandboxBridge } from "../_hooks/usePreviewSync";
import { RuntimeControls } from "./RuntimeControls";

export interface StudioPreviewPaneProps {
  readonly bridge: SandboxBridge;
  readonly bootError: string | null;
  readonly onReload: () => void;
}

export function StudioPreviewPane({
  bridge,
  bootError,
  onReload,
}: StudioPreviewPaneProps) {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {bootError && (
        <div className="m-3 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive-foreground">
          <AlertCircle className="size-4 shrink-0" />
          <span>{bootError}</span>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden">
        <PreviewFrame
          frameRef={bridge.frameRef}
          src={bridge.previewUrl}
          onLoad={bridge.handleFrameLoad}
          onReload={onReload}
        />
      </div>

      <div className="p-3 border-t border-border bg-card/60">
        <RuntimeControls bridge={bridge} />
      </div>
    </div>
  );
}
