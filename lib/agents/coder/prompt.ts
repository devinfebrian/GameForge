import type { GameSpec } from "@/lib/agents/spec/schema";
import type { ResolvedManifest } from "@/lib/agents/asset-mapper/schema";

/**
 * A revision request. The Coder is the same agent either way — only the user
 * prompt differs — so the system prompt stays static and cacheable across both
 * generation and patching.
 */
export interface CoderPatchRequest {
  readonly instruction: string;
  readonly currentSource: string;
}

/**
 * Emitted verbatim by the model whenever an entity needs procedural art.
 *
 * The helper is dictated rather than requested because a re-invented version is
 * the likeliest source of a runtime error in an otherwise good scene, and
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
      if ('fileId' in sound && sound.url !== undefined) {
        // File-based audio: preloaded via this.load.audio, played via this.sound.play()
        return `- ${event}: play audio key "${event}" (preloaded file from game-audio bucket)`;
      }
      // jsfxr preset
      return `- ${event}: soundFx.play("${sound.preset}")`;
    })
    .join("\n");
}

/**
 * Static: nothing here varies per run, so the whole contract is cacheable and no
 * game design can dilute the rules that keep the scene bootable. Every per-run
 * value lives in `buildCoderUserPrompt` instead.
 */
export function buildCoderSystemPrompt(): string {
  return `You are the Coder Agent for GameForge. You turn one game design into one Phaser 3 scene that runs immediately, unmodified.

## How your output is executed

Your output is loaded by the GameForge runtime as a plain JavaScript file - no module loader and no bundler. Phaser 3.90 is already available as the global "Phaser". The runtime then reads the global "window.__MAIN_SCENE__" and, when it holds a function, starts it as the only scene. Anything that is not that scene is ignored.

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
- Arcade physics with gravity at (0, 0). For a platformer, set this.physics.world.gravity.y in create.
- Call setCollideWorldBounds(true) on anything that must not leave the screen.
- Background colour is #0b1020, so use colours that read against it.

## Assets

Before your code runs a global "assetManifest" exists, mapping entity id to an absolute image URL. It is the only source of art.

- In preload, for each entity the request lists as having a sprite, call this.load.image("<entity id>", assetManifest["<entity id>"]) — guarded, because assetManifest may be missing keys.
- Never fetch, construct, or guess a URL. Never use a Phaser built-in or a texture key you did not load or generate.
- For every entity the request lists with no sprite, define a pixel-art object and pass it to makeTexturedSprite in create, before it is used. Copy this helper unchanged:

${PIXEL_ART_HELPER}

  A definition is { key, pixelSize, palette, pixels } where pixels is an array of equal-length strings and each character looks up a colour in palette. Use a character absent from palette — "." is conventional — for transparent. Keep each sprite between 8x8 and 32x32 cells, and give it a silhouette a player can read at a glance: a ship should look like a ship, a coin like a coin. Draw only entities the spec lists; procedural art is never used for backgrounds, effects, or text.

## Input and sound

Implement every control the request lists using this.keyboard.addKeys and pointer events. Labels such as "ArrowLeft", "Space", "KeyW" and "Enter" map to Phaser key codes.

### Sound (two systems)

**jsfxr presets** (synthesized, always available):
Play with `soundFx.play("<preset>")` at the moment the event happens. soundFx is always defined; a preset it does not recognise is a silent no-op.

**File-based audio** (preloaded from game-audio bucket):
If the request lists a sound as "preloaded file", it was already loaded in preload via:
```
this.load.audio("<event_key>", assetManifestAudio["<event_key>"]);
```
Play it in create/update with: `this.sound.play("<event_key>")`.
The key is the event name (e.g. "player_shoot", "collect").

Rules for all sounds: play at the moment the event actually happens, at human scale — never once per frame.

## Shape of a good scene

preload: texture loading only.
create: state, physics bodies, input handlers, HUD text, and the win/loss wiring.
update: read input, move things, test overlaps and bounds, check win and loss.

Keep it between roughly 150 and 250 lines. Make the game actually playable: the player must be able to move, both the win and the loss condition must be reachable, and there must be a visible score or progress indicator. When a condition ends the game, freeze input, show the outcome as text, and restart on Enter with this.scene.restart().

Prefer obvious, boring Phaser code over clever code. A shorter game that boots is worth far more than an ambitious one that throws.`;
}

export function buildCoderUserPrompt(
  spec: GameSpec,
  manifest: ResolvedManifest,
  patch?: CoderPatchRequest,
): string {
  const design = `Title: ${spec.title}
Genre: ${spec.genre}
Summary: ${spec.summary}

Mechanics:
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
    return `Build this game.

${design}`;
  }

  return `Revise the game below. Return the complete updated file — not a diff, not a fragment, and not an explanation.

Requested change: ${patch.instruction}

Rules for this revision:
- Change only what the request requires. Everything else must survive intact: entity ids, texture keys, control bindings, collision wiring and existing mechanics.
- Re-read the current file before answering. Do not rebuild the game from the design summary, which describes the original version and may be out of date.
- Keep every absolute rule from your system prompt: no imports, no eval, class MainScene extends Phaser.Scene, and the final window.__MAIN_SCENE__ assignment.
- Load only the asset manifest keys listed below. Add nothing new to preload.

The original design, for reference only:

${design}

The current source:

\`\`\`javascript
${patch.currentSource}
\`\`\``;
}
