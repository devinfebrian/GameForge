"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { useSandboxBridge } from "@/lib/sandbox/useSandboxBridge";

export type SandboxBridge = ReturnType<typeof useSandboxBridge>;

export const PROBATION_MS = 3000;
export const BOOT_ATTEMPTS = 3;
export const BOOT_RETRY_DELAY_MS = 400;

export interface BootPayload {
  readonly sourceCode: string;
  readonly assetManifest: Record<string, string>;
  readonly bootable: boolean;
  readonly bootReason: string | null;
  readonly previewUrl: string | null;
}

export interface UsePreviewSyncOptions {
  readonly gameId: string | null;
  readonly currentVersionId: string | null;
  readonly bridge: SandboxBridge;
}

export interface UsePreviewSyncReturn {
  readonly bootVersionId: string | null;
  readonly previewVersionId: string | null;
  readonly isPreviewingOther: boolean;
  readonly bootError: string | null;
  readonly sourceCode: string | null;
  readonly previousSourceCode: string | null;
  readonly assetManifest: Record<string, string>;
  readonly previewOpen: boolean;
  readonly previewExpanded: boolean;
  readonly openPreview: () => void;
  readonly closePreview: () => void;
  readonly togglePreview: () => void;
  readonly setPreviewExpanded: (expanded: boolean) => void;
  readonly previewVersion: (versionId: string) => void;
  readonly rollbackVersion: (versionId: string) => Promise<boolean>;
  readonly switchVersionAfterRun: (versionId: string) => void;
  readonly reloadCurrentVersion: () => void;
}

export function parseBootFailure(status: number | null, reason: string | null): string {
  if (reason !== null) {
    return reason;
  }
  if (status !== null) {
    return `This version could not be loaded (HTTP ${status}).`;
  }
  return "This version cannot be run.";
}

function useDocumentHidden(): boolean {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const update = (): void => setHidden(document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  return hidden;
}

export function usePreviewSync(options: UsePreviewSyncOptions): UsePreviewSyncReturn {
  const { gameId, currentVersionId, bridge } = options;
  const { loadPreview, ready, status } = bridge;
  const router = useRouter();
  const hidden = useDocumentHidden();

  const [bootVersionId, setBootVersionId] = useState<string | null>(currentVersionId);
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(currentVersionId);
  const [evaluateVersionId, setEvaluateVersionId] = useState<string | null>(currentVersionId);

  const [loadedSourceCode, setLoadedSourceCode] = useState<string | null>(null);
  const [previousSourceCode, setPreviousSourceCode] = useState<string | null>(null);
  const [loadedAssetManifest, setLoadedAssetManifest] = useState<Record<string, string>>({});
  const [bootError, setBootError] = useState<string | null>(null);

  const [userPreviewOpen, setUserPreviewOpen] = useState<boolean | null>(null);
  const [previewExpanded, setPreviewExpanded] = useState(false);

  const bootedRef = useRef<string | null>(null);

  const previewOpen = userPreviewOpen ?? (status === "running");

  const openPreview = useCallback(() => {
    setUserPreviewOpen(true);
  }, []);

  const closePreview = useCallback(() => {
    setPreviewExpanded(false);
    setUserPreviewOpen(false);
  }, []);

  const togglePreview = useCallback(() => {
    setUserPreviewOpen((current) => !(current ?? (status === "running")));
  }, [status]);

  const boot = useCallback(
    async (versionId: string) => {
      setBootError(null);
      let lastStatus: number | null = null;

      for (let attempt = 1; attempt <= BOOT_ATTEMPTS; attempt += 1) {
        try {
          const response = await fetch(`/api/games/${gameId}/versions/${versionId}`);

          if (response.ok) {
            const payload = (await response.json()) as BootPayload;

            if (!payload.bootable) {
              setBootError(parseBootFailure(null, payload.bootReason));
              return;
            }

            setLoadedSourceCode((prev) => {
              setPreviousSourceCode(prev);
              return payload.sourceCode;
            });
            setLoadedAssetManifest(payload.assetManifest ?? {});

            if (payload.previewUrl === null) {
              setBootError("Isolated previews are not configured (NEXT_PUBLIC_PREVIEW_ORIGIN).");
              return;
            }

            loadPreview(payload.previewUrl);
            return;
          }

          lastStatus = response.status;
          if (response.status < 500) {
            setBootError(`This version could not be loaded (HTTP ${response.status}).`);
            return;
          }
        } catch {
          lastStatus = null;
        }

        if (attempt < BOOT_ATTEMPTS) {
          await new Promise((resolve) => {
            setTimeout(resolve, BOOT_RETRY_DELAY_MS * attempt);
          });
        }
      }

      setBootError(
        lastStatus === null
          ? "This version could not be loaded. Check the connection and try again."
          : `This version could not be loaded (HTTP ${lastStatus}).`,
      );
    },
    [gameId, loadPreview],
  );

  useEffect(() => {
    if (!ready || bootVersionId === null) {
      return;
    }

    if (bootedRef.current === bootVersionId) {
      return;
    }

    bootedRef.current = bootVersionId;
    void boot(bootVersionId);
  }, [ready, bootVersionId, boot]);

  const commitStability = useCallback(
    async (versionId: string) => {
      if (gameId === null) return;

      try {
        await fetch(`/api/games/${gameId}/versions/${versionId}/stability`, {
          method: "PATCH",
        });
      } catch {
        // Best effort
      }

      setEvaluateVersionId((current) => (current === versionId ? null : current));
      router.refresh();
    },
    [gameId, router],
  );

  // Probation timer: commit stability after running continuously for PROBATION_MS
  useEffect(() => {
    if (gameId === null || evaluateVersionId === null) return;
    if (status !== "running" || hidden) return;

    const versionId = evaluateVersionId;
    const timer = setTimeout(() => {
      void commitStability(versionId);
    }, PROBATION_MS);

    return () => clearTimeout(timer);
  }, [gameId, evaluateVersionId, status, hidden, commitStability]);

  // Handle Escape key when preview is expanded
  useEffect(() => {
    if (!previewExpanded) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPreviewExpanded(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewExpanded]);

  const previewVersion = useCallback((versionId: string) => {
    setUserPreviewOpen(true);
    setPreviewVersionId(versionId);
    setBootVersionId(versionId);
    setEvaluateVersionId(null);
  }, []);

  const rollbackVersion = useCallback(
    async (versionId: string): Promise<boolean> => {
      if (gameId === null) return false;

      try {
        const response = await fetch(
          `/api/games/${gameId}/versions/${versionId}/rollback`,
          { method: "POST" },
        );

        if (!response.ok) {
          return false;
        }

        setBootVersionId(versionId);
        setPreviewVersionId(versionId);
        setEvaluateVersionId(null);
        router.refresh();
        return true;
      } catch {
        return false;
      }
    },
    [gameId, router],
  );

  const switchVersionAfterRun = useCallback((versionId: string) => {
    setBootVersionId(versionId);
    setPreviewVersionId(versionId);
    setEvaluateVersionId(versionId);
    setUserPreviewOpen(null);
  }, []);

  const reloadCurrentVersion = useCallback(() => {
    if (bootVersionId !== null) {
      bootedRef.current = null;
      void boot(bootVersionId);
    }
  }, [boot, bootVersionId]);

  const isPreviewingOther =
    previewVersionId !== null && previewVersionId !== currentVersionId;

  return {
    bootVersionId,
    previewVersionId,
    isPreviewingOther,
    bootError,
    sourceCode: loadedSourceCode,
    previousSourceCode,
    assetManifest: loadedAssetManifest,
    previewOpen,
    previewExpanded,
    openPreview,
    closePreview,
    togglePreview,
    setPreviewExpanded,
    previewVersion,
    rollbackVersion,
    switchVersionAfterRun,
    reloadCurrentVersion,
  };
}
