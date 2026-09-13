import { defineConfig, devices } from "@playwright/test";
import { E2E_ORIGIN, E2E_PORT, e2eEnvironment } from "./e2e/env";

/**
 * Chromium and WebKit.
 *
 * WebKit is not padding: the sandbox's opaque origin means every CSP source
 * expression has to name an origin explicitly, and a `'self'`-based policy
 * matches nothing there and blanks the frame in Safari and iOS. That regression
 * could not be exercised on Windows through any other means.
 *
 * The app is started on its own port with its own Supabase project and
 * GENERATION_FAKE enabled, so a run needs no gateway credentials, costs no
 * tokens, and writes nowhere near the linked project.
 */
export default defineConfig({
  testDir: "./e2e",
  // Deliberately not `*.spec.ts`: `bun test` also globs .spec files and would
  // try to run this one as a unit test. The extension is what keeps the two
  // runners apart.
  testMatch: "**/*.e2e.ts",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI === undefined ? 0 : 1,
  reporter: [["list"]],

  use: {
    baseURL: E2E_ORIGIN,
    trace: "retain-on-failure",
  },

  // Without the E2E env file there is nothing safe to start, so no server is
  // launched and every spec skips itself.
  webServer:
    e2eEnvironment === null
      ? undefined
      : {
          command: `bunx next dev -p ${E2E_PORT}`,
          url: E2E_ORIGIN,
          reuseExistingServer: false,
          timeout: 120_000,
          // Passing these through the child environment is what keeps the run
          // pointed at the E2E project. Next reads process.env before its own
          // .env files, so .env.local's values do not win.
          env: {
            NEXT_PUBLIC_SUPABASE_URL: e2eEnvironment.supabaseUrl,
            NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: e2eEnvironment.publishableKey,
            SUPABASE_SERVICE_ROLE_KEY: e2eEnvironment.serviceRoleKey,
            NEXT_PUBLIC_APP_ORIGIN: E2E_ORIGIN,
            GENERATION_FAKE: "1",
          },
        },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
