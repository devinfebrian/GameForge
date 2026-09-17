import type { ExportVendorSources } from "./vendor";
import { packageRuntimeDocument } from "@/lib/runtime-document/packager";

export interface StandaloneInput {
  readonly title: string;
  readonly sceneSource: string;
  readonly assetManifest: Record<string, string>;
  /** File-based audio manifest (event key -> URL). */
  readonly audioManifest?: Record<string, string>;
  readonly vendor: ExportVendorSources;
}

/**
 * A single self-contained `index.html`.
 */
export function buildStandaloneHtml(input: StandaloneInput): string {
  return packageRuntimeDocument({
    target: "standalone",
    title: input.title,
    sceneSource: input.sceneSource,
    assetManifest: input.assetManifest,
    audioManifest: input.audioManifest,
    vendor: input.vendor,
  });
}
