/**
 * The bridge agent that runs inside a served preview document.
 *
 * It instruments `window.__MAIN_SCENE__` before boot, handles runtime errors,
 * forwards console logs, sends heartbeats, and listens for parent control
 * commands (pause/resume/restart/mute). The protocol types are governed by
 * `lib/sandbox/protocol.ts`.
 *
 * It must sit between the scene and the boot script: it wraps
 * `window.__MAIN_SCENE__` so the parent's `SCENE_READY` means "create() returned",
 * which is what probation and the boot watchdog watch for.
 */
export function buildPreviewAgent(input: {
  readonly appOrigin: string;
  readonly protocolVersion: number;
}): string {
  return `(function () {
  var PARENT_ORIGIN = ${JSON.stringify(input.appOrigin)};
  var PROTOCOL_VERSION = ${input.protocolVersion};
  var HEARTBEAT_INTERVAL_MS = 1000;
  var CONSOLE_MESSAGE_MAX_LENGTH = 200;
  var CONSOLE_FORWARD_MIN_INTERVAL_MS = 50;

  var phase = "preload";
  var heartbeatFrame = 0;
  var lastConsoleForwardAt = 0;

  function post(message) {
    if (window.parent === window) {
      return;
    }

    window.parent.postMessage(message, PARENT_ORIGIN);
  }

  function reportRuntimeError(payload) {
    post({
      type: "RUNTIME_ERROR",
      message: payload.message,
      stack: typeof payload.stack === "string" ? payload.stack : null,
      line: typeof payload.line === "number" ? payload.line : null,
      column: typeof payload.column === "number" ? payload.column : null,
      phase: phase,
    });
  }

  window.addEventListener("error", function (event) {
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

  window.addEventListener("unhandledrejection", function (event) {
    var reason = event.reason;

    reportRuntimeError({
      message:
        reason instanceof Error
          ? reason.message
          : "Unhandled promise rejection in the sandbox.",
      stack:
        reason instanceof Error && typeof reason.stack === "string" ? reason.stack : null,
    });
  });

  var LEVELS = ["log", "info", "warn", "error"];

  for (var i = 0; i < LEVELS.length; i += 1) {
    (function (level) {
      var original = console[level].bind(console);

      console[level] = function () {
        original.apply(null, arguments);

        if (level === "log" || level === "info") {
          var now = Date.now();

          if (now - lastConsoleForwardAt < CONSOLE_FORWARD_MIN_INTERVAL_MS) {
            return;
          }

          lastConsoleForwardAt = now;
        }

        var text = Array.prototype.slice
          .call(arguments)
          .map(function (arg) {
            if (typeof arg === "string") {
              return arg;
            }

            try {
              return JSON.stringify(arg);
            } catch (error) {
              return String(arg);
            }
          })
          .join(" ")
          .slice(0, CONSOLE_MESSAGE_MAX_LENGTH);

        post({ type: "CONSOLE_LOG", level: level, message: text });
      };
    })(LEVELS[i]);
  }

  function instrument(base) {
    return class extends base {
      preload() {
        phase = "preload";

        var fn = base.prototype.preload;

        return typeof fn === "function" ? fn.apply(this, arguments) : undefined;
      }

      create() {
        phase = "create";

        var fn = base.prototype.create;
        var result = typeof fn === "function" ? fn.apply(this, arguments) : undefined;

        phase = "update";
        post({ type: "SCENE_READY", protocolVersion: PROTOCOL_VERSION });

        return result;
      }

      update() {
        phase = "update";

        var fn = base.prototype.update;

        return typeof fn === "function" ? fn.apply(this, arguments) : undefined;
      }
    };
  }

  var baseScene = window.__MAIN_SCENE__;

  if (typeof baseScene !== "function") {
    reportRuntimeError({ message: "Injected source did not define window.__MAIN_SCENE__." });
  } else {
    window.__MAIN_SCENE__ = instrument(baseScene);
  }

  window.addEventListener("message", function (event) {
    if (event.origin !== PARENT_ORIGIN) {
      return;
    }

    var message = event.data;

    if (message === null || typeof message !== "object") {
      return;
    }

    var game = window.__GAME__;

    if (message.type === "PAUSE_GAME") {
      if (game) {
        game.scene.getScenes(true).forEach(function (scene) {
          scene.scene.pause();
        });
      }
    } else if (message.type === "RESUME_GAME") {
      if (game) {
        game.scene.getScenes(true).forEach(function (scene) {
          scene.scene.resume();
        });
      }
    } else if (message.type === "RESTART_GAME") {
      if (game) {
        game.scene.getScenes(true).forEach(function (scene) {
          scene.scene.restart();
        });
      }
    } else if (message.type === "SET_MUTED") {
      if (window.soundFx) {
        window.soundFx.setMuted(message.muted === true);
      }
    }
  });

  setInterval(function () {
    if (window.parent === window) {
      return;
    }

    heartbeatFrame += 1;
    post({ type: "HEARTBEAT", frame: heartbeatFrame });
  }, HEARTBEAT_INTERVAL_MS);
})();`;
}
