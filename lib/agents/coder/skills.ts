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

export const PHASER4_PHYSICS_GUIDANCE = `## Arcade Physics & Collision Engine (Phaser 4)

- Always create physics sprites using this.physics.add.sprite(x, y, key) or this.physics.add.group().
- Cast body when configuring: const body = sprite.body as Phaser.Physics.Arcade.Body.
- Hitbox tuning: body.setSize(w, h).setOffset(ox, oy) — keep hitboxes snug.
- Movement: setVelocity(vx, vy), setAcceleration(ax, ay), setDrag(dx, dy), setMaxVelocity(mx, my).
- World bounds: sprite.setCollideWorldBounds(true).

### 1. The Collider vs Overlap Golden Rule
- ALWAYS use this.physics.add.collider(a, b, callback, processCallback, this) for physical obstacles, bouncing balls, solid walls, and blocking bodies.
  * Collider applies physical separation and bounce restitution.
  * For targets that should not move on impact (bricks, barriers, paddles): MUST set target.body.immovable = true (or target.setImmovable(true)) and target.body.allowGravity = false.
- ONLY use this.physics.add.overlap(a, b, callback, undefined, this) for non-blocking sensors and triggers (collecting coins, powerup pickups, reaching exit portal).
- NEVER use overlap for balls hitting bricks or solid objects: overlap does NOT deflect or separate bodies, causing balls to pass right through bricks!

### 2. Ball & Projectile Bounce Physics (Brick-Breaker, Pong, Deflectors)
- Ball Setup:
  ball.setCollideWorldBounds(true);
  ball.setBounce(1, 1);
- Solid Bricks Collider:
  this.physics.add.collider(this.balls, this.bricks, this.hitBrick, null, this);
  Each brick must have: brick.body.immovable = true; brick.body.allowGravity = false;
- Paddle Deflection Angle:
  hitPaddle(paddle, ball) {
    if (ball.stuck) return;
    const diff = ball.x - paddle.x;
    const norm = Phaser.Math.Clamp(diff / (paddle.displayWidth / 2), -1, 1);
    const speed = Math.max(220, Math.hypot(ball.body.velocity.x, ball.body.velocity.y));
    ball.setVelocity(norm * speed * 0.85, -Math.abs(speed));
    soundFx.play("hit");
  }
  Paddle must have: paddle.body.immovable = true; paddle.body.allowGravity = false;
- Docked Ball Launch:
  While ball is resting on paddle (ball.stuck = true), position it at paddle.x, paddle.y - 20. Prevent paddle collision separation while docked using processCallback: (p, b) => !b.stuck.
- World Bottom Edge (Life Loss):
  In games where dropping below paddle loses a life:
  this.physics.world.checkCollision.down = false;
  In update(), check if ball.y > 330 to destroy ball and call this.loseLife(). (If checkCollision.down is not false, the ball bounces off the floor and life loss never occurs!).`;

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

export const PHASER4_GAMEPLAY_PROGRESSION_GUIDANCE = `## Gameplay Progression & Level Architecture

Every game must be immediately playable, fair, and rewarding from the first run:
1. Multi-Level / Wave Structure:
   - Define progression state: this.level = 1; this.maxLevels = 3; this.score = 0; this.lives = 3;
   - Implement a clean startLevel(lvl) method in MainScene:
     * Clears previous level entities: this.enemies.clear(true, true); this.collectibles.clear(true, true);
     * Resets player position to a safe spawn coordinate (e.g. (60, 160) or (240, 260)).
     * Spawns level-scaled challenge: Level 1 introduces core mechanics; Level 2 increases hazard speed and layout density; Level 3 is the climax challenge.
     * Shows a brief floating level announcement banner (e.g. "LEVEL " + lvl) that fades out smoothly after 1.2s.
   - When level objective is fulfilled (e.g. all targets collected or defeated), trigger sound, display "LEVEL COMPLETE!", and advance:
     if (this.level < this.maxLevels) { this.level++; this.startLevel(this.level); } else { this.triggerVictory(); }
2. Safe Spawning & Fair Encounters:
   - NEVER spawn enemies, hazards, or traps within 100px of the player start position. Instant death on spawn ruins the game.
   - For all moving entities, ensure they stay within bounds or bounce/patrol predictably.
3. Audio & Visual Juice:
   - On Damage/Hit: Flash player red (this.player.setTint(0xff3333) with clearTint() after 120ms), trigger camera shake (this.cameras.main.shake(100, 0.01)), and play sound.
   - On Collect/Kill: Trigger particle burst (burst.explode(10, x, y)), floating score text (+100), and play sound.
4. Win, Game Over & Restart:
   - On Game Over: Freeze input, show dark overlay with "GAME OVER", final score, and "Press ENTER to Try Again".
   - On Victory: Show "VICTORY! ALL LEVELS CLEARED", final score, and "Press ENTER to Play Again".
   - Restart handler: this.input.keyboard.once("keydown-ENTER", () => this.scene.restart());`;

export const PHASER4_CONTROLS_GUIDANCE = `## Responsive Controls & HUD Guidance

1. Dual-Input Movement (Arrows + WASD):
   Always bind BOTH Arrow keys and WASD simultaneously in create():
   this.cursors = this.input.keyboard.createCursorKeys();
   this.wasd = this.input.keyboard.addKeys({
     up: Phaser.Input.Keyboard.KeyCodes.W,
     down: Phaser.Input.Keyboard.KeyCodes.S,
     left: Phaser.Input.Keyboard.KeyCodes.A,
     right: Phaser.Input.Keyboard.KeyCodes.D
   });
   In update(), check both:
   const left = this.cursors.left.isDown || this.wasd.left.isDown;
   const right = this.cursors.right.isDown || this.wasd.right.isDown;
   const up = this.cursors.up.isDown || this.wasd.up.isDown;
   const down = this.cursors.down.isDown || this.wasd.down.isDown;
2. Diagonal Normalization:
   In 8-directional top-down games, always normalize velocity vectors so diagonal movement is not 40% faster:
   const vx = (right ? 1 : 0) - (left ? 1 : 0);
   const vy = (down ? 1 : 0) - (up ? 1 : 0);
   if (vx !== 0 || vy !== 0) {
     const len = Math.hypot(vx, vy);
     this.player.setVelocity((vx / len) * speed, (vy / len) * speed);
   } else {
     this.player.setVelocity(0, 0);
   }
3. On-Screen Controls Legend & HUD:
   - Always display a fixed, clean controls hint in the corner or bottom (e.g. "WASD / Arrows: Move | Space: Action") with .setScrollFactor(0).setDepth(100).
   - Display a top HUD: "SCORE: " + this.score, "LEVEL: " + this.level + "/" + this.maxLevels, and "LIVES: " + this.lives.`;

export const PHASER4_SKILLS_PROMPT = [
  PHASER4_API_RULES,
  PHASER4_FX_GUIDANCE,
  PHASER4_PHYSICS_GUIDANCE,
  PHASER4_PARTICLES_GUIDANCE,
  PHASER4_UI_GUIDANCE,
  PHASER4_GAMEPLAY_PROGRESSION_GUIDANCE,
  PHASER4_CONTROLS_GUIDANCE,
].join("\n\n");
