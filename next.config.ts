import type { NextConfig } from "next";
import { getPublicEnv } from "./lib/env/public";
import { buildPreviewCsp } from "./lib/sandbox/csp";

// Read directly rather than through the "@/" alias: next.config.ts is evaluated
// outside the app's path mapping. getPublicEnv also validates these centrally, so
// a misconfigured environment fails here with the same message it would elsewhere.
const { appOrigin, supabaseUrl } = getPublicEnv();

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // The isolated preview gets its own policy. It is a real origin, so
        // 'self' resolves normally; the frame must be embeddable only by the app.
        source: "/preview/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: buildPreviewCsp({ appOrigin, assetOrigin: supabaseUrl }),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
