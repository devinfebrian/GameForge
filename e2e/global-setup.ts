import { request } from "@playwright/test";
import { e2eEnvironment } from "./env";

/**
 * Provisions the test account in the E2E project.
 *
 * The admin API is used directly rather than the signup form because a hosted
 * project may have email confirmation enabled, which would leave the account
 * unusable without an inbox. `email_confirm: true` sidesteps that.
 *
 * Note the `apikey` header carries the secret on its own. Supabase's newer
 * `sb_secret_…` keys are rejected by the gateway when also sent as
 * `Authorization: Bearer`, which is easy to mistake for a bad credential.
 */
export default async function globalSetup(): Promise<void> {
  if (e2eEnvironment === null) {
    return;
  }

  const host = new URL(e2eEnvironment.supabaseUrl).host;
  console.log(`[e2e] provisioning test user in ${host}`);

  const api = await request.newContext();

  try {
    const response = await api.post(
      `${e2eEnvironment.supabaseUrl}/auth/v1/admin/users`,
      {
        headers: { apikey: e2eEnvironment.serviceRoleKey },
        data: {
          email: e2eEnvironment.email,
          password: e2eEnvironment.password,
          email_confirm: true,
        },
      },
    );

    // 422 is "already registered", which is the steady state on every run after
    // the first. Anything else is a real setup failure worth stopping for.
    if (!response.ok() && response.status() !== 422) {
      throw new Error(
        `Could not provision the E2E user: HTTP ${response.status()} ${await response.text()}`,
      );
    }
  } finally {
    await api.dispose();
  }
}
