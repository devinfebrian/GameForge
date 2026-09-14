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
 * The isolated preview surface, wrapped in browser-style chrome.
 *
 * `allow-same-origin` is present on purpose: this frame is cross-origin to the
 * app, so the flag only lets the document keep its own origin — and therefore its
 * own storage and ES modules — while granting nothing toward the parent. That
 * reasoning collapses if the preview origin ever equals the app origin, which is
 * exactly why `getPublicEnv` returns null rather than a same-origin preview.
 */
export function PreviewFrame({
  frameRef,
  src,
  onLoad,
  onReload,
  title = "Game preview",
}: PreviewFrameProps) {
  // A cross-origin document cannot be asked to reload — its `location` is out of
  // reach — so remounting the element is the reload.
  const [reloadCount, setReloadCount] = useState(0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-white/10 bg-black/30 px-2 py-1.5">
        <span
          className="min-w-0 flex-1 truncate rounded bg-white/5 px-2 py-0.5 font-mono text-xs text-white/60"
          title={src ?? undefined}
        >
          {src ?? "about:blank"}
        </span>
        <button
          type="button"
          onClick={() => {
            setReloadCount((current) => current + 1);
            onReload();
          }}
          className="rounded px-2 py-0.5 text-xs text-white/70 hover:bg-white/10"
        >
          Reload
        </button>
        <a
          href={src ?? "#"}
          target="_blank"
          rel="noreferrer"
          aria-disabled={src === null}
          className="rounded px-2 py-0.5 text-xs text-white/70 hover:bg-white/10"
        >
          Open
        </a>
      </div>
      <iframe
        key={reloadCount}
        ref={frameRef}
        src={src ?? undefined}
        title={title}
        onLoad={onLoad}
        sandbox="allow-scripts allow-same-origin allow-pointer-lock"
        allow="autoplay; fullscreen"
        allowFullScreen
        className="h-full w-full flex-1 border-0 bg-[#0b1020]"
      />
    </div>
  );
}
