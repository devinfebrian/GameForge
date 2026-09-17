"use client";

import { useMemo, useState } from "react";
import { FileCode2, Layers } from "lucide-react";
import { CodeBlock } from "@/components/agents/code-block";
import { FileDiff } from "@/components/agents/file-diff";
import { ImageGeneration } from "@/components/agents/image-generation";
import { computeDiffLines } from "../_lib/diff";

export interface StudioCodePaneProps {
  readonly activeTab: "code" | "assets";
  readonly sourceCode: string | null;
  readonly previousSourceCode: string | null;
  readonly assetManifest: Record<string, string>;
}

export function StudioCodePane({
  activeTab,
  sourceCode,
  previousSourceCode,
  assetManifest,
}: StudioCodePaneProps) {
  const [codeViewMode, setCodeViewMode] = useState<"source" | "diff">("source");

  const diffLines = useMemo(
    () => (sourceCode ? computeDiffLines(previousSourceCode, sourceCode) : []),
    [previousSourceCode, sourceCode],
  );

  if (activeTab === "assets") {
    const entries = Object.entries(assetManifest);

    return (
      <div className="flex-1 min-h-0 flex flex-col bg-background p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-foreground">Kenney 2D Sprites & Assets</h2>
          <span className="text-xs text-muted-foreground font-mono">
            {entries.length} assets mapped
          </span>
        </div>

        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <Layers className="size-8 mb-2 opacity-50" />
            <p className="text-xs">No assets mapped for this version yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {entries.map(([key, url]) => (
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
                    className="size-16 object-contain filter drop-shadow [image-rendering:pixelated]"
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
    );
  }

  // Code Tab
  return (
    <div className="flex-1 min-h-0 flex flex-col bg-background p-4 overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground font-mono">GameScene.ts</span>
          {previousSourceCode && (
            <div className="flex rounded border border-border overflow-hidden text-[11px]">
              <button
                type="button"
                onClick={() => setCodeViewMode("source")}
                className={`px-2 py-0.5 transition-colors ${
                  codeViewMode === "source"
                    ? "bg-secondary text-foreground font-medium"
                    : "text-muted-foreground hover:bg-card"
                }`}
              >
                Source
              </button>
              <button
                type="button"
                onClick={() => setCodeViewMode("diff")}
                className={`px-2 py-0.5 transition-colors ${
                  codeViewMode === "diff"
                    ? "bg-secondary text-foreground font-medium"
                    : "text-muted-foreground hover:bg-card"
                }`}
              >
                Diff
              </button>
            </div>
          )}
        </div>
        <span className="text-[11px] text-muted-foreground font-mono">
          {sourceCode ? `${sourceCode.split("\n").length} lines` : "No code"}
        </span>
      </div>

      {sourceCode ? (
        codeViewMode === "source" ? (
          <CodeBlock
            code={sourceCode}
            language="typescript"
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
  );
}
