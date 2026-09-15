/**
 * Phaser 4 knowledge compiled from skills.sh (`yakoub-ai/phaser4-gamedev`).
 *
 * Covers v4.2.1 core rules, breaking changes from v3, modern filter/FX architecture,
 * Arcade Physics best practices, particle emission rules, procedural pixel art,
 * and UI/audio bridging.
 */

export const PHASER4_API_RULES = `## Phaser 4 API & Runtime Rules

You are targeting Phaser 4 (v4.2.1). Follow these strict Phaser 4 rules:

1. Never use removed Phaser 3 APIs:
   - NO Phaser.Geom.Point — use Phaser.Math.Vector2.
   - NO Math.PI2 — use Math.TAU (= 2 * Math.PI) or Math.PI_OVER_2.
   - NO Phaser.Structs.Map or Phaser.Structs.Set — use native JavaScript Map and Set.
   - NO group.children.each() — group.children is a native Set with no .each() method. Use group.getChildren().forEach(item => ...) or group.children.forEach(item => ...).
   - NO BitmapMask or createGeometryMask() — use filters.internal.addMask() or camera viewports.
   - NO sprite.tintFill = true — use sprite.setTintMode(Phaser.TintModes.FILL).
   - NO sprite.preFX or sprite.postFX — use the Phaser 4 Filter system (see below).
2. DynamicTexture / RenderTexture:
   - After drawing onto DynamicTexture or RenderTexture, call .render() explicitly.
3. Class-based Scene lifecycle:
   - Exactly one scene class: class MainScene extends Phaser.Scene.
   - Prototype methods: constructor, preload, create, update. Never arrow-function class fields.
   - Register at end of script: window.__MAIN_SCENE__ = MainScene;
4. Input:
   - Access keyboard as this.input.keyboard! (guarded against null).
   - Use this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE) or addKeys.
   - Use Phaser.Input.Keyboard.JustDown(key) for one-shot presses (jump, shoot).`;

export const PHASER4_FX_GUIDANCE = `## Visual Effects and Filters (Phaser 4)

Phaser 4 replaces Phaser 3 FX pipelines with the unified Filter system:
- Game objects MUST call enableFilters() before accessing filters:
  sprite.enableFilters();
  sprite.filters.internal.addGlow(0x00ff88, 4, 0, 1);
  sprite.filters.internal.addShadow(2, 2, 0.5, 1, 0x000000);
- Cameras have filters enabled by default:
  this.cameras.main.filters.external.addVignette(0.5, 0.5, 0.5, 0.5);
- Enable filters ONCE in create(). Never add filters repeatedly inside update() (causes severe memory leaks).
- For simple damage flashes or color pulses, prefer sprite.setTint(0xff0000) or sprite.clearTint() over adding filters.`;

export const PHASER4_PHYSICS_GUIDANCE = `## Arcade Physics (Phaser 4)

- Always create physics sprites using this.physics.add.sprite(x, y, key) or this.physics.add.group().
- Cast body when configuring: const body = sprite.body as Phaser.Physics.Arcade.Body.
- Hitbox tuning: body.setSize(w, h).setOffset(ox, oy) — keep hitboxes snug.
- Movement: setVelocity(vx, vy), setAcceleration(ax, ay), setDrag(dx, dy), setMaxVelocity(mx, my).
- World bounds: sprite.setCollideWorldBounds(true).
- Collisions:
  * this.physics.add.collider(a, b, callback, processCallback, this) for physical obstacles.
  * this.physics.add.overlap(a, b, callback, undefined, this) for triggers, coins, projectiles, damage.`;

export const PHASER4_PARTICLES_GUIDANCE = `## Particles (Phaser 4)

- Emitter creation: const particles = this.add.particles(x, y, textureKey, config);
- Always set maxParticles (e.g. maxParticles: 50) to prevent performance degradation.
- Natural lifecycle: use { start: 1, end: 0 } for scale and alpha to fade out smoothly.
- Bursts (explosions, pickups, hit sparks):
  const burst = this.add.particles(0, 0, key, { speed: { min: 60, max: 180 }, lifespan: 400, scale: { start: 0.8, end: 0 }, emitting: false });
  burst.explode(15, x, y);`;

export const PHASER4_UI_GUIDANCE = `## UI and HUD Elements

- All HUD elements (score, health bars, game over messages) must remain fixed on screen:
  call .setScrollFactor(0).setDepth(100) on all text, graphics, and buttons.
- Create health bars with Phaser.GameObjects.Graphics:
  const bar = this.add.graphics().setScrollFactor(0).setDepth(100);
- Position HUD elements relative to this.scale.width and this.scale.height (480x320 canvas).`;

export const PHASER4_SKILLS_PROMPT = [
  PHASER4_API_RULES,
  PHASER4_FX_GUIDANCE,
  PHASER4_PHYSICS_GUIDANCE,
  PHASER4_PARTICLES_GUIDANCE,
  PHASER4_UI_GUIDANCE,
].join("\n\n");
