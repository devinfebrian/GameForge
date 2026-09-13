import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export interface OwnedGame {
  readonly id: string;
  readonly userId: string;
}

/**
 * Reads a game and its owner together so a caller can check ownership without
 * trusting a client-supplied id.
 *
 * The service-role client bypasses RLS, which is why the `user_id` comparison
 * happens here rather than being delegated to a policy: this file is the only
 * place a game is looked up by id on behalf of a request.
 */
export async function findOwnedGame(
  gameId: string,
  userId: string,
): Promise<OwnedGame | null> {
  const { data, error } = await createAdminClient()
    .from("games")
    .select("id, user_id")
    .eq("id", gameId)
    .maybeSingle();

  if (error !== null) {
    throw new Error(`Failed to load game ${gameId}: ${error.message}`);
  }

  if (data === null || data.user_id !== userId) {
    return null;
  }

  return {
    id: data.id as string,
    userId: data.user_id as string,
  };
}
