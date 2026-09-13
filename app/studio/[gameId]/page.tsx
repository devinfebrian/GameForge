import { notFound } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/dal";
import { getGameWorkspace } from "@/lib/games/repository";
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

  return (
    <StudioWorkspace
      gameId={workspace.id}
      title={workspace.title}
      currentVersionId={workspace.currentVersionId}
      versions={workspace.versions}
      messages={workspace.messages}
    />
  );
}
