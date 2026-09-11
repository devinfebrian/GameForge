import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Third-party browser bundles copied out of node_modules by
    // scripts/copy-vendor.ts. Our own sandbox files stay linted.
    "public/sandbox/vendor/**",
  ]),
  {
    // The sandbox runs without a bundler, so it relies on globals provided by
    // classic <script> tags and by the runner before code is injected.
    files: ["public/sandbox/**/*.js"],
    languageOptions: {
      globals: {
        Phaser: "readonly",
        soundFx: "readonly",
        assetManifest: "readonly",
      },
    },
  },
]);

export default eslintConfig;
