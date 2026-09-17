import { packageRuntimeDocument } from "@/lib/runtime-document/packager";

export interface PreviewDocumentInput {
  readonly title: string;
  readonly sceneSource: string;
  readonly assetManifest: Record<string, string>;
  /** Audio manifest: event key -> URL (file-based audio only). Empty if all sounds are jsfxr. */
  readonly audioManifest?: Record<string, string>;
  /** The contents of `public/sandbox/sound.js`, an ES module, read for stripping. */
  readonly soundSource: string;
  /** The app origin the frame posts bridge messages to. */
  readonly appOrigin: string;
}

/**
 * The whole served preview page.
 *
 * Unlike the export, vendor libraries are referenced by URL rather than inlined:
 * this document is always served over HTTP from its own origin, so the browser
 * can cache ~1MB of Phaser instead of re-receiving it with every preview. Only
 * the parts that must be generated per request — the scene, the agent and the
 * boot tail — are inlined, and every one of them is escaped because the scene is
 * machine-generated text that could contain a script terminator.
 */
export function buildPreviewDocument(input: PreviewDocumentInput): string {
  return packageRuntimeDocument({
    target: "preview",
    title: input.title,
    sceneSource: input.sceneSource,
    assetManifest: input.assetManifest,
    audioManifest: input.audioManifest,
    soundSource: input.soundSource,
    appOrigin: input.appOrigin,
  });
}

