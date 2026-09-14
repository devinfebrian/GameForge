export interface SandboxCspOrigins {
  readonly appOrigin: string;
  readonly assetOrigin: string;
}

/**
 * The policy for a served preview document.
 *
 * Isolation here comes from the origin, not the sandbox attribute, so `'self'`
 * resolves normally and no `Access-Control-Allow-Origin: *` is needed. The page
 * inlines its scene, agent and boot tail, so `'unsafe-inline'` is required; this
 * origin holds no credentials, which makes the policy's real job locking egress
 * (`connect-src`) and framing (`frame-ancestors`) rather than caging the artifact
 * — the artifact is the code we intend to run.
 */
export function buildPreviewCsp({
  appOrigin,
  assetOrigin,
}: SandboxCspOrigins): string {
  return [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    // Phaser writes inline styles onto its canvas and container.
    "style-src 'unsafe-inline'",
    `img-src ${assetOrigin} data: blob:`,
    `media-src ${assetOrigin} data: blob:`,
    `connect-src ${assetOrigin}`,
    "form-action 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "worker-src 'none'",
    `frame-ancestors ${appOrigin}`,
  ].join("; ");
}
