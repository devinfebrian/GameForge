import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/dal";
import { getServerEnv } from "@/lib/env/server";
import { getGameWorkspace } from "@/lib/games/repository";
import { createPostgresQuotaStore } from "@/lib/quota/postgres-store";
import type { QuotaStatus } from "@/lib/quota/types";
import { StudioWorkspace } from "../_components/StudioWorkspace";

const paramsSchema = z.object({ gameId: z.uuid() });

export default async function StudioGamePage({
  params,
}: PageProps<"/studio/[gameId]">) {
  const profile = await requireUser();
  const parsed = paramsSchema.safeParse(await params);

  if (!parsed.success) {
    notFound();
  }

  // Reads through the service-role DAL, user-scoped. A game belonging to someone
  // else is indistinguishable from one that does not exist.
  const workspace = await getGameWorkspace(parsed.data.gameId, profile.id);

  if (workspace === null) {
    notFound();
  }

  const env = getServerEnv();

  // The budget bar is informational, so a failed read omits it rather than
  // taking the whole Studio page down.
  let quota: QuotaStatus | null;

  try {
    quota = await createPostgresQuotaStore({
      dailyTokenBudget: env.dailyTokenBudget,
      runBurstPerMinute: env.runBurstPerMinute,
    }).readStatus(profile.id, profile.role === "admin");
  } catch {
    quota = null;
  }

  return (
    <StudioWorkspace
      gameId={workspace.id}
      title={workspace.title}
      currentVersionId={workspace.currentVersionId}
      isPublic={workspace.isPublic}
      publicSlug={workspace.publicSlug}
      versions={workspace.versions}
      messages={workspace.messages}
      quota={quota}
    />
  );
}
