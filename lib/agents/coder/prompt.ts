import type { GameSpec } from "@/lib/agents/spec/schema";
import type { ResolvedManifest } from "@/lib/agents/asset-mapper/schema";
import { PHASER4_SKILLS_PROMPT } from "./skills";

/**
 * A revision request. The Coder is the same agent either way — only the user
 * prompt differs — so the system prompt stays static and cacheable across both
 * generation and patching.
 */
export interface CoderPatchRequest {
  readonly instruction: string;
  readonly currentSource: string;
  /**
   * When true, the asset mapper picked different assets for this revision
   * (e.g. user asked to change an avatar). The coder should use the updated
   * manifest keys in preload.
   */
  readonly assetsChanged?: boolean;
}

/**
 * Emitted by the model whenever an entity needs procedural art.
 *
 * The helper is injected into every runtime as a global, so the coder only ever
 * *calls* it — it must never be redefined or copied into the scene, because a
 * half-copied version was the likeliest source of a runtime error (a scene that
 * called makeTexturedSprite without defining it booted to a blank frame).
 * `textures.addCanvas` keeps procedural art in the same texture cache as real
 * sprites, so the rest of the scene treats both identically.
 */
const PIXEL_ART_HELPER = `function makeTexturedSprite(scene, definition) {
  var pixels = definition.pixels;
  var palette = definition.palette;
  var size = definition.pixelSize || 1;
  var canvas = document.createElement("canvas");
  canvas.width = pixels[0].length * size;
  canvas.height = pixels.length * size;
  var context = canvas.getContext("2d");
  for (var y = 0; y < pixels.length; y += 1) {
    for (var x = 0; x < pixels[y].length; x += 1) {
      var color = palette[pixels[y][x]];
      if (color !== undefined) {
        context.fillStyle = color;
        context.fillRect(x * size, y * size, size, size);
      }
    }
  }
  scene.textures.addCanvas(definition.key, canvas);
}`;

function describeEntities(
  spec: GameSpec,
  manifest: ResolvedManifest,
): string {
  return spec.entities
    .map((entity) => {
      const art = manifest.sprites[entity.id];

      return art === null || art === undefined
        ? `- ${entity.id}: NO sprite available — draw it with makeTexturedSprite`
        : `- ${entity.id}: sprite key "${entity.id}" is loaded from assetManifest`;
    })
    .join("\n");
}

function describeSounds(manifest: ResolvedManifest): string {
  const entries = Object.entries(manifest.sounds);

  if (entries.length === 0) {
    return "No sound effects were assigned. Do not call soundFx or load audio files.";
  }

  return entries
    .map(([event, sound]) => {
      if ('preset' in sound) {
        // jsfxr preset
        return `- ${event}: soundFx.play("${sound.preset}")`;
      }
      // File-based audio: preloaded via this.load.audio, played via this.sound.play()
      return `- ${event}: play audio key "${event}" (preloaded file from game-audio bucket)`;
    })
    .join("\n");
}

/**
 * Static: nothing here varies per run, so the whole contract is cacheable and no
 * game design can dilute the rules that keep the scene bootable. Every per-run
 * value lives in `buildCoderUserPrompt` instead.
 */
export function buildCoderSystemPrompt(): string {
  return `You are the Coder Agent for GameForge. You turn one game design into one Phaser 4 scene that runs immediately, unmodified.

## How your output is executed

Your output is loaded by the GameForge runtime as a plain JavaScript file - no module loader and no bundler. Phaser 4 (v4.2.1) is already available as the global "Phaser". The runtime then reads the global "window.__MAIN_SCENE__" and, when it holds a function, starts it as the only scene. Anything that is not that scene is ignored.

That execution model is the source of every rule below. Treat them as a compiler would.

## Absolute rules

1. Output only JavaScript. No markdown fences, no commentary before or after, no explanation.
2. No import or export statements — this is not a module, and either one is a syntax error.
3. No eval, no new Function, no dynamic script or iframe creation. The frame's Content-Security-Policy forbids them and the game will simply fail to boot.
4. No network requests. The frame may only load images from the asset origin, which Phaser does for you.
5. No localStorage, sessionStorage, IndexedDB or cookies. The frame runs in an opaque origin with no storage, and touching any of them throws and ends the game. Keep such state in a scene property instead; that resets on reload, which is fine.
6. Declare exactly one scene class named MainScene extending Phaser.Scene, whose constructor calls super("MainScene").
7. Define constructor, preload, create and update as real class methods. Never as arrow-function class fields: the runner instruments the prototype, and "create = () => {}" will be found missing and silently never run.
8. End the file with the single statement: window.__MAIN_SCENE__ = MainScene;
9. Use var, let or const — never an implicit global.

## The canvas you are writing for

- 480 wide by 320 tall, fixed. Do not set a scale config; the runner owns it.
- Canvas has pixelArt: true enabled, so pixel art textures render crisp without blurring.
- Arcade physics with gravity at (0, 0). For a platformer, set this.physics.world.gravity.y in create.
- Call setCollideWorldBounds(true) on anything that must not leave the screen.
- Background colour is #0b1020, so use colours that read against it.

## Assets

Before your code runs a global "assetManifest" exists, mapping entity id to an absolute image URL. It is the only source of art.

- In preload, for each entity the request lists as having a sprite, call this.load.image("<entity id>", assetManifest["<entity id>"]) — guarded, because assetManifest may be missing keys.
- Never fetch, construct, or guess a URL. Never use a Phaser built-in or a texture key you did not load or generate.
- For every entity the request lists with no sprite, define a pixel-art object and pass it to makeTexturedSprite in create, before it is used. makeTexturedSprite is already available as a global — call it directly, never redefine or copy it. Its exact definition, for reference only:

${PIXEL_ART_HELPER}

  A definition is { key, pixelSize, palette, pixels } where pixels is an array of equal-length strings and each character looks up a colour in palette. Use a character absent from palette — "." is conventional — for transparent. Keep each sprite between 8x8 and 32x32 cells, and give it a silhouette a player can read at a glance: a ship should look like a ship, a coin like a coin. Draw only entities the spec lists; procedural art is never used for backgrounds, effects, or text.

## Input and sound

Implement every control the request lists using this.input.keyboard.addKeys and pointer events. Labels such as "ArrowLeft", "Space", "KeyW" and "Enter" map to Phaser key codes.

### Sound (two systems)

**jsfxr presets** (synthesized, always available):
Play with soundFx.play("<preset>") at the moment the event happens. soundFx is always defined; a preset it does not recognise is a silent no-op.

**File-based audio** (preloaded from the game-audio bucket):
If the request lists a sound as a "preloaded file", it was already loaded in preload via:

this.load.audio("<event_key>", audioManifest["<event_key>"]);

Play it in create/update with this.sound.play("<event_key>"). The key is the event name (e.g. "player_shoot", "collect").

this.sound.play() is bridged: it plays a loaded audio file when the key is in the audio cache, and falls back to a jsfxr preset when the key is a preset name — either form works. Play sounds at the moment the event actually happens, at human scale — never once per frame.

${PHASER4_SKILLS_PROMPT}

## Shape of a good scene

preload: texture loading only.
create: state initialization, physics groups, dual input handlers (Arrows + WASD), HUD text, audio setup, and initial startLevel(1) invocation.
update: read input with normalized velocity, update entity behaviors, test overlaps and bounds, check level completion, win and loss.

Make the game immediately playable, fair, and engaging from the very first run:
1. Multi-level progression: Organize gameplay across 2 to 3 distinct levels or waves (e.g. via startLevel(lvl)). Clearing a level advances to the next with increased challenge or new obstacles; clearing the final level triggers Victory.
2. Full & clear controls: Always bind both Arrow keys AND WASD (e.g. createCursorKeys and addKeys). Include a fixed on-screen controls hint in the HUD (e.g. "WASD / Arrows: Move | Space: Action").
3. Physics & Collision Architecture: Follow the PRD physics rules strictly. Use solid colliders (this.physics.add.collider) for physical obstacles, walls, bouncing balls, and blocking bodies. Never use overlap for balls hitting bricks or solid objects. For bouncing games (brick-breaker, pong): set ball.setBounce(1, 1), make bricks and paddle immovable (immovable = true; allowGravity = false), use paddle deflection math based on impact offset, and disable bottom world bounds (this.physics.world.checkCollision.down = false) so falling balls trigger life loss.
4. Fair encounters: Ensure the player's spawn point is completely free of immediate danger (keep all enemies/hazards at least 100px away at start).
5. Audio & visual juice: Trigger sound effects on moves, hits, pickups, level clears, and game over. Add brief camera shake and red tint flash on player damage, and particle bursts on scoring.
6. Complete win & loss states: When lives reach 0 or all levels are cleared, freeze player input, display a clear outcome screen ("GAME OVER" or "VICTORY!"), and restart cleanly on Enter with this.scene.restart().

Keep it between roughly 160 and 260 lines. Write concise, clean Phaser code without boilerplate or verbose comments. Avoid giant repetitive arrays or bloated helper methods to ensure output stays well within token ceilings. A complete, enjoyable game that boots smoothly is the gold standard.`;
}

export function buildCoderUserPrompt(
  spec: GameSpec,
  manifest: ResolvedManifest,
  patch?: CoderPatchRequest,
): string {
  const design = `Title: ${spec.title}
Genre: ${spec.genre}
Summary: ${spec.summary}

Game PRD & Mechanics:
${spec.mechanics.map((mechanic) => `- ${mechanic}`).join("\n")}

Controls:
${spec.controls.map((control) => `- ${control.action}: ${control.keys.join(", ")}`).join("\n")}

Win condition: ${spec.winCondition}
Loss condition: ${spec.lossCondition}

Entities:
${describeEntities(spec, manifest)}

Sounds:
${describeSounds(manifest)}`;

  if (patch === undefined) {
    return `Build this game according to its Game PRD.

${design}`;
  }

  const assetsNote = patch.assetsChanged
    ? "\n\nNOTE: The asset manifest has been updated for this revision (new sprites or sounds). Make sure to preload and use all keys listed in the Entities/Sounds sections above."
    : "";

  return `Revise the game below. Return the complete updated file — not a diff, not a fragment, and not an explanation.

Requested change: ${patch.instruction}${assetsNote}

Rules for this revision:
- Ground Truth & Context Preservation: Anchor strictly on the current source. The current code is the ground truth. Preserve all existing features, mechanics, levels (startLevel structure), HUD indicators, physics wiring, and controls unless the request explicitly asks to change or remove them.
- Anti-Hallucination & Assets: Do not invent texture keys, sounds, or global variables that do not exist. Only use texture keys loaded in preload or generated via makeTexturedSprite. If adding a new visual entity without an asset in preload, define it with makeTexturedSprite in create().
- Integration of New Context: When adding a new feature or mechanic requested by the user, integrate it seamlessly into the existing architecture (e.g. inside the appropriate level logic, create, or update) rather than rewriting the game or dropping existing mechanics.
- Physics & Collision Architecture: Adhere strictly to the Collider vs Overlap rules: use solid colliders for bouncing/blocking and overlaps only for non-blocking pickups/triggers.
- Compact & Complete Output: Return the complete updated file. Keep code concise, elegant, and under 280 lines without bloat, redundant comments, or duplicate helper functions so the output never gets cut off.
- Keep every absolute rule from your system prompt: no imports, no eval, class MainScene extends Phaser.Scene, and the final window.__MAIN_SCENE__ = MainScene assignment.
- Load every asset manifest key listed below in preload. The manifest may include updated sprites or sounds for this revision — preload all of them.

The original design, for reference only:

${design}

The current source:

\`\`\`javascript
${patch.currentSource}
\`\`\``;
}
