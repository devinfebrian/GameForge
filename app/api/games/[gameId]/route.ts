import { z } from "zod";
import { getCurrentProfile } from "@/lib/dal";
import { setGameVisibility } from "@/lib/games/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  gameId: z.uuid(),
});

const visibilityBodySchema = z.object({
  isPublic: z.boolean(),
});

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/**
 * Publishes or unpublishes a game.
 *
 * A route handler rather than a Server Action because the Studio is already a
 * client component that mutates through `fetch` — rollback and the stability
 * write-back both work this way — and because the in-process route tests can
 * assert the resulting HTTP status for a refusal.
 *
 * The response carries the slug, not a full URL. The only caller runs in the
 * browser and already knows its own origin, so building the link here would mean
 * reading `NEXT_PUBLIC_APP_ORIGIN` on the server for a value the client gets for
 * free — and it would make the route depend on env the tests would then have to
 * stub.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> },
): Promise<Response> {
  const profile = await getCurrentProfile();

  if (profile === null) {
    return Response.json(
      { error: { code: "unauthorized", message: "Sign in to publish games." } },
      { status: 401 },
    );
  }

  const ids = paramsSchema.safeParse(await params);

  if (!ids.success) {
    return Response.json(
      { error: { code: "invalid_params", message: "Malformed game id." } },
      { status: 400 },
    );
  }

  const body = visibilityBodySchema.safeParse(await readJsonBody(request));

  if (!body.success) {
    return Response.json(
      { error: { code: "invalid_body", message: "Expected an isPublic boolean." } },
      { status: 400 },
    );
  }

  const result = await setGameVisibility({
    gameId: ids.data.gameId,
    userId: profile.id,
    isPublic: body.data.isPublic,
  });

  if (result.kind === "not_found") {
    return Response.json(
      { error: { code: "game_not_found", message: "No such game for this user." } },
      { status: 404 },
    );
  }

  return Response.json({
    isPublic: result.publication.isPublic,
    publicSlug: result.publication.publicSlug,
  });
}
