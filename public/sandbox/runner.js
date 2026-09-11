// Sandbox runner. Runs in an opaque origin (sandbox="allow-scripts", no
// allow-same-origin), so it has no access to cookies, storage, or the parent
// document. Everything it knows about the outside world arrives by postMessage.

import { FRAME_TO_PARENT_TYPES, PROTOCOL_VERSION } from "./protocol.js";
import { soundFx } from "./sound.js";

const GAME_CONTAINER_ID = "game";
const HEARTBEAT_INTERVAL_MS = 1000;
const CONSOLE_MESSAGE_MAX_LENGTH = 200;
const CONSOLE_FORWARD_MIN_INTERVAL_MS = 50;

let parentOrigin = null;
let game = null;
let scriptElement = null;
let scriptUrl = null;
let phase = "preload";
let heartbeatFrame = 0;
let lastConsoleForwardAt = 0;
let audioUnlockInstalled = false;

function post(message) {
  if (parentOrigin === null || !FRAME_TO_PARENT_TYPES.includes(message.type)) {
    return;
  }

  window.parent.postMessage(message, parentOrigin);
}

function reportRuntimeError(payload) {
  post({
    type: "RUNTIME_ERROR",
    message: payload.message,
    stack: typeof payload.stack === "string" ? payload.stack : null,
    line: typeof payload.line === "number" ? payload.line : null,
    column: typeof payload.column === "number" ? payload.column : null,
    phase,
  });
}

window.addEventListener("error", (event) => {
  reportRuntimeError({
    message:
      typeof event.message === "string" && event.message.length > 0
        ? event.message
        : "Unhandled error in the sandbox.",
    stack:
      event.error instanceof Error && typeof event.error.stack === "string"
        ? event.error.stack
        : null,
    line: typeof event.lineno === "number" ? event.lineno : null,
    column: typeof event.colno === "number" ? event.colno : null,
  });
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;

  reportRuntimeError({
    message:
      reason instanceof Error
        ? reason.message
        : "Unhandled promise rejection in the sandbox.",
    stack:
      reason instanceof Error && typeof reason.stack === "string"
        ? reason.stack
        : null,
  });
});

function formatConsoleArgs(args) {
  return args
    .map((arg) => {
      if (typeof arg === "string") {
        return arg;
      }

      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

for (const level of ["log", "info", "warn", "error"]) {
  const original = console[level].bind(console);

  console[level] = (...args) => {
    original(...args);

    const now = Date.now();

    if (now - lastConsoleForwardAt < CONSOLE_FORWARD_MIN_INTERVAL_MS) {
      return;
    }

    lastConsoleForwardAt = now;

    post({
      type: "CONSOLE_LOG",
      level,
      message: formatConsoleArgs(args).slice(0, CONSOLE_MESSAGE_MAX_LENGTH),
    });
  };
}

// Wraps the injected scene so `phase` is accurate for error reporting and so
// SCENE_READY means "create() returned without throwing", not merely "game booted".
function instrumentScene(base) {
  class InstrumentedScene extends base {
    preload(...args) {
      phase = "preload";

      const fn = base.prototype.preload;

      return typeof fn === "function" ? fn.apply(this, args) : undefined;
    }

    create(...args) {
      phase = "create";

      const fn = base.prototype.create;
      const result = typeof fn === "function" ? fn.apply(this, args) : undefined;

      phase = "update";
      post({ type: "SCENE_READY", protocolVersion: PROTOCOL_VERSION });

      return result;
    }

    update(...args) {
      phase = "update";

      const fn = base.prototype.update;

      return typeof fn === "function" ? fn.apply(this, args) : undefined;
    }
  }

  return InstrumentedScene;
}

function startGame(scene) {
  const container = document.getElementById(GAME_CONTAINER_ID);

  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: container === null ? undefined : container,
    backgroundColor: "#0b1020",
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: 480,
      height: 320,
    },
    physics: {
      default: "arcade",
      arcade: { gravity: { x: 0, y: 0 }, debug: false },
    },
    scene: [instrumentScene(scene)],
  });
}

function teardown() {
  if (game !== null) {
    game.destroy(true);
    game = null;
  }

  if (scriptElement !== null) {
    scriptElement.remove();
    scriptElement = null;
  }

  if (scriptUrl !== null) {
    URL.revokeObjectURL(scriptUrl);
    scriptUrl = null;
  }

  delete window.__MAIN_SCENE__;
}

function handleLoadCode(message) {
  if (message.protocolVersion !== PROTOCOL_VERSION) {
    reportRuntimeError({
      message: `Protocol version mismatch: frame speaks ${PROTOCOL_VERSION}, parent sent ${message.protocolVersion}.`,
    });
    return;
  }

  teardown();
  phase = "preload";
  window.assetManifest = message.assetManifest;

  const blob = new Blob([message.code], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  const element = document.createElement("script");

  element.addEventListener("load", () => {
    const scene = window.__MAIN_SCENE__;

    if (typeof scene !== "function") {
      reportRuntimeError({
        message: "Injected source did not define window.__MAIN_SCENE__.",
      });
      return;
    }

    startGame(scene);
  });

  element.addEventListener("error", () => {
    reportRuntimeError({ message: "The injected scene source failed to evaluate." });
  });

  element.src = url;
  scriptUrl = url;
  scriptElement = element;

  document.head.appendChild(element);
}

function installAudioUnlock() {
  if (audioUnlockInstalled) {
    return;
  }

  audioUnlockInstalled = true;

  window.addEventListener(
    "pointerdown",
    () => {
      soundFx.unlock();
    },
    { once: true },
  );
}

window.addEventListener("message", (event) => {
  // An opaque origin cannot be allowlisted by string, so sender identity is the
  // only authority available in either direction.
  if (event.source !== window.parent) {
    return;
  }

  if (parentOrigin === null) {
    // First accepted message pins the parent origin for everything after it.
    parentOrigin = event.origin;
    installAudioUnlock();
  } else if (event.origin !== parentOrigin) {
    return;
  }

  const message = event.data;

  if (message === null || typeof message !== "object") {
    return;
  }

  switch (message.type) {
    case "LOAD_CODE":
      handleLoadCode(message);
      break;
    case "PAUSE_GAME":
      if (game !== null) {
        game.scene.getScenes(true).forEach((scene) => scene.scene.pause());
      }
      break;
    case "RESUME_GAME":
      if (game !== null) {
        game.scene.getScenes(true).forEach((scene) => scene.scene.resume());
      }
      break;
    case "RESTART_GAME":
      if (game !== null) {
        game.scene.getScenes(true).forEach((scene) => scene.scene.restart());
      }
      break;
    default:
      break;
  }
});

setInterval(() => {
  if (parentOrigin === null) {
    return;
  }

  heartbeatFrame += 1;
  post({ type: "HEARTBEAT", frame: heartbeatFrame });
}, HEARTBEAT_INTERVAL_MS);
