import { describe, expect, test } from "bun:test";
import { buildPublicSlug, createSlugSuffix, slugifyTitle } from "@/lib/games/slug";

describe("slugifyTitle", () => {
  test("lowercases and hyphenates words", () => {
    expect(slugifyTitle("Space Blaster")).toBe("space-blaster");
  });

  test("strips diacritics rather than dropping the letter", () => {
    expect(slugifyTitle("Pokémon Pinball")).toBe("pokemon-pinball");
    expect(slugifyTitle("ÀÉÎÕÜ")).toBe("aeiou");
  });

  test("collapses runs of punctuation into a single separator", () => {
    expect(slugifyTitle("Meteor!!! Barrage")).toBe("meteor-barrage");
    expect(slugifyTitle("a  --  b")).toBe("a-b");
  });

  test("trims leading and trailing separators", () => {
    expect(slugifyTitle("...Dungeon...")).toBe("dungeon");
  });

  test("returns an empty string when nothing survives", () => {
    expect(slugifyTitle("🎮🎮")).toBe("");
    expect(slugifyTitle("!!!")).toBe("");
  });

  test("caps the length without leaving a trailing separator", () => {
    const title = `${"a".repeat(39)} bcdef`;

    const base = slugifyTitle(title);

    expect(base.length).toBeLessThanOrEqual(40);
    expect(base.endsWith("-")).toBe(false);
  });
});

describe("createSlugSuffix", () => {
  test("uses only the unambiguous alphabet", () => {
    // Draws across the whole range so every position is exercised.
    expect(createSlugSuffix(() => 0.999999)).toMatch(/^[a-hj-km-np-z2-9]{4}$/);
    expect(createSlugSuffix(() => 0)).toBe("aaaa");
  });

  test("never emits a look-alike character", () => {
    for (let draw = 0; draw < 28; draw += 1) {
      const suffix = createSlugSuffix(() => draw / 28);

      expect(suffix).not.toMatch(/[ilo01]/);
    }
  });

  test("is deterministic for an injected generator", () => {
    const picks = [0, 0.25, 0.5, 0.75];

    expect(createSlugSuffix(() => picks.shift() ?? 0)).toBe("ahs2");
  });

  test("clamps a generator that returns exactly 1", () => {
    expect(createSlugSuffix(() => 1)).toBe("9999");
  });
});

describe("buildPublicSlug", () => {
  test("joins the slugified title to the suffix", () => {
    expect(buildPublicSlug("Space Blaster", "x7k2")).toBe("space-blaster-x7k2");
  });

  test("falls back to a generic base when the title slugifies to nothing", () => {
    expect(buildPublicSlug("🎮", "x7k2")).toBe("game-x7k2");
    expect(buildPublicSlug("", "x7k2")).toBe("game-x7k2");
  });

  test("produces a URL-safe result for an awkward title", () => {
    expect(buildPublicSlug("Café / Déjà Vu?!", "ab12")).toBe("cafe-deja-vu-ab12");
  });
});
