"use client";

import { useState, type RefObject } from "react";

export interface PreviewFrameProps {
  readonly frameRef: RefObject<HTMLIFrameElement | null>;
  readonly src: string | null;
  readonly onLoad: () => void;
  readonly onReload: () => void;
  readonly title?: string;
}

/**
 * The isolated preview surface, wrapped in Replit-styled browser chrome.
 */
export function PreviewFrame({
  frameRef,
  src,
  onLoad,
  onReload,
  title = "Game preview",
}: PreviewFrameProps) {
  const [reloadCount, setReloadCount] = useState(0);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#0a0c10]">
      {/* Browser Bar */}
      <div className="flex items-center gap-2 border-b border-[#212634] bg-[#0e1117] px-3 py-1.5 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-zinc-600" />
          <span className="h-2 w-2 rounded-full bg-zinc-600" />
          <span className="h-2 w-2 rounded-full bg-zinc-600" />
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-[#212634] bg-[#141824] px-2.5 py-0.5">
          <svg
            className="text-zinc-500 flex-shrink-0"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
          <span
            className="truncate font-mono text-[11px] text-zinc-400"
            title={src ?? undefined}
          >
            {src ?? "about:blank"}
          </span>
        </div>

        <button
          type="button"
          onClick={() => {
            setReloadCount((current) => current + 1);
            onReload();
          }}
          className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs text-zinc-300 hover:bg-[#1f2536] hover:text-white transition-colors"
          title="Reload preview"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 2v6h-6" />
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
          </svg>
          Reload
        </button>

        <a
          href={src ?? "#"}
          target="_blank"
          rel="noreferrer"
          aria-disabled={src === null}
          className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs text-zinc-300 hover:bg-[#1f2536] hover:text-white transition-colors ${
            src === null ? "pointer-events-none opacity-40" : ""
          }`}
          title="Open in new window"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
          Open
        </a>
      </div>

      {/* Frame Viewport */}
      <div className="relative flex-1 flex items-center justify-center bg-[#07090e] p-2">
        <iframe
          key={reloadCount}
          ref={frameRef}
          src={src ?? undefined}
          title={title}
          onLoad={onLoad}
          sandbox="allow-scripts allow-same-origin allow-pointer-lock"
          allow="autoplay; fullscreen"
          allowFullScreen
          className="h-full w-full rounded-md border border-[#1b212f] bg-[#000000] shadow-2xl"
        />
      </div>
    </div>
  );
}
