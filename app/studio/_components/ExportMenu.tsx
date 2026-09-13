"use client";

import { useState } from "react";
import { fetchAsBytes, fetchAsDataUri, fileExtension } from "@/lib/export/assets";
import { buildZipEntries } from "@/lib/export/bundle";
import { downloadBlob, downloadFilename } from "@/lib/export/download";
import { buildStandaloneHtml } from "@/lib/export/standalone";
import { fetchVendorSources } from "@/lib/export/vendor";
import { buildZip } from "@/lib/export/zip";

const buttonClassName =
  "rounded border border-black/15 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-white/20";

export interface ExportMenuProps {
  readonly gameId: string | null;
  readonly title: string | null;
  /** The version being viewed, so the timeline can export history too. */
  readonly versionId: string | null;
}

type Format = "html" | "zip";

interface BootPayload {
  readonly sourceCode: string;
  readonly assetManifest: Record<string, string>;
  readonly bootable: boolean;
  readonly bootReason: string | null;
}

/**
 * Assembles both downloadable artifacts in the browser.
 *
 * Doing it here rather than in a route handler is what keeps the ~1 MB vendored
 * Phaser out of the server bundle: the files are already fetchable from
 * `/sandbox/vendor/`, and the sprites are already readable cross-origin from the
 * public bucket, so the server never has to read a filesystem that may not carry
 * `public/` on the deploy platform.
 *
 * The version exported is the one on screen. Exporting the current version
 * instead would make the timeline's Preview button lie about which snapshot the
 * download contains.
 */
export function ExportMenu({ gameId, title, versionId }: ExportMenuProps) {
  const [busy, setBusy] = useState<Format | null>(null);
  const [error, setError] = useState<string | null>(null);

  const disabled = gameId === null || versionId === null || busy !== null;

  async function run(format: Format): Promise<void> {
    if (gameId === null || versionId === null || busy !== null) {
      return;
    }

    setBusy(format);
    setError(null);

    try {
      const response = await fetch(`/api/games/${gameId}/versions/${versionId}`);

      if (!response.ok) {
        setError("This version could not be loaded.");

        return;
      }

      const boot = (await response.json()) as BootPayload;

      // The same gate the sandbox uses. Exporting a scene the Studio refuses to
      // boot would produce a file that only fails once it is already downloaded.
      if (!boot.bootable) {
        setError(boot.bootReason ?? "This version cannot be exported.");

        return;
      }

      const vendor = await fetchVendorSources();
      const exportTitle = title ?? "Game";
      const urls = Object.entries(boot.assetManifest);

      if (format === "html") {
        const assets = await Promise.all(
          urls.map(async ([entityId, url]) => [entityId, await fetchAsDataUri(url)] as const),
        );

        const html = buildStandaloneHtml({
          title: exportTitle,
          sceneSource: boot.sourceCode,
          assetManifest: Object.fromEntries(assets),
          vendor,
        });

        downloadBlob(
          downloadFilename(exportTitle, "html"),
          new Blob([html], { type: "text/html" }),
        );

        return;
      }

      const sprites = await Promise.all(
        urls.map(async ([entityId, url]) => ({
          entityId,
          extension: fileExtension(url) || "png",
          bytes: await fetchAsBytes(url),
        })),
      );

      const archive = buildZip(
        buildZipEntries({
          title: exportTitle,
          sceneSource: boot.sourceCode,
          vendor,
          assets: sprites,
        }),
      );

      downloadBlob(
        downloadFilename(exportTitle, "zip"),
        new Blob([archive], { type: "application/zip" }),
      );
    } catch {
      setError("The export could not be built.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={buttonClassName}
        disabled={disabled}
        onClick={() => void run("html")}
      >
        {busy === "html" ? "Building..." : "Export HTML"}
      </button>
      <button
        type="button"
        className={buttonClassName}
        disabled={disabled}
        onClick={() => void run("zip")}
      >
        {busy === "zip" ? "Building..." : "Export ZIP"}
      </button>

      {error === null ? null : (
        <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
      )}
    </div>
  );
}
