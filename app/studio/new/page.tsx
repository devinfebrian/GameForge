import { requireUser } from "@/lib/dal";
import { getServerEnv } from "@/lib/env/server";
import { createPostgresQuotaStore } from "@/lib/quota/postgres-store";
import { StudioWorkspace } from "../_components/StudioWorkspace";

/**
 * A workspace with no game attached. It renders the same component as an
 * existing game so the prompt, stepper and preview exist in exactly one place;
 * the first completed run navigates to `/studio/[gameId]`.
 */
export default async function NewGamePage() {
  const profile = await requireUser();
  const env = getServerEnv();

  const quota = await createPostgresQuotaStore({
    dailyTokenBudget: env.dailyTokenBudget,
    runBurstPerMinute: env.runBurstPerMinute,
  }).readStatus(profile.id, profile.role === "admin");

  return (
    <StudioWorkspace
      gameId={null}
      title={null}
      currentVersionId={null}
      versions={[]}
      messages={[]}
      quota={quota}
    />
  );
}
