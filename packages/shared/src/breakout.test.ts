import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BREAKOUT_CONFIG,
  BOARD_WIDTH,
  BreakoutAction,
  BreakoutGameEngine,
  BreakoutState,
  brickIndex,
} from "./games/breakout.js";
import { TimestampedInput } from "./types.js";

const seed = "2026-11-01:breakout:v1";
const BRICK_TOP = BREAKOUT_CONFIG.BRICK_TOP;
const BRICK_PITCH = BREAKOUT_CONFIG.BRICK_PITCH;

function clone(state: BreakoutState): BreakoutState {
  return JSON.parse(JSON.stringify(state)) as BreakoutState;
}

/** Drops the ball onto the paddle with the serve already finished. */
function armed(state: BreakoutState): BreakoutState {
  const next = clone(state);
  next.serveTicks = 0;
  next.status = "RUNNING";
  return next;
}

/** Places the ball with an explicit velocity. */
function ball(
  state: BreakoutState,
  x: number,
  y: number,
  vx: number,
  vy: number
): BreakoutState {
  const next = armed(state);
  next.ball = { x, y, vx, vy };
  return next;
}

/** Scalar speed of the ball, in units per tick. */
function speedOf(state: BreakoutState): number {
  return Math.sqrt(state.ball.vx ** 2 + state.ball.vy ** 2);
}

describe("Breakout Sprint engine", () => {
  const engine = new BreakoutGameEngine();

  it("builds a deterministic wall from the seed", () => {
    const a = engine.init(seed);
    const b = engine.init(seed);

    assert.deepEqual(a.bricks, b.bricks);
    assert.equal(a.bricks.length, BREAKOUT_CONFIG.COLS * BREAKOUT_CONFIG.BRICK_ROWS);
    assert.ok(a.bricksLeft > 30, "the wall should be substantial");
    assert.equal(a.status, "READY");
    assert.equal(a.lives, BREAKOUT_CONFIG.LIVES);
    assert.equal(a.tickCount, 0);
    assert.equal(a.ball.vy, BREAKOUT_CONFIG.BALL_START_VY);
    assert.ok(a.ball.y < BREAKOUT_CONFIG.PADDLE_TOP);
    assert.equal(
      a.paddleX,
      Math.round((BOARD_WIDTH - BREAKOUT_CONFIG.PADDLE_WIDTH) / 2)
    );
  });

  it("produces different layouts for different days", () => {
    const a = engine.init("2026-11-01:breakout:v1");
    const b = engine.init("2026-11-02:breakout:v1");
    assert.notDeepEqual(a.bricks, b.bricks);
  });

  it("freezes the board until the first move", () => {
    const idle = engine.step(engine.init(seed));
    assert.equal(idle.state.tickCount, 0);
    assert.equal(idle.event, "none");

    const started = engine.step(engine.init(seed), { type: "MOVE", dir: "STOP" });
    assert.equal(started.state.status, "RUNNING");
    assert.equal(started.state.tickCount, 1);
  });

  it("serves the ball after the countdown", () => {
    let state: BreakoutState = engine.init(seed);
    const first = engine.step(state, { type: "MOVE", dir: "STOP" });
    state = first.state;
    assert.equal(state.serveTicks, BREAKOUT_CONFIG.SERVE_TICKS - 1);

    for (let i = 0; i < BREAKOUT_CONFIG.SERVE_TICKS - 2; i++) {
      state = engine.step(state, { type: "MOVE", dir: "STOP" }).state;
      assert.equal(state.ball.vy, BREAKOUT_CONFIG.BALL_START_VY, "ball waits on the paddle");
    }

    const served = engine.step(state, { type: "MOVE", dir: "STOP" });
    assert.equal(served.event, "serve");
    assert.equal(served.state.serveTicks, 0);
    assert.ok(served.state.ball.vy < 0, "the serve travels upward");
    assert.ok(served.state.ball.y < BREAKOUT_CONFIG.PADDLE_TOP);
  });

  it("bounces off the paddle and steers with the hit offset", () => {
    const base = engine.init(seed);
    const centre = BREAKOUT_CONFIG.PADDLE_TOP - BREAKOUT_CONFIG.BALL_RADIUS + 60;
    const x = base.paddleX + BREAKOUT_CONFIG.PADDLE_WIDTH / 2;

    const hit = engine.step(
      ball(base, x, centre, 0, 260),
      { type: "MOVE", dir: "STOP" }
    );

    assert.equal(hit.event, "paddle");
    assert.ok(hit.state.ball.vy < 0, "the ball is sent back up");
    assert.equal(hit.state.paddleHits, 1);

    // Aiming at the right edge should push the ball right.
    const edgeX = base.paddleX + BREAKOUT_CONFIG.PADDLE_WIDTH - 60;
    const edge = engine.step(
      ball(base, edgeX, centre, 0, 260),
      { type: "MOVE", dir: "STOP" }
    );
    assert.equal(edge.event, "paddle");
    assert.ok(edge.state.ball.vx > 0);
  });

  it("steers the ball without changing its speed", () => {
    const base = engine.init(seed);
    const centre = BREAKOUT_CONFIG.PADDLE_TOP - BREAKOUT_CONFIG.BALL_RADIUS + 60;
    const incoming = 260;

    const middle = engine.step(
      ball(base, base.paddleX + BREAKOUT_CONFIG.PADDLE_WIDTH / 2, centre, 0, incoming),
      { type: "MOVE", dir: "STOP" }
    );
    assert.equal(middle.event, "paddle");
    assert.ok(
      Math.abs(speedOf(middle.state) - incoming) <= 1.5,
      "a centre hit keeps the pace"
    );

    const edge = engine.step(
      ball(
        base,
        base.paddleX + BREAKOUT_CONFIG.PADDLE_WIDTH - 20,
        centre,
        0,
        incoming
      ),
      { type: "MOVE", dir: "STOP" }
    );
    assert.equal(edge.event, "paddle");
    assert.ok(
      Math.abs(speedOf(edge.state) - incoming) <= 1.5,
      "an edge hit keeps the pace too"
    );
    assert.ok(
      Math.abs(edge.state.ball.vx) > Math.abs(middle.state.ball.vx),
      "the edge steers harder than the centre"
    );
  });

  it("travels the same distance whatever the angle", () => {
    const base = engine.init(seed);
    const start = { x: 6000, y: 6000 };

    const straight = engine.step(
      ball(base, start.x, start.y, 0, -300),
      { type: "MOVE", dir: "STOP" }
    );
    const diagonal = engine.step(
      ball(base, start.x, start.y, 212, -212),
      { type: "MOVE", dir: "STOP" }
    );

    const straightDistance = Math.sqrt(
      (straight.state.ball.x - start.x) ** 2 +
        (straight.state.ball.y - start.y) ** 2
    );
    const diagonalDistance = Math.sqrt(
      (diagonal.state.ball.x - start.x) ** 2 +
        (diagonal.state.ball.y - start.y) ** 2
    );

    assert.ok(
      Math.abs(straightDistance - 300) <= 1,
      `straight travel was ${straightDistance}`
    );
    assert.ok(
      Math.abs(diagonalDistance - straightDistance) <= 1.5,
      "a diagonal path covers the same ground, not more"
    );
  });

  it("nudges the speed by a flat amount per brick", () => {
    const base = engine.init(seed);
    const row = BREAKOUT_CONFIG.BRICK_ROWS - 1;
    const index = brickIndex(row, 3);
    const wall = { ...base, bricks: [...base.bricks] };
    wall.bricks[index] = 1;

    const rowTop = BRICK_TOP + row * BRICK_PITCH;
    const insideY = rowTop + BREAKOUT_CONFIG.BRICK_HEIGHT - 100;
    const before = 260;

    const hit = engine.step(
      ball(wall, 3 * BREAKOUT_CONFIG.SUB + 500, insideY, 0, -before),
      { type: "MOVE", dir: "STOP" }
    );

    assert.equal(hit.event, "brick");
    assert.ok(
      Math.abs(
        speedOf(hit.state) - (before + BREAKOUT_CONFIG.BALL_SPEED_PER_BRICK)
      ) <= 1.5,
      "one brick is one flat nudge, independent of the bounce angle"
    );
  });

  it("damages bricks and clears them after their hit points run out", () => {
    const base = engine.init(seed);
    // Bottom row, so nothing sits below the impact inside the same tick.
    const row = BREAKOUT_CONFIG.BRICK_ROWS - 1;
    const index = brickIndex(row, 3);
    const tough = { ...base, bricks: [...base.bricks] };
    tough.bricks[index] = 2;

    const rowTop = BRICK_TOP + row * BRICK_PITCH;
    const insideY = rowTop + BREAKOUT_CONFIG.BRICK_HEIGHT - 100;

    const firstHit = engine.step(
      ball(tough, 3 * BREAKOUT_CONFIG.SUB + 500, insideY, 0, -260),
      { type: "MOVE", dir: "STOP" }
    );
    assert.equal(firstHit.event, "brick");
    assert.equal(firstHit.state.bricks[index], 1, "tough bricks need two hits");
    assert.equal(firstHit.state.bricksBroken, 0);
    assert.ok(firstHit.state.ball.vy > 0, "the ball bounces back down");

    const second = engine.step(
      ball(firstHit.state, 3 * BREAKOUT_CONFIG.SUB + 500, insideY, 0, -260),
      { type: "MOVE", dir: "STOP" }
    );
    assert.equal(second.event, "brick");
    assert.equal(second.state.bricks[index], 0);
    assert.equal(second.state.bricksBroken, 1);
    assert.equal(
      second.state.bricksLeft,
      firstHit.state.bricksLeft - 1,
      "cleared bricks leave the counter"
    );
  });

  it("bounces off the side walls", () => {
    const base = engine.init(seed);
    const hit = engine.step(
      ball(base, BREAKOUT_CONFIG.BALL_RADIUS + 20, 6000, -200, -200),
      { type: "MOVE", dir: "STOP" }
    );
    assert.equal(hit.event, "wall");
    assert.ok(hit.state.ball.vx > 0);
  });

  it("costs a life when the ball drops past the paddle", () => {
    const base = engine.init(seed);
    const result = engine.step(
      ball(base, 6000, BREAKOUT_CONFIG.ROWS * BREAKOUT_CONFIG.SUB + 400, 0, 260),
      { type: "MOVE", dir: "STOP" }
    );

    assert.equal(result.event, "lifeLost");
    assert.equal(result.gameOver, false);
    assert.equal(result.state.lives, BREAKOUT_CONFIG.LIVES - 1);
    assert.equal(result.state.serveTicks, BREAKOUT_CONFIG.SERVE_TICKS);
    assert.ok(result.state.ball.y < BREAKOUT_CONFIG.PADDLE_TOP);
  });

  it("ends the run after the last life", () => {
    const base = clone(engine.init(seed));
    base.lives = 1;

    const result = engine.step(
      ball(base, 6000, BREAKOUT_CONFIG.ROWS * BREAKOUT_CONFIG.SUB + 400, 0, 260),
      { type: "MOVE", dir: "STOP" }
    );

    assert.equal(result.gameOver, true);
    assert.equal(result.state.status, "LOST");
    assert.equal(result.state.lives, 0);
  });

  it("wins on the last brick", () => {
    const base = clone(engine.init(seed));
    base.bricks = base.bricks.map(() => 0);
    base.bricks[brickIndex(1, 4)] = 1;
    base.bricksLeft = 1;
    const brickTopRow = BRICK_TOP + BRICK_PITCH;

    const result = engine.step(
      ball(base, 4 * BREAKOUT_CONFIG.SUB + 500, brickTopRow + 300, 0, -260),
      { type: "MOVE", dir: "STOP" }
    );

    assert.equal(result.win, true);
    assert.equal(result.state.status, "WON");
    assert.equal(result.state.bricksLeft, 0);
  });

  it("tracks the pointer with AIM actions", () => {
    const base = engine.init(seed);
    const before = base.paddleX;
    const target = 8000;
    const result = engine.step(base, { type: "AIM", x: target });
    assert.equal(
      result.state.paddleX,
      before + BREAKOUT_CONFIG.PADDLE_SPEED,
      "the paddle steps toward the pointer"
    );
    assert.equal(result.state.paddleTarget, target - BREAKOUT_CONFIG.PADDLE_WIDTH / 2);
  });

  it("verifies a full winning run", () => {
    const { inputs, state } = playToWin(engine, seed);

    assert.equal(state.status, "WON", "the pilot should clear the wall");
    assert.equal(state.bricksLeft, 0);
    assert.ok(inputs.length > 5);

    const claimedTimeMs = state.tickCount * BREAKOUT_CONFIG.TICK_MS;
    const result = engine.verify(seed, inputs, claimedTimeMs);

    assert.equal(result.valid, true, result.reason ?? "verification failed");
    assert.equal(result.verifiedTimeMs, claimedTimeMs);
    assert.equal(result.summary?.bricksBroken, result.summary?.bricksTotal);
    assert.equal(result.summary?.ticks, state.tickCount);
  });

  it("rejects empty, early and malformed runs", () => {
    const empty = engine.verify(seed, [], 30000);
    assert.equal(empty.valid, false);
    assert.match(empty.reason || "", /non-empty/);

    const tooFast = engine.verify(
      seed,
      [{ t: 100, tick: 0, action: { type: "MOVE", dir: "STOP" } }],
      100
    );
    assert.equal(tooFast.valid, false);
    assert.match(tooFast.reason || "", /plausible human/);

    const lateStart = engine.verify(
      seed,
      [{ t: 30000, tick: 40, action: { type: "MOVE", dir: "STOP" } }],
      30000
    );
    assert.equal(lateStart.valid, false);
    assert.match(lateStart.reason || "", /tick 0/);

    const badAim = engine.verify(
      seed,
      [
        {
          t: 30000,
          tick: 0,
          action: { type: "AIM", x: BOARD_WIDTH + 10 } as BreakoutAction,
        },
      ],
      30000
    );
    assert.equal(badAim.valid, false);
    assert.match(badAim.reason || "", /Invalid aim/);

    const badType = engine.verify(
      seed,
      [
        {
          t: 30000,
          tick: 0,
          action: { type: "TELEPORT" } as unknown as BreakoutAction,
        },
      ],
      30000
    );
    assert.equal(badType.valid, false);
    assert.match(badType.reason || "", /Unknown action/);
  });

  it("rejects a run that never clears the wall", () => {
    const inputs: TimestampedInput<BreakoutAction>[] = [];
    for (let tick = 0; tick < 200; tick += 20) {
      inputs.push({
        t: tick * BREAKOUT_CONFIG.TICK_MS,
        tick,
        action: { type: "MOVE", dir: "STOP" },
      });
    }
    const result = engine.verify(seed, inputs, 200 * BREAKOUT_CONFIG.TICK_MS);
    assert.equal(result.valid, false);
    assert.ok((result.reason || "").length > 0, "a reason is reported");
  });

  it("exposes the public board configuration", () => {
    assert.equal(BOARD_WIDTH, BREAKOUT_CONFIG.COLS * BREAKOUT_CONFIG.SUB);
    assert.ok(BREAKOUT_CONFIG.LIVES >= 1);
    assert.ok(BREAKOUT_CONFIG.PADDLE_WIDTH < BOARD_WIDTH);
  });
});

/**
 * Perfect-paddle pilot: parks under the ball and mirrors its x. It is
 * deliberately simple; the point is to produce a real winning input stream for
 * the replay verifier, not to be a good player.
 */
function playToWin(
  engine: BreakoutGameEngine,
  targetSeed: string
): { inputs: TimestampedInput<BreakoutAction>[]; state: BreakoutState } {
  let state = engine.init(targetSeed);
  const inputs: TimestampedInput<BreakoutAction>[] = [];
  let lastTarget = -1;
  let current: BreakoutAction | undefined;
  let guard = 0;

  while (
    state.status !== "WON" &&
    state.status !== "LOST" &&
    guard++ < BREAKOUT_CONFIG.MAX_TICKS
  ) {
    const clamped = Math.min(
      BOARD_WIDTH - BREAKOUT_CONFIG.BALL_RADIUS,
      Math.max(BREAKOUT_CONFIG.BALL_RADIUS, state.ball.x)
    );

    if (current === undefined || Math.abs(clamped - lastTarget) > 120) {
      current = { type: "AIM", x: clamped };
      inputs.push({
        t: state.tickCount * BREAKOUT_CONFIG.TICK_MS,
        tick: state.tickCount,
        action: current,
      });
      lastTarget = clamped;
    }

    // Step with the sticky action, exactly like the verifier will.
    const result = engine.step(state, current);
    state = result.state;
    if (result.win || result.gameOver) break;
  }

  return { inputs, state };
}
