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
   - Restart handler: this.input.keyboard.once("keydown-ENTER", () => this.scene.restart());
5. Guaranteed Traversability & Solvability (No Undoable Levels):
   - NEVER randomly scatter wall blocks with loops like: for (wallCount) addWall(randX, randY). Random placement clumps blocks together, creating impassable bottlenecks, diagonal chokepoints, or sealing off rooms, making the game impossible to win.
   - Distinct Per-Level Layout Architecture (Every level must look and play differently):
     In startLevel(lvl), generate a DIFFERENT room layout for each level using if (lvl === 1) ... else if (lvl === 2) ... else ...:
     * Level 1 (Open Hall): 2 central pillars (e.g. at (180, 160) and (300, 160)) allowing open navigation while introducing mechanics.
     * Level 2 (Divided Chambers): A dividing wall (e.g. at x=240) with TWO wide 64px doorways (e.g. at y=80 and y=240) dividing the map into left and right chambers.
     * Level 3 (Ring Vault): 4 corner pillars (e.g. at (140, 100), (340, 100), (140, 220), (340, 220)) with a central open zone and faster hazards.
     Never repeat the exact same obstacle coordinates across levels!
   - Player Cornering & Hitbox Tuning:
     In top-down and dungeon games, a full 32x32 square body snags on corners. Always tune the player's hitbox:
     this.player.body.setSize(20, 20).setOffset(6, 6);
     This allows fluid movement around corners.
   - Guaranteed Reachability:
     * Always ensure an unblocked, direct walking path from Player Spawn -> All Keys/Collectibles -> Exit Portal.
     * Never spawn collectibles, keys, traps, or enemies inside wall bodies or in dead-end trapped pockets.
6. Dynamic NPC & Enemy AI (No Dumb 1-Axis Oscillators):
   - Wall Reaction & Rebound:
     Set enemy.setCollideWorldBounds(true) and enemy.setBounce(1, 1). If an enemy touches a wall (enemy.body.blocked.left || enemy.body.blocked.right || enemy.body.blocked.up || enemy.body.blocked.down), reverse direction or change patrol axis so enemies NEVER get stuck vibrating against walls.
   - Aggro & Pursuit Behavior:
     In update(), check distance to player:
     const dist = Phaser.Math.Distance.Between(enemy.x, enemy.y, this.player.x, this.player.y);
     if (dist < 140) {
       // Aggro: Pursue player directly
       const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, this.player.x, this.player.y);
       enemy.setVelocity(Math.cos(angle) * enemy.speed, Math.sin(angle) * enemy.speed);
     } else {
       // Patrol or wander at normal patrol speed
       if (!enemy.patrolDir) enemy.patrolDir = 1;
       enemy.setVelocityX(enemy.patrolDir * (enemy.speed * 0.6));
     }
   - Visual Facing: Flip enemy sprite based on velocity (enemy.flipX = enemy.body.velocity.x < 0) so the NPC faces where it moves.`;

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

export const PHASER4_GAMEFORGE_ENGINE_GUIDANCE = `## GameForge Engine Helper Library (window.GameForge)

The runtime automatically injects a helper library at "window.GameForge" (or simply "GameForge").
USE THIS TO DRAMATICALLY SIMPLIFY YOUR CODE (cuts boilerplate by 60%), prevent physics explosion bugs, and ensure rock-solid feel:

1. Platformer Engine (GameForge.createPlatformer):
   - Handles coyote time (120ms), jump buffering (120ms), variable jump cut, and auto-run smoothly.
   - Setup in create():
     this.platformer = GameForge.createPlatformer(this, this.player, {
       speed: 200,          // horizontal run speed (default: 200)
       jumpForce: -380,     // jump impulse velocity (default: -380)
       jumpCut: 0.4,        // cut factor when jump key is released early (default: 0.4)
       coyoteMs: 120,       // jump grace period after falling off ledge (default: 120)
       bufferMs: 120,       // jump input buffering before landing (default: 120)
       autoRun: false       // true for endless runners, false for manual control
     });
   - In update(time, delta):
     this.platformer.update(Math.min(delta, 50), {
       left: this.cursors.left.isDown || this.wasd.left.isDown,
       right: this.cursors.right.isDown || this.wasd.right.isDown,
       jumpDown: this.cursors.up.isDown || this.wasd.up.isDown || this.spaceKey.isDown,
       jumpJustDown: GameForge.input.justDown(this.spaceKey) || GameForge.input.justDown(this.cursors.up),
       jumpReleased: Phaser.Input.Keyboard.JustUp(this.spaceKey)
     });
   - Reset player state on level start:
     this.platformer.reset(spawnX, spawnY);

2. Game State Machine (GameForge.createStateMachine):
   - Keeps run lifecycle disciplined ('running', 'dead', 'won') without messy booleans:
     this.stateMachine = GameForge.createStateMachine(this, {
       running: {
         enter: () => { /* enable player physics/controls */ },
         update: (dt) => { /* gameplay logic */ }
       },
       dead: {
         enter: () => {
           this.physics.pause();
           this.hud.showResult({ status: "defeat", title: "GAME OVER", message: "Final Score: " + this.score });
         }
       },
       won: {
         enter: () => {
           this.physics.pause();
           this.hud.showResult({ status: "victory", title: "VICTORY!", message: "All Levels Cleared!" });
         }
       }
     }, "running");
   - Transition with: this.stateMachine.transition("dead") or this.stateMachine.transition("won");

3. Unified Screen HUD (GameForge.createHUD):
   - Automatically anchors to screen (scrollFactor: 0, depth: 100), handles score, lives, wave, and game over overlays:
     this.hud = GameForge.createHUD(this, {
       initialScore: 0,
       initialLives: 3,
       initialWave: 1,
       maxWaves: 3,
       showControls: true,
       controlsHint: "WASD / Arrows: Move | Space: Action"
     });
   - Update HUD (use update* NOT set* — setScore/setLives/setWave do not exist):
     this.hud.updateScore(this.score);
     this.hud.updateLives(this.lives);
     this.hud.updateWave(this.level);
   - Game over / victory modal with single-press restart protection:
     this.hud.showResult({ status: "victory", title: "VICTORY!", message: "Score: " + this.score });

4. Collision Wiring Examples (MANDATORY — copy these patterns):
   - **Space Shooter / Top-Down** (most common — player ship, enemies, collectibles, bullets):
     In create(), AFTER all sprites are created, wire:
       this.physics.add.overlap(this.player, this.enemies, this.hitEnemy, null, this);
       this.physics.add.overlap(this.player, this.coins, this.collectCoin, null, this);
       this.physics.add.overlap(this.bullets, this.enemies, this.bulletHitEnemy, null, this);
     Callback hitEnemy(player, enemy): check invincibility cooldown first, then enemy.destroy(), lives--, hud.updateLives(lives), juice flash. If lives <= 0 call gameOver(). Else set invincibility=true + time.delayedCall(1000ms to reset).
     Callback collectCoin(player, coin): coin.destroy(), score += 10, hud.updateScore(score), juice.floatingText.
     Callback bulletHitEnemy(bullet, enemy): bullet.destroy(), enemy.destroy(), score += 25, hud.updateScore(score), juice burst.
   - **Platformer** (player, enemies, coins, hazards):
       this.physics.add.collider(this.player, this.platforms);  // solid ground
       this.physics.add.overlap(this.player, this.coins, this.collectCoin, null, this);
       this.physics.add.overlap(this.player, this.enemies, this.hitEnemy, null, this);
       this.physics.add.overlap(this.player, this.hazards, this.hitHazard, null, this);
   - **CRITICAL**: Every interactive entity MUST have an overlap/collider wired in create(). If you create enemies or coins but forget to wire them, the game will have NO interactions.

5. Juice & Game Feel Helpers (GameForge.juice) — EXACT signatures (wrong names will crash):
   - Camera shake: GameForge.juice.shake(camera, duration, intensity) — e.g. GameForge.juice.shake(this.cameras.main, 150, 0.015)
   - Screen flash (NOT sprite flash): GameForge.juice.flash(camera, duration, r, g, b) — e.g. GameForge.juice.flash(this.cameras.main, 150, 255, 50, 50) for red tint
   - Floating score text: GameForge.juice.floatingText(scene, x, y, text, color) — e.g. GameForge.juice.floatingText(this, coin.x, coin.y, "+10", "#ffd700")
   - Particle burst: GameForge.juice.burst(scene, x, y, count, colorHex) — e.g. GameForge.juice.burst(this, enemy.x, enemy.y, 8, 0xff3333)
   - NOTE: juice.flash takes a CAMERA not a sprite. juice.floatingText takes a SCENE not a window. These are the ONLY juice methods available.

5. Delta Clamping Rule:
   - In update(time, delta), ALWAYS clamp delta:
     const dt = Math.min(delta, 50);
   - Passing unbounded delta after background tab switching causes physics tunnelling and object teleportation.`;

export const PHASER4_SKILLS_PROMPT = [
  PHASER4_API_RULES,
  PHASER4_FX_GUIDANCE,
  PHASER4_PHYSICS_GUIDANCE,
  PHASER4_PARTICLES_GUIDANCE,
  PHASER4_UI_GUIDANCE,
  PHASER4_GAMEPLAY_PROGRESSION_GUIDANCE,
  PHASER4_CONTROLS_GUIDANCE,
  PHASER4_GAMEFORGE_ENGINE_GUIDANCE,
].join("\n\n");
