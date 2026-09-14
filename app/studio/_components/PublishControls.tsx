"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Copy, Globe, Rocket } from "lucide-react";

const buttonClassName =
  "inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/80 px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40";

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
 * Replit-styled Publish/Deploy controls for the Studio workspace.
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
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <button
        type="button"
        className={`${buttonClassName} ${
          isPublic
            ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-900/40"
            : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
        }`}
        disabled={gameId === null || busy}
        onClick={() => void setVisibility(!isPublic)}
      >
        <Rocket className="size-3.5" />
        {isPublic ? "Unpublish" : "Publish"}
      </button>

      {isPublic && playPath !== null ? (
        <div className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1">
          <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
          <Globe className="size-3 text-muted-foreground" />
          <a
            className="font-mono text-xs text-emerald-400 hover:underline"
            href={playPath}
            target="_blank"
            rel="noreferrer"
            data-testid="play-link"
          >
            {playPath}
          </a>
          <button
            type="button"
            className="ml-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => void copyLink()}
            title="Copy link"
          >
            {copied ? (
              <>
                <Check className="size-3 text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="size-3" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      ) : null}

      {error === null ? null : (
        <span className="text-xs text-rose-400">{error}</span>
      )}
    </div>
  );
}
