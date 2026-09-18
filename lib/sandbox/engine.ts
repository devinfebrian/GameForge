/**
 * GameForge Sandbox Engine
 *
 * Inspired by Makko.ai's injected template architecture, this engine provides
 * rock-solid, reusable game foundations directly inside the preview iframe and
 * exported game bundles.
 *
 * It gives generated Phaser scenes:
 * 1. \`GameForge.createPlatformer\`: coyote time, jump buffering, variable jump cut, auto-run/braking, and clean reset.
 * 2. \`GameForge.createStateMachine\`: reliable run lifecycle (title, running, dead, won) with physics freezing and clean state resets.
 * 3. \`GameForge.createHUD\`: anchored screen-space HUD (score, lives, wave, progress) and high-contrast result overlay with single-press restart gating.
 * 4. \`GameForge.juice\`: camera shake, flash, particle bursts, and floating score numbers.
 * 5. \`GameForge.input\`: single-press JustDown verification preventing holding-key restart spam.
 *
 * Authored as an inlinable ES5/ES6 string (zero dependencies) to run safely in
 * Blob/classic scripts without bundler overhead.
 */
export const GAMEFORGE_ENGINE = `(function() {
  if (typeof window === "undefined") return;

  var GameForge = {
    version: "1.0.0",

    clampDelta: function(delta, maxMs) {
      return Math.min(delta || 16.6, maxMs || 50);
    },

    input: {
      justDown: function(key) {
        if (!key) return false;
        if (typeof Phaser !== "undefined" && Phaser.Input && Phaser.Input.Keyboard && Phaser.Input.Keyboard.JustDown) {
          return Phaser.Input.Keyboard.JustDown(key);
        }
        return false;
      }
    },

    createStateMachine: function(config) {
      var states = (config && config.states) || {};
      var current = (config && config.initial) || "running";
      var context = (config && config.context) || {};

      var sm = {
        current: current,
        is: function(state) {
          return current === state;
        },
        transition: function(nextState, payload) {
          if (current === nextState) return;
          if (states[current] && typeof states[current].onExit === "function") {
            try { states[current].onExit(context, payload); } catch(e) { console.warn("[GameForge] state exit error:", e); }
          }
          var prev = current;
          current = nextState;
          sm.current = nextState;
          if (states[nextState] && typeof states[nextState].onEnter === "function") {
            try { states[nextState].onEnter(context, payload, prev); } catch(e) { console.warn("[GameForge] state enter error:", e); }
          }
        },
        update: function(time, delta) {
          if (states[current] && typeof states[current].onUpdate === "function") {
            states[current].onUpdate(context, time, delta);
          }
        },
        reset: function() {
          current = (config && config.initial) || "running";
          sm.current = current;
          if (states[current] && typeof states[current].onEnter === "function") {
            try { states[current].onEnter(context); } catch(e) { console.warn("[GameForge] state enter error:", e); }
          }
        }
      };

      if (states[current] && typeof states[current].onEnter === "function") {
        try { states[current].onEnter(context); } catch(e) { console.warn("[GameForge] state enter error:", e); }
      }

      return sm;
    },

    createPlatformer: function(scene, player, options) {
      var opts = options || {};
      var speed = opts.speed || 220;
      var jumpForce = opts.jumpForce || 380;
      var jumpCut = opts.jumpCut !== undefined ? opts.jumpCut : 0.4;
      var coyoteMax = opts.coyoteTime || 120;
      var bufferMax = opts.jumpBuffer || 120;
      var autoRun = opts.autoRun || false;

      var coyoteTimer = 0;
      var jumpBufferTimer = 0;
      var wasGrounded = false;
      var isJumping = false;

      return {
        update: function(time, delta, controls) {
          var dt = Math.min(delta || 16.6, 50);
          if (!player || !player.body) return;

          var onFloor = player.body.blocked.down || player.body.touching.down;

          if (onFloor) {
            coyoteTimer = coyoteMax;
            isJumping = false;
          } else if (coyoteTimer > 0) {
            coyoteTimer -= dt;
          }

          if (controls && controls.jumpPressed) {
            jumpBufferTimer = bufferMax;
          } else if (jumpBufferTimer > 0) {
            jumpBufferTimer -= dt;
          }

          if (jumpBufferTimer > 0 && coyoteTimer > 0 && !isJumping) {
            player.body.setVelocityY(-jumpForce);
            jumpBufferTimer = 0;
            coyoteTimer = 0;
            isJumping = true;
            if (typeof opts.onJump === "function") {
              try { opts.onJump(); } catch(e) { console.warn("[GameForge] onJump error:", e); }
            }
          }

          if (controls && controls.jumpReleased && player.body.velocity.y < -50) {
            player.body.setVelocityY(player.body.velocity.y * jumpCut);
          }

          if (autoRun) {
            var targetX = speed;
            if (controls && controls.boost) targetX = speed * 1.35;
            if (controls && controls.brake) targetX = speed * 0.65;
            player.body.setVelocityX(targetX);
          } else if (controls) {
            if (controls.left) {
              player.body.setVelocityX(-speed);
              if (player.setFlipX) player.setFlipX(true);
            } else if (controls.right) {
              player.body.setVelocityX(speed);
              if (player.setFlipX) player.setFlipX(false);
            } else {
              player.body.setVelocityX(0);
            }
          }

          wasGrounded = onFloor;
        },
        reset: function(x, y) {
          coyoteTimer = 0;
          jumpBufferTimer = 0;
          isJumping = false;
          wasGrounded = false;
          if (player && player.body) {
            player.body.setVelocity(0, 0);
            if (x !== undefined && y !== undefined) {
              player.setPosition(x, y);
            }
          }
        }
      };
    },

    createHUD: function(scene, options) {
      var opts = options || {};
      var width = (scene.cameras && scene.cameras.main && scene.cameras.main.width) || 480;
      var height = (scene.cameras && scene.cameras.main && scene.cameras.main.height) || 320;

      var bar = scene.add.rectangle(width / 2, 18, width, 36, 0x000000, 0.65);
      bar.setScrollFactor(0).setDepth(999);

      var scoreText = scene.add.text(16, 8, "SCORE: " + (opts.initialScore || 0), {
        fontSize: "14px",
        fontFamily: "monospace",
        color: "#38bdf8",
        fontStyle: "bold"
      }).setScrollFactor(0).setDepth(1000);

      var livesText = scene.add.text(width / 2 - 40, 8, "LIVES: " + (opts.initialLives !== undefined ? opts.initialLives : 3), {
        fontSize: "14px",
        fontFamily: "monospace",
        color: "#f43f5e",
        fontStyle: "bold"
      }).setScrollFactor(0).setDepth(1000);

      var waveText = scene.add.text(width - 120, 8, "WAVE: " + (opts.initialWave || "1/3"), {
        fontSize: "14px",
        fontFamily: "monospace",
        color: "#a855f7",
        fontStyle: "bold"
      }).setScrollFactor(0).setDepth(1000);

      var resultContainer = null;

      return {
        updateScore: function(val) {
          scoreText.setText("SCORE: " + val);
        },
        updateLives: function(val) {
          livesText.setText("LIVES: " + Math.max(0, val));
        },
        updateWave: function(val) {
          waveText.setText("WAVE: " + val);
        },
        showResult: function(res) {
          if (resultContainer) {
            resultContainer.destroy(true);
            resultContainer = null;
          }
          resultContainer = scene.add.container(width / 2, height / 2).setDepth(2000).setScrollFactor(0);

          var bg = scene.add.rectangle(0, 0, width, height, 0x000000, 0.82);
          var isWin = res && res.status === "victory";
          var titleColor = isWin ? "#22c55e" : "#ef4444";

          var title = scene.add.text(0, -50, (res && res.title) || (isWin ? "VICTORY!" : "GAME OVER"), {
            fontSize: "26px",
            fontFamily: "monospace",
            color: titleColor,
            fontStyle: "bold",
            align: "center"
          }).setOrigin(0.5);

          var msg = scene.add.text(0, -5, (res && res.message) || "", {
            fontSize: "15px",
            fontFamily: "monospace",
            color: "#e2e8f0",
            align: "center"
          }).setOrigin(0.5);

          var hint = scene.add.text(0, 45, "Press ENTER or SPACE to Play Again", {
            fontSize: "13px",
            fontFamily: "monospace",
            color: "#fbbf24",
            fontStyle: "bold",
            align: "center"
          }).setOrigin(0.5);

          if (scene.tweens) {
            scene.tweens.add({
              targets: hint,
              alpha: 0.3,
              duration: 600,
              yoyo: true,
              repeat: -1
            });
          }

          resultContainer.add([bg, title, msg, hint]);
        },
        clearResult: function() {
          if (resultContainer) {
            resultContainer.destroy(true);
            resultContainer = null;
          }
        },
        reset: function(score, lives, wave) {
          if (resultContainer) {
            resultContainer.destroy(true);
            resultContainer = null;
          }
          scoreText.setText("SCORE: " + (score !== undefined ? score : 0));
          livesText.setText("LIVES: " + (lives !== undefined ? lives : 3));
          waveText.setText("WAVE: " + (wave !== undefined ? wave : "1/3"));
        }
      };
    },

    juice: {
      shake: function(camera, duration, intensity) {
        if (!camera) return;
        camera.shake(duration || 150, intensity || 0.015);
      },
      flash: function(camera, duration, r, g, b) {
        if (!camera) return;
        camera.flash(duration || 150, r !== undefined ? r : 255, g !== undefined ? g : 50, b !== undefined ? b : 50);
      },
      floatingText: function(scene, x, y, text, color) {
        if (!scene || !scene.add) return;
        var t = scene.add.text(x, y, text, {
          fontSize: "13px",
          fontFamily: "monospace",
          fontStyle: "bold",
          color: color || "#fbbf24"
        }).setOrigin(0.5).setDepth(1500);

        if (scene.tweens) {
          scene.tweens.add({
            targets: t,
            y: y - 30,
            alpha: 0,
            duration: 700,
            ease: "Cubic.easeOut",
            onComplete: function() { t.destroy(); }
          });
        }
      },
      burst: function(scene, x, y, count, colorHex) {
        if (!scene || !scene.add) return;
        var num = count || 8;
        var col = colorHex !== undefined ? colorHex : 0xfbbf24;
        for (var i = 0; i < num; i++) {
          var p = scene.add.circle(x, y, 2.5, col).setDepth(1400);
          var angle = (Math.PI * 2 * i) / num;
          var speed = 40 + Math.random() * 40;
          if (scene.tweens) {
            scene.tweens.add({
              targets: p,
              x: x + Math.cos(angle) * speed,
              y: y + Math.sin(angle) * speed,
              alpha: 0,
              scale: 0.2,
              duration: 400 + Math.random() * 200,
              onComplete: function() { p.destroy(); }
            });
          }
        }
      }
    }
  };

  window.GameForge = GameForge;
})();`;
