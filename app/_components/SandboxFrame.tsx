"use client";

import type { RefObject } from "react";

export interface SandboxFrameProps {
  readonly frameRef: RefObject<HTMLIFrameElement | null>;
  readonly onLoad: () => void;
  readonly title?: string;
}

/**
 * The untrusted execution surface. Product-shaped so the Phase 4 Studio imports
 * this rather than rebuilding the iframe attributes.
 *
 * `allow-scripts` without `allow-same-origin` is what creates the opaque origin:
 * it removes access to cookies, storage, and the parent document. `allow` is a
 * separate mechanism from `sandbox` and is what lets jsfxr produce audio.
 */
export function SandboxFrame({
  frameRef,
  onLoad,
  title = "Game preview",
}: SandboxFrameProps) {
  return (
    <iframe
      ref={frameRef}
      src="/sandbox/index.html"
      title={title}
      onLoad={onLoad}
      sandbox="allow-scripts"
      allow="autoplay"
      className="h-full w-full border-0"
    />
  );
}
