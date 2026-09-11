import { describe, expect, test } from "bun:test";
import { buildSandboxCsp } from "@/lib/sandbox/csp";

const policy = buildSandboxCsp({
  appOrigin: "http://localhost:3000",
  assetOrigin: "https://project.supabase.co",
});

describe("buildSandboxCsp", () => {
  test("never emits 'self'", () => {
    // The frame has an opaque origin, so 'self' matches nothing in WebKit and
    // the sandbox would render blank on Safari and iOS.
    expect(policy).not.toContain("'self'");
  });

  test("names the app origin explicitly for scripts", () => {
    expect(policy).toContain("script-src http://localhost:3000 blob:");
  });

  test("allows the asset origin for images, media and XHR", () => {
    expect(policy).toContain("img-src https://project.supabase.co data: blob:");
    expect(policy).toContain("media-src https://project.supabase.co data: blob:");
    expect(policy).toContain("connect-src https://project.supabase.co");
  });

  test("locks egress and framing", () => {
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("form-action 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("frame-ancestors http://localhost:3000");
  });

  test("carries no 'unsafe-eval'", () => {
    // Verified against phaser 3.90.0: its only new Function call sits behind a
    // globalThis guard that modern browsers never reach.
    expect(policy).not.toContain("unsafe-eval");
  });
});
