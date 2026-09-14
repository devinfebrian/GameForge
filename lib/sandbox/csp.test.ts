import { describe, expect, test } from "bun:test";
import { buildPreviewCsp } from "@/lib/sandbox/csp";

const origins = {
  appOrigin: "http://localhost:3000",
  assetOrigin: "https://project.supabase.co",
};

const previewPolicy = buildPreviewCsp(origins);

describe("buildPreviewCsp", () => {
  // The preview is a real origin, so 'self' resolves and the inline scene/agent/
  // boot tail are the reason unsafe-inline is required.
  test("uses 'self' for its own scripts", () => {
    expect(previewPolicy).toContain("script-src 'self' 'unsafe-inline'");
  });

  test("allows the asset origin for images, media and XHR", () => {
    expect(previewPolicy).toContain("img-src https://project.supabase.co data: blob:");
    expect(previewPolicy).toContain("media-src https://project.supabase.co data: blob:");
    expect(previewPolicy).toContain("connect-src https://project.supabase.co");
  });

  test("locks egress and framing to the app", () => {
    expect(previewPolicy).toContain("default-src 'none'");
    expect(previewPolicy).toContain("form-action 'none'");
    expect(previewPolicy).toContain("frame-ancestors http://localhost:3000");
  });

  test("carries no 'unsafe-eval'", () => {
    expect(previewPolicy).not.toContain("unsafe-eval");
  });
});
