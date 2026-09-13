import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env/public";

/**
 * A Supabase client with no session, for reads that must be evaluated as `anon`.
 *
 * `/play/[slug]` cannot use the request-scoped cookie client, because that client
 * carries the visitor's session and therefore acts as `authenticated`. The
 * public policies are not symmetric (see `20260913133506_phase4_reconcile_rls_policies.sql`):
 *
 * - `games_select_public` is `TO anon, authenticated`
 * - `game_versions_select_public` is `TO anon`
 *
 * and `authenticated` is a sibling of `anon`, not a member of it, so a signed-in
 * visitor matches only `game_versions_select_own`. Reading with the cookie
 * client would let a visitor see a public game's metadata and then fail to load
 * the version behind it — a 404 on every shared link for every logged-in user.
 *
 * Dropping the session for this one read is the fix that changes no policy and
 * widens no grant: the public route always reads as the anonymous public, which
 * is exactly the role those policies were written for. The alternative — adding
 * `authenticated` to the public policy — would also expose `prompt`, `spec` and
 * `error_log` to any signed-in user, because `authenticated` holds a table-level
 * SELECT grant on `game_versions`.
 *
 * No session is stored, so this client is also safe to create per request.
 */
export function createPublicClient() {
  const { supabaseUrl, supabasePublishableKey } = getPublicEnv();

  return createClient(supabaseUrl, supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
