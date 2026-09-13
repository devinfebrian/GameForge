import { slugifyTitle } from "@/lib/games/slug";

/**
 * Triggers a browser download for a generated artifact.
 *
 * The object URL is revoked on the next tick rather than immediately:
 * `click()` starts the download asynchronously, and revoking in the same tick
 * has been observed to cancel it in Safari.
 */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** A filesystem-safe name for a downloaded artifact. */
export function downloadFilename(title: string, extension: string): string {
  const base = slugifyTitle(title);

  return `${base.length > 0 ? base : "game"}.${extension}`;
}
