import {
  buildBootTail,
  buildPageStyles as buildPackagerPageStyles,
} from "@/lib/runtime-document/packager";

/**
 * The tail script of every exported artifact: bake the manifests, warm the audio
 * path from a real gesture, then boot.
 */
export function buildBootScript(
  assetManifest: Record<string, string>,
  audioManifest?: Record<string, string>,
): string {
  return buildBootTail({
    assetManifest,
    audioManifest,
    assignGameGlobal: false,
  });
}

/** The page shell both artifacts share: a sized container on a dark field. */
export function buildPageStyles(): string {
  return buildPackagerPageStyles();
}
