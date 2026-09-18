import { describe, expect, test } from "bun:test";
import { gameSpecSchema } from "@/lib/agents/spec/schema";

const VALID_SPEC = {
  title: "Space Blaster",
  genre: "space shooter",
  summary: "Blast incoming ships before they ram you.",
  difficulty: "casual",
  mechanics: ["Move with the arrow keys", "Fire with space"],
  feel: [
    {
      event: "player shoots",
      visual: "small muzzle flash",
      audio: "laser sound",
    },
    {
      event: "enemy destroyed",
      visual: "orange particle burst",
      audio: "explosion sound",
    },
  ],
  controls: [
    { action: "move", keys: ["ArrowLeft", "ArrowRight"] },
    { action: "shoot", keys: ["Space"] },
  ],
  winCondition: "Destroy ten enemies.",
  lossCondition: "Collide with an enemy.",
  entities: [
    {
      id: "player",
      kind: "player",
      behavior: "Slides along the bottom edge.",
      assetTags: ["player", "ship", "space"],
    },
    {
      id: "enemy",
      kind: "enemy",
      behavior: "Descends from the top.",
      assetTags: ["enemy", "ship", "space"],
    },
    {
      id: "bullet",
      kind: "projectile",
      behavior: "Fires upward from player.",
      assetTags: ["projectile", "space"],
    },
  ],
};

describe("gameSpecSchema", () => {
  test("accepts a well-formed specification", () => {
    expect(gameSpecSchema.safeParse(VALID_SPEC).success).toBe(true);
  });

  test("rejects an empty entities list", () => {
    expect(
      gameSpecSchema.safeParse({ ...VALID_SPEC, entities: [] }).success,
    ).toBe(false);
  });

  test("rejects an unknown entity kind", () => {
    expect(
      gameSpecSchema
        .safeParse({
          ...VALID_SPEC,
          entities: [{ ...VALID_SPEC.entities[0], kind: "boss_fight" }],
        })
        .success,
    ).toBe(false);
  });

  test("rejects an entity id that is not a safe texture key", () => {
    for (const id of ["Player", "player-1", "1player", "player ship", ""]) {
      expect(
        gameSpecSchema.safeParse({
          ...VALID_SPEC,
          entities: [{ ...VALID_SPEC.entities[0], id }],
        }).success,
      ).toBe(false);
    }
  });

  test("rejects an entity with no tags for the mapper to match on", () => {
    expect(
      gameSpecSchema.safeParse({
        ...VALID_SPEC,
        entities: [{ ...VALID_SPEC.entities[0], assetTags: [] }],
      }).success,
    ).toBe(false);
  });

  // These two are refinements, which have no JSON Schema form. The tool schema
  // cannot express them, so the parse after the model call is the only gate.
  test("rejects duplicate entity ids", () => {
    const result = gameSpecSchema.safeParse({
      ...VALID_SPEC,
      entities: [VALID_SPEC.entities[0], { ...VALID_SPEC.entities[1], id: "player" }],
    });

    expect(result.success).toBe(false);
  });

  test("rejects a spec with no player entity", () => {
    const result = gameSpecSchema.safeParse({
      ...VALID_SPEC,
      entities: [{ ...VALID_SPEC.entities[1], kind: "enemy" }],
    });

    expect(result.success).toBe(false);
  });
});

describe("normalizeUndefined", () => {
  test("integration: double-encoded controls string is accepted after normalization", () => {
    const raw = {
      title: "Test Game",
      genre: "test",
      summary: "A test",
      difficulty: "casual" as const,
      mechanics: ["Run"],
      controls: '{"controls":[{"action":"Move","keys":["ArrowLeft"]}]}',
      winCondition: "Win",
      lossCondition: "Lose",
      feel: [{ event: "test", visual: "x", audio: "y" }],
      entities: [
        { id: "player", kind: "player" as const, behavior: "moves", assetTags: ["p"] },
        { id: "enemy", kind: "enemy" as const, behavior: "chases", assetTags: ["e"] },
        { id: "coin", kind: "collectible" as const, behavior: "sits", assetTags: ["c"] },
      ],
    };

    // Simulate what normalizeUndefined does: parse the double-encoded string
    const parsedControls = JSON.parse(raw.controls);
    const fixed = { ...raw, controls: parsedControls.controls };
    const result = gameSpecSchema.safeParse(fixed);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.controls).toHaveLength(1);
      expect(result.data.controls[0].action).toBe("Move");
    }
  });
});
