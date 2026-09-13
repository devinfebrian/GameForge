import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createDalDouble, dalDouble, type DalDoubleProfile } from "@/lib/dal.double";
import { adminDouble, createAdminClientDouble } from "@/lib/supabase/admin.double";

/**
 * Route-level tests for publish/unpublish.
 *
 * The repository is left real and driven through the shared service-role double,
 * so this covers the wiring the unit tests cannot see: the auth gate, the two
 * 400 paths, the 404 mapping, and the response shape the Studio reads.
 */
const GAME_ID = "11111111-1111-4111-8111-111111111111";

const USER: DalDoubleProfile = {
  id: "user-1",
  role: "user",
  email: "user@example.com",
  avatarUrl: null,
};

mock.module("server-only", () => ({}));

mock.module("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientDouble,
}));

mock.module("@/lib/dal", () => createDalDouble());

const { PATCH } = await import("./route");

function patch(gameId: string, body: unknown): Promise<Response> {
  return PATCH(
    new Request(`http://localhost/api/games/${gameId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ gameId }) },
  );
}

beforeEach(() => {
  adminDouble.reset();
  dalDouble.reset(USER);
});

describe("PATCH /api/games/[gameId]", () => {
  test("publishes an unpublished game and returns the new slug", async () => {
    adminDouble.queryQueue = [
      { data: { id: GAME_ID, title: "Space Blaster", is_public: false, public_slug: null }, error: null },
      { data: { is_public: true, public_slug: "space-blaster-zzzz" }, error: null },
    ];

    const response = await patch(GAME_ID, { isPublic: true });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      isPublic: true,
      publicSlug: expect.stringMatching(/^space-blaster-[a-hj-km-np-z2-9]{4}$/),
    });
  });

  test("unpublishes and keeps the reserved slug", async () => {
    adminDouble.queryQueue = [
      {
        data: { id: GAME_ID, title: "Space Blaster", is_public: true, public_slug: "space-blaster-x7k2" },
        error: null,
      },
      { data: { is_public: false, public_slug: "space-blaster-x7k2" }, error: null },
    ];

    const response = await patch(GAME_ID, { isPublic: false });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      isPublic: false,
      publicSlug: "space-blaster-x7k2",
    });
  });

  test("answers 401 when signed out", async () => {
    dalDouble.reset(null);

    const response = await patch(GAME_ID, { isPublic: true });

    expect(response.status).toBe(401);
  });

  test("answers 400 for a malformed game id", async () => {
    const response = await patch("not-a-uuid", { isPublic: true });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_params", message: "Malformed game id." },
    });
  });

  test("answers 400 for a body that is not an isPublic boolean", async () => {
    const response = await patch(GAME_ID, { isPublic: "yes" });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_body", message: "Expected an isPublic boolean." },
    });
    expect(adminDouble.queryQueue).toHaveLength(0);
  });

  test("answers 404 for a game the user does not own", async () => {
    adminDouble.queryQueue = [{ data: null, error: null }];

    const response = await patch(GAME_ID, { isPublic: true });

    expect(response.status).toBe(404);
    expect(adminDouble.writeCalls).toHaveLength(0);
  });
});
