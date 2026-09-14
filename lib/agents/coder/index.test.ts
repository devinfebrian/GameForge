import { describe, expect, test } from "bun:test";
import { normalizeSceneSource } from "@/lib/agents/coder";
import {
  buildCoderSystemPrompt,
  buildCoderUserPrompt,
} from "@/lib/agents/coder/prompt";
import { GenerationError } from "@/lib/llm/errors";
import type { ResolvedManifest } from "@/lib/agents/asset-mapper/schema";
import type { GameSpec } from "@/lib/agents/spec/schema";

const spec: GameSpec = {
  title: "Coin Run",
  genre: "platformer",
  summary: "Collect coins.",
  mechanics: ["Move left and right"],
  controls: [{ action: "move", keys: ["ArrowLeft", "ArrowRight"] }],
  winCondition: "Collect five coins.",
  lossCondition: "Touch a bee.",
  entities: [
    { id: "player", kind: "player", behavior: "Runs.", assetTags: ["player"] },
    { id: "bee", kind: "enemy", behavior: "Hovers.", assetTags: ["enemy"] },
  ],
};

const manifest: ResolvedManifest = {
  sprites: { player: "https://example.co/player.png", bee: null },
  sounds: { collect: "pickup" },
};

describe("normalizeSceneSource", () => {
  test("strips a language-tagged fence", () => {
    expect(normalizeSceneSource("```js\nclass MainScene {}\n```")).toBe(
      "class MainScene {}",
    );
  });

  test("strips a bare fence", () => {
    expect(normalizeSceneSource("```\nclass MainScene {}\n```")).toBe(
      "class MainScene {}",
    );
  });

  test("recovers a fence wrapped in surrounding prose", () => {
    expect(
      normalizeSceneSource(
        "Here is the scene:\n```js\nclass MainScene {}\n```\nEnjoy!",
      ),
    ).toBe("class MainScene {}");
  });

  test("leaves unfenced code untouched", () => {
    const code = 'class MainScene extends Phaser.Scene {}\nwindow.__MAIN_SCENE__ = MainScene;';

    expect(normalizeSceneSource(code)).toBe(code);
  });

  test("keeps interior code intact", () => {
    const code = "const a = 1;\nconst b = 2;";

    expect(normalizeSceneSource(`\`\`\`javascript\n${code}\n\`\`\``)).toBe(code);
  });

  // An empty scene is worse than a broken one: it would be persisted as a
  // successful version and then fail invisibly in the frame.
  test("rejects whitespace-only output", () => {
    for (const raw of ["", "   \n  ", "```js\n\n```"]) {
      expect(() => normalizeSceneSource(raw)).toThrow(GenerationError);
    }
  });

  test("reports the coder stage when it rejects", () => {
    try {
      normalizeSceneSource("   ");
      throw new Error("expected normalizeSceneSource to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(GenerationError);
      expect((error as GenerationError).code).toBe("coder_failed");
      expect((error as GenerationError).stage).toBe("coder");
    }
  });
});

describe("buildCoderSystemPrompt", () => {
  const prompt = buildCoderSystemPrompt();

  test("states the global the runner looks for", () => {
    expect(prompt).toContain("window.__MAIN_SCENE__ = MainScene;");
  });

  test("warns about the silent arrow-field failure", () => {
    expect(prompt).toContain("arrow-function class fields");
  });

  test("forbids module and eval syntax", () => {
    expect(prompt).toContain("No import or export");
    expect(prompt).toContain("No eval");
  });

  // The opaque-origin frame has no storage, so a scene that reaches for it dies
  // during create() with a SecurityError.
  test("forbids origin storage the sandbox cannot provide", () => {
    expect(prompt).toContain("No localStorage");
  });

  test("names the real canvas dimensions", () => {
    expect(prompt).toContain("480");
    expect(prompt).toContain("320");
  });

  test("ships the pixel-art helper verbatim", () => {
    expect(prompt).toContain("scene.textures.addCanvas(definition.key, canvas);");
    expect(prompt).toContain("function makeTexturedSprite(scene, definition)");
  });

  // The whole point of the split: this string is identical for every run, so it
  // can be prompt-cached and no game description can dilute the rules.
  test("carries no per-run game data", () => {
    expect(prompt).not.toContain("Coin Run");
    expect(prompt).not.toContain("collectible_coin");
    expect(prompt).not.toContain("soundFx.play(\"pickup\")");
  });

  // The gateway sits behind a WAF that answers 403 with an HTML block page for
  // prompt text shaped like an XSS payload. The coder prompt used to contain the
  // literal phrase that tripped it, and the resulting failure
  // (provider_content_blocked) reads like a credential problem. This keeps a
  // future edit from quietly reintroducing a script-tag signature.
  test("carries no HTML script-tag signature", () => {
    expect(prompt).not.toContain("<script");
    expect(prompt).not.toContain("</script");
  });
});

describe("buildCoderUserPrompt with a patch", () => {
  const currentSource =
    "class MainScene extends Phaser.Scene {}\nwindow.__MAIN_SCENE__ = MainScene;";
  const patchPrompt = buildCoderUserPrompt(spec, manifest, {
    instruction: "Make the player twice as fast",
    currentSource,
  });

  test("asks for the whole file rather than a diff", () => {
    expect(patchPrompt).toContain("Return the complete updated file");
  });

  test("carries the instruction", () => {
    expect(patchPrompt).toContain("Make the player twice as fast");
  });

  // Without the current source the model would rebuild the game from the design
  // summary, silently discarding every previous edit.
  test("carries the current source verbatim", () => {
    expect(patchPrompt).toContain(currentSource);
  });

  test("still names the manifest keys the scene must keep using", () => {
    expect(patchPrompt).toContain('collect: soundFx.play("pickup")');
    expect(patchPrompt).toContain('player: sprite key "player" is loaded');
  });

  test("is absent from an ordinary generation prompt", () => {
    expect(buildCoderUserPrompt(spec, manifest)).not.toContain(
      "Return the complete updated file",
    );
  });
});

describe("buildCoderUserPrompt", () => {
  const userPrompt = buildCoderUserPrompt(spec, manifest);

  test("tells the model which entities have art and which do not", () => {
    expect(userPrompt).toContain('player: sprite key "player" is loaded');
    expect(userPrompt).toContain("bee: NO sprite available");
    expect(userPrompt).not.toContain("player: NO sprite available");
  });

  test("names the win and loss conditions", () => {
    expect(userPrompt).toContain("Win condition: Collect five coins.");
    expect(userPrompt).toContain("Loss condition: Touch a bee.");
  });

  test("lists the controls to implement", () => {
    expect(userPrompt).toContain("move: ArrowLeft, ArrowRight");
  });

  test("lists only the assigned sounds", () => {
    expect(userPrompt).toContain('collect: soundFx.play("pickup")');
    expect(userPrompt).not.toContain('soundFx.play("laser")');
  });

  test("tells the model to stay quiet when nothing was assigned", () => {
    expect(buildCoderUserPrompt(spec, { sprites: {}, sounds: {} })).toContain(
      "Do not call soundFx.",
    );
  });

  test("lists every entity exactly once", () => {
    expect(userPrompt.match(/^\t?- (player|bee):/gm)).toHaveLength(2);
  });
});
