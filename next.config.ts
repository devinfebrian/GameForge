import type { NextConfig } from "next";
import { getPublicEnv } from "./lib/env/public";
import { buildSandboxCsp } from "./lib/sandbox/csp";

// Read directly rather than through the "@/" alias: next.config.ts is evaluated
// outside the app's path mapping. getPublicEnv also validates these centrally, so
// a misconfigured environment fails here with the same message it would elsewhere.
const { appOrigin, supabaseUrl } = getPublicEnv();

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Only the sandbox frame gets a policy. The parent app is unchanged.
        source: "/sandbox/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: buildSandboxCsp({ appOrigin, assetOrigin: supabaseUrl }),
          },
          {
            // Required, not optional. The frame runs in an opaque origin, so the
            // browser sends `Origin: null` for everything it requests -- and ES
            // modules are ALWAYS fetched in CORS mode, unlike classic scripts.
            // Without this header the browser blocks /sandbox/runner.js, the
            // runner never executes, and the frame silently hangs at "booting"
            // with no canvas and no error. `*` is the only value that can work,
            // since an opaque origin cannot be named, and these are public static
            // assets with no credentials.
            key: "Access-Control-Allow-Origin",
            value: "*",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
