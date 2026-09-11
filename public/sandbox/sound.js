// soundFx: the sound API exposed to generated game code, backed by jsfxr.
//
// jsfxr's own preset names are pickupCoin / laserShoot / explosion / powerUp /
// hitHurt / jump. The architecture documents shorter, stable names, so the
// mapping lives here rather than in every generated scene.

const PRESET_BY_NAME = {
  laser: "laserShoot",
  pickup: "pickupCoin",
  hit: "hitHurt",
  powerup: "powerUp",
  explosion: "explosion",
  jump: "jump",
};

let api = null;
let unlocked = false;

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
    const presetName = PRESET_BY_NAME[name];
    return presetName === undefined ? false : playPreset(presetName);
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
