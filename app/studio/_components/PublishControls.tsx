"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const buttonClassName =
  "rounded border border-black/15 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-white/20";

export interface PublishControlsProps {
  readonly gameId: string | null;
  readonly initialIsPublic: boolean;
  readonly initialPublicSlug: string | null;
}

interface VisibilityResponse {
  readonly isPublic: boolean;
  readonly publicSlug: string | null;
}

/** Reads the `{ error: { message } }` envelope the route returns. */
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();

    if (
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof (payload as { error: { message?: unknown } }).error?.message === "string"
    ) {
      return (payload as { error: { message: string } }).error.message;
    }
  } catch {
    // Fall through to the generic message.
  }

  return "That change could not be saved.";
}

/**
 * Publish/unpublish for the Studio header.
 *
 * State is taken from the response rather than from a re-read, so the control
 * reflects the write that just happened without a round trip. `router.refresh()`
 * still runs, because the games list and the workspace both show publication
 * state and the server has to agree.
 */
export function PublishControls({
  gameId,
  initialIsPublic,
  initialPublicSlug,
}: PublishControlsProps) {
  const router = useRouter();
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [publicSlug, setPublicSlug] = useState(initialPublicSlug);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const playPath = publicSlug === null ? null : `/play/${publicSlug}`;

  async function setVisibility(next: boolean): Promise<void> {
    if (gameId === null || busy) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/games/${gameId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic: next }),
      });

      if (!response.ok) {
        setError(await readErrorMessage(response));

        return;
      }

      const payload = (await response.json()) as VisibilityResponse;

      setIsPublic(payload.isPublic);
      setPublicSlug(payload.publicSlug);
      router.refresh();
    } catch {
      setError("That change could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(): Promise<void> {
    if (playPath === null) {
      return;
    }

    try {
      await navigator.clipboard.writeText(`${window.location.origin}${playPath}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("The link could not be copied.");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={buttonClassName}
        disabled={gameId === null || busy}
        onClick={() => void setVisibility(!isPublic)}
      >
        {isPublic ? "Unpublish" : "Publish"}
      </button>

      {isPublic && playPath !== null ? (
        <>
          <a
            className="text-sm underline opacity-80"
            href={playPath}
            target="_blank"
            rel="noreferrer"
            data-testid="play-link"
          >
            {playPath}
          </a>
          <button
            type="button"
            className={buttonClassName}
            onClick={() => void copyLink()}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </>
      ) : null}

      {error === null ? null : (
        <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
      )}
    </div>
  );
}
