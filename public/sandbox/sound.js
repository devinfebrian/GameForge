// soundFx: the sound API exposed to generated game code, backed by jsfxr.
//
// jsfxr's own preset names are pickupCoin / laserShoot / explosion / powerUp /
// hitHurt / jump. The architecture documents shorter, stable names, so the
// mapping lives here rather than in every generated scene.

const PRESET_BY_NAME = {
  // Direct jsfxr & GameForge preset names
  laser: "laserShoot",
  laserShoot: "laserShoot",
  pickup: "pickupCoin",
  pickupCoin: "pickupCoin",
  hit: "hitHurt",
  hitHurt: "hitHurt",
  powerup: "powerUp",
  powerUp: "powerUp",
  explosion: "explosion",
  jump: "jump",
  blip: "blipSelect",
  blipSelect: "blipSelect",

  // GameForge standard events (from defaultSynthesizedSounds & LLM prompts)
  level_clear: "powerUp",
  level_complete: "powerUp",
  clear: "powerUp",
  win: "powerUp",
  victory: "powerUp",
  game_over: "explosion",
  collect: "pickupCoin",
  coin: "pickupCoin",
  item: "pickupCoin",
  shoot: "laserShoot",
  fire: "laserShoot",
  enemy_hit: "hitHurt",
  enemy_defeat: "explosion",
  defeat: "explosion",
  hurt: "hitHurt",
  damage: "hitHurt",
  death: "explosion",
  select: "blipSelect",
};

function normalizeName(name) {
  return typeof name === "string" ? name.toLowerCase().replace(/[-_\s]+/g, "") : "";
}

const NORMALIZED_PRESET_MAP = {
  laser: "laserShoot",
  lasershoot: "laserShoot",
  shoot: "laserShoot",
  fire: "laserShoot",
  pickup: "pickupCoin",
  pickupcoin: "pickupCoin",
  coin: "pickupCoin",
  collect: "pickupCoin",
  item: "pickupCoin",
  hit: "hitHurt",
  hithurt: "hitHurt",
  hurt: "hitHurt",
  damage: "hitHurt",
  enemyhit: "hitHurt",
  powerup: "powerUp",
  powerUp: "powerUp",
  levelclear: "powerUp",
  levelcomplete: "powerUp",
  clear: "powerUp",
  win: "powerUp",
  victory: "powerUp",
  explosion: "explosion",
  gameover: "explosion",
  enemydefeat: "explosion",
  defeat: "explosion",
  kill: "explosion",
  death: "explosion",
  jump: "jump",
  blip: "blipSelect",
  blipselect: "blipSelect",
  select: "blipSelect",
};

function resolvePreset(name) {
  if (typeof name !== "string") return undefined;
  if (PRESET_BY_NAME[name]) return PRESET_BY_NAME[name];
  // Check window.soundPresets if injected from version manifest
  if (typeof window !== "undefined" && window.soundPresets && window.soundPresets[name]) {
    const mapped = window.soundPresets[name];
    if (PRESET_BY_NAME[mapped]) return PRESET_BY_NAME[mapped];
    if (NORMALIZED_PRESET_MAP[normalizeName(mapped)]) return NORMALIZED_PRESET_MAP[normalizeName(mapped)];
  }
  const norm = normalizeName(name);
  if (NORMALIZED_PRESET_MAP[norm]) return NORMALIZED_PRESET_MAP[norm];
  return undefined;
}

let api = null;
let unlocked = false;
let muted = false;

function resolveApi() {
  if (api === null) {
    const root = window.jsfxr;
    api = root !== undefined && root !== null && root.sfxr !== undefined ? root.sfxr : null;
  }
  return api;
}

function playPreset(presetName) {
  const sfxr = resolveApi();

  if (sfxr === null) {
    return false;
  }

  try {
    const result = sfxr.play(sfxr.generate(presetName));

    // Autoplay policy rejects play() until the frame has seen a gesture. Swallow
    // it here so a blocked sound surfaces as one quiet failure, not as an
    // unhandled rejection that the runner reports as a runtime error.
    if (result !== undefined && result !== null && typeof result.catch === "function") {
      result.catch(() => undefined);
    }

    return true;
  } catch {
    return false;
  }
}

export const soundFx = {
  available() {
    return resolveApi() !== null;
  },

  play(name) {
    // Checked before the preset lookup: muting should cost nothing, and
    // generating an effect only to discard it would still allocate buffers.
    if (muted) {
      return false;
    }

    const presetName = resolvePreset(name);
    return presetName === undefined ? false : playPreset(presetName);
  },

  // Module scope, so a mute survives LOAD_CODE tearing down and rebuilding the
  // game: the runner is not reloaded, only the scene is.
  setMuted(value) {
    muted = value === true;
    return muted;
  },

  // Warm the audio path from inside a real user gesture. Generating a silent
  // sound is enough to satisfy the autoplay policy for later programmatic plays.
  unlock() {
    if (unlocked) {
      return;
    }

    unlocked = true;

    const sfxr = resolveApi();

    if (sfxr === null) {
      return;
    }

    try {
      const silent = sfxr.generate("blipSelect");
      silent.sound_vol = 0;
      const result = sfxr.play(silent);

      if (result !== undefined && result !== null && typeof result.catch === "function") {
        result.catch(() => undefined);
      }
    } catch {
      // A failure here just means sound stays unavailable; nothing to report.
    }
  },
};

window.soundFx = soundFx;

// Bridge soundFx presets into Phaser's sound manager if Phaser is present
if (
  typeof window !== "undefined" &&
  typeof window.Phaser !== "undefined" &&
  window.Phaser.Sound &&
  window.Phaser.Sound.BaseSoundManager
) {
  const origPlay = window.Phaser.Sound.BaseSoundManager.prototype.play;
  window.Phaser.Sound.BaseSoundManager.prototype.play = function (key, extra) {
    if (this.game && this.game.cache && this.game.cache.audio && this.game.cache.audio.has(key)) {
      return origPlay.call(this, key, extra);
    }
    if (soundFx.play(key)) {
      return true;
    }
    // Safe fallback: key is neither in cache nor a known sound preset.
    // Return false instead of letting Phaser throw "Audio key not found in cache".
    return false;
  };

  const origAdd = window.Phaser.Sound.BaseSoundManager.prototype.add;
  window.Phaser.Sound.BaseSoundManager.prototype.add = function (key, config) {
    if (this.game && this.game.cache && this.game.cache.audio && this.game.cache.audio.has(key)) {
      return origAdd.call(this, key, config);
    }
    // Return a sound object that delegates play() to soundFx without crashing
    const sound = window.Phaser.Sound.NoAudioSound
      ? new window.Phaser.Sound.NoAudioSound(this, key, config)
      : { key, isPlaying: false, play: () => {}, stop: () => {}, once: () => {}, on: () => {}, destroy: () => {} };
    const origSoundPlay = sound.play;
    sound.play = function (marker, soundConfig) {
      if (soundFx.play(key)) return true;
      if (origSoundPlay) return origSoundPlay.call(this, marker, soundConfig);
      return false;
    };
    this.sounds.push(sound);
    return sound;
  };
}
