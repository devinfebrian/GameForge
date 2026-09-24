import { describe, expect, test, beforeEach } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("public/sandbox/sound.js", () => {
  let soundCode: string;

  beforeEach(async () => {
    soundCode = await readFile(join(process.cwd(), "public", "sandbox", "sound.js"), "utf8");
  });

  test("contains standard event mappings for level_clear and game_over", () => {
    expect(soundCode).toContain('level_clear: "powerUp"');
    expect(soundCode).toContain('game_over: "explosion"');
    expect(soundCode).toContain('collect: "pickupCoin"');
    expect(soundCode).toContain('shoot: "laserShoot"');
  });

  test("bridges Phaser sound manager to intercept missing audio keys safely", () => {
    // Set up mock window and Phaser environment
    const playedSounds: string[] = [];
    const mockJsfxr = {
      sfxr: {
        generate: (name: string) => ({ name }),
        play: (sound: { name: string }) => {
          playedSounds.push(sound.name);
          return Promise.resolve();
        },
      },
    };

    class MockBaseSoundManager {
      game = {
        cache: {
          audio: {
            has: (key: string) => key === "cached_audio_file",
            get: (key: string) => (key === "cached_audio_file" ? {} : null),
          },
        },
      };
      sounds: unknown[] = [];
      play(key: string) {
        if (key !== "cached_audio_file") {
          throw new Error(`Audio key "${key}" not found in cache`);
        }
        return true;
      }
      add(key: string) {
        if (key !== "cached_audio_file") {
          throw new Error(`Audio key "${key}" not found in cache`);
        }
        return { key, play: () => true };
      }
    }

    const testGlobal = {
      window: {
        jsfxr: mockJsfxr,
        Phaser: {
          Sound: {
            BaseSoundManager: MockBaseSoundManager,
            NoAudioSound: class {
              key: string;
              isPlaying = false;
              constructor(manager: unknown, key: string) {
                this.key = key;
              }
              play() {
                return false;
              }
            },
          },
        },
        soundPresets: {
          custom_event: "laser",
        },
      },
    };

    // Execute sound.js in the mock environment
    const fn = new Function("window", soundCode.replace(/export const soundFx =/, "const soundFx ="));
    fn(testGlobal.window);

    const sm = new MockBaseSoundManager();

    // 1. Cached audio file delegates to original play
    expect(sm.play("cached_audio_file")).toBe(true);

    // 2. Synthesized event "level_clear" plays without error and triggers powerUp preset
    expect(sm.play("level_clear")).toBe(true);
    expect(playedSounds).toContain("powerUp");

    // 3. Synthesized event "collect" plays without error
    expect(sm.play("collect")).toBe(true);
    expect(playedSounds).toContain("pickupCoin");

    // 4. Custom preset mapped in window.soundPresets plays without error
    expect(sm.play("custom_event")).toBe(true);
    expect(playedSounds).toContain("laserShoot");

    // 5. Unknown audio key returns false instead of throwing "Audio key not found in cache"
    expect(sm.play("totally_unknown_sound")).toBe(false);

    // 6. sm.add() on unknown or synthesized sound does not throw
    const soundObj = sm.add("level_clear") as { play: () => boolean };
    expect(soundObj).toBeDefined();
    expect(soundObj.play()).toBe(true);
  });
});
