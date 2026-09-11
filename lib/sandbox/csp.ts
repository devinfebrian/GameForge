export interface SandboxCspOrigins {
  readonly appOrigin: string;
  readonly assetOrigin: string;
}

/**
 * The sandbox runs with `sandbox="allow-scripts"` and no `allow-same-origin`, so
 * its documents have an opaque origin. Every source expression must therefore be
 * an explicit origin: CSP's `'self'` keyword resolves against the opaque origin
 * and matches nothing in WebKit, which blanks the frame on Safari and iOS.
 */
export function buildSandboxCsp({
  appOrigin,
  assetOrigin,
}: SandboxCspOrigins): string {
  return [
    "default-src 'none'",
    // blob: is required because LOAD_CODE injects the scene as a Blob URL script.
    `script-src ${appOrigin} blob:`,
    // Phaser writes inline styles onto its canvas and container.
    "style-src 'unsafe-inline'",
    `img-src ${assetOrigin} data: blob:`,
    // jsfxr renders each sound to a WAV data URI and plays it through <audio>.
    `media-src ${assetOrigin} data: blob:`,
    `connect-src ${assetOrigin}`,
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "worker-src 'none'",
    // Only effective as a header, which is why this is not a meta tag.
    `frame-ancestors ${appOrigin}`,
  ].join("; ");
}
