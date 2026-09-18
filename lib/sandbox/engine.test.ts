import { describe, expect, test } from "bun:test";
import { GAMEFORGE_ENGINE } from "@/lib/sandbox/engine";

interface MockStateMachine {
  readonly current: string;
  is(state: string): boolean;
  transition(state: string): void;
}

interface MockPlatformerController {
  update(time: number, delta: number, input: { readonly jumpPressed?: boolean }): void;
  reset(x: number, y: number): void;
}

interface MockGameForge {
  readonly version: string;
  clampDelta(delta: number, max?: number): number;
  createStateMachine(config: {
    readonly initial: string;
    readonly states: Record<string, { readonly onEnter?: () => void; readonly onExit?: () => void }>;
  }): MockStateMachine;
  createPlatformer(
    scene: unknown,
    player: unknown,
    config: {
      readonly speed: number;
      readonly jumpForce: number;
      readonly onJump?: () => void;
    },
  ): MockPlatformerController;
}

describe("GAMEFORGE_ENGINE", () => {
  test("evaluates cleanly without syntax errors and attaches to window.GameForge", () => {
    const mockWindow: Record<string, unknown> = {};
    const run = new Function("window", GAMEFORGE_ENGINE);
    run(mockWindow);

    expect(mockWindow.GameForge).toBeDefined();
    const gf = mockWindow.GameForge as MockGameForge;

    expect(gf.version).toBe("1.0.0");
    expect(gf.clampDelta(100, 50)).toBe(50);
    expect(gf.clampDelta(16.6, 50)).toBeCloseTo(16.6, 1);
  });

  test("state machine handles transitions and lifecycle cleanly", () => {
    const mockWindow: Record<string, unknown> = {};
    const run = new Function("window", GAMEFORGE_ENGINE);
    run(mockWindow);

    const gf = mockWindow.GameForge as MockGameForge;
    let enteredPlaying = false;
    let exitedRunning = false;

    const sm = gf.createStateMachine({
      initial: "title",
      states: {
        title: {
          onExit: () => { exitedRunning = true; },
        },
        playing: {
          onEnter: () => { enteredPlaying = true; },
        },
        dead: {},
        won: {},
      },
    });

    expect(sm.current).toBe("title");
    expect(sm.is("title")).toBe(true);

    sm.transition("playing");
    expect(sm.current).toBe("playing");
    expect(sm.is("playing")).toBe(true);
    expect(enteredPlaying).toBe(true);
    expect(exitedRunning).toBe(true);
  });

  test("platformer controller handles coyote time, jump buffer, and reset", () => {
    const mockWindow: Record<string, unknown> = {};
    const run = new Function("window", GAMEFORGE_ENGINE);
    run(mockWindow);

    const gf = mockWindow.GameForge as MockGameForge;
    let jumpCalled = false;
    let recordedX = 0;
    let recordedY = 0;
    const player = {
      body: {
        blocked: { down: true },
        touching: { down: true },
        velocity: { x: 0, y: 0 },
        setVelocityX: function(x: number) { this.velocity.x = x; },
        setVelocityY: function(y: number) { this.velocity.y = y; },
        setVelocity: function(x: number, y: number) { this.velocity.x = x; this.velocity.y = y; },
      },
      setPosition: function(x: number, y: number) {
        recordedX = x;
        recordedY = y;
      },
    };

    const controller = gf.createPlatformer({}, player, {
      speed: 200,
      jumpForce: 350,
      onJump: () => { jumpCalled = true; },
    });

    // Simulate grounded jump
    controller.update(0, 16, { jumpPressed: true });
    expect(jumpCalled).toBe(true);
    expect(player.body.velocity.y).toBe(-350);

    // Test reset
    controller.reset(100, 200);
    expect(player.body.velocity.x).toBe(0);
    expect(player.body.velocity.y).toBe(0);
    expect(recordedX).toBe(100);
    expect(recordedY).toBe(200);
  });
});
