import { createPRNG, randomInt } from "../prng.js";
import {
  GameEngine,
  TimestampedInput,
  VerificationResult,
} from "../types.js";

/**
 * Breakout Sprint.
 *
 * The whole simulation is integer fixed-point: one cell is `SUB` units, the
 * ball moves in whole units per tick and every collision is resolved with
 * axis-aligned overlap tests. That keeps the edge replay byte-identical to the
 * client, which is what makes the leaderboard trustworthy.
 */

export type BreakoutMove = "LEFT" | "RIGHT" | "STOP";

export type BreakoutAction =
  | { type: "MOVE"; dir: BreakoutMove }
  | { type: "AIM"; x: number };

export type BreakoutEvent =
  | "none"
  | "wall"
  | "paddle"
  | "brick"
  | "serve"
  | "lifeLost"
  | "timeout";

export type BreakoutStatus = "READY" | "RUNNING" | "WON" | "LOST";

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface BreakoutState {
  seed: string;
  tickMs: number;
  tickCount: number;
  status: BreakoutStatus;
  /** Left edge of the paddle, in units. */
  paddleX: number;
  /** -1, 0 or 1, used by the renderer for tilt. */
  paddleVelocity: number;
  /** Pointer target, or null when the paddle is keyboard driven. */
  paddleTarget: number | null;
  ball: Ball;
  /** Hit points per brick cell, 0 = empty. Row-major, `COLS` wide. */
  bricks: number[];
  bricksLeft: number;
  bricksBroken: number;
  paddleHits: number;
  lives: number;
  serveTicks: number;
  lastEvent: BreakoutEvent;
  eventTick: number;
}

export interface BreakoutSummary {
  ticks: number;
  bricksBroken: number;
  bricksTotal: number;
  livesLeft: number;
  paddleHits: number;
}

export interface BreakoutStepResult {
  state: BreakoutState;
  win: boolean;
  gameOver: boolean;
  event: BreakoutEvent;
}

export const BREAKOUT_CONFIG = {
  COLS: 12,
  ROWS: 13,
  /** Units per cell. */
  SUB: 1000,
  TICK_MS: 16,
  /** Physics sub-steps per tick, so nothing tunnels through a brick. */
  SUB_STEPS: 4,

  BRICK_ROWS: 4,
  BRICK_TOP: 2000,
  BRICK_HEIGHT: 620,
  BRICK_PITCH: 700,

  PADDLE_WIDTH: 2400,
  PADDLE_HEIGHT: 340,
  PADDLE_TOP: 12000,
  PADDLE_SPEED: 430,

  BALL_RADIUS: 230,
  BALL_START_VX: 130,
  BALL_START_VY: -190,
  BALL_SPEEDUP: 5,
  /** Extra speed every `SPEEDUP_INTERVAL_TICKS`, so the endgame cannot drag. */
  SPEEDUP_INTERVAL_TICKS: 240,
  SPEEDUP_EXTRA: 8,
  BALL_MAX_VX: 330,
  BALL_MAX_VY: 380,
  PADDLE_MAX_VX: 300,
  /** A paddle hit always leaves at least this much sideways travel. */
  PADDLE_MIN_VX: 90,
  PADDLE_MIN_VY: 230,

  LIVES: 3,
  SERVE_TICKS: 45,
  MAX_TICKS: 24000,
  MIN_RUN_TIME_MS: 20000,
  MAX_INPUTS: 6000,
  MAX_ALLOWED_DRIFT_MS: 500,
} as const;

const {
  COLS,
  ROWS,
  SUB,
  BRICK_ROWS,
  BRICK_TOP,
  BRICK_HEIGHT,
  BRICK_PITCH,
  PADDLE_WIDTH,
  PADDLE_HEIGHT,
  PADDLE_TOP,
  BALL_RADIUS,
} = BREAKOUT_CONFIG;

export const BOARD_WIDTH = COLS * SUB;
export const BOARD_HEIGHT = ROWS * SUB;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function brickTop(row: number): number {
  return BRICK_TOP + row * BRICK_PITCH;
}

export function brickIndex(row: number, col: number): number {
  return row * COLS + col;
}

/** Hit points for a seeded layout: hard rows up top, single-hit rows below. */
function buildBricks(seed: string): number[] {
  const bricks: number[] = [];
  for (let i = 0; i < COLS * BRICK_ROWS; i++) bricks.push(0);
  const rng = createPRNG(`${seed}:bricks`);

  for (let row = 0; row < BRICK_ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      // A couple of seeded gaps keep the ball moving through the wall.
      if (row >= BRICK_ROWS - 2 && randomInt(rng, 0, 9) === 0) continue;
      const tough = row < 2 ? randomInt(rng, 0, 1) === 0 : false;
      bricks[brickIndex(row, col)] = tough ? 2 : 1;
    }
  }

  // Never ship a wall that is already cleared.
  if (!bricks.some((hp) => hp > 0)) {
    bricks[brickIndex(0, Math.floor(COLS / 2))] = 1;
  }

  return bricks;
}

function startBall(paddleX: number, seed: string): Ball {
  const rng = createPRNG(`${seed}:serve`);
  const side = randomInt(rng, 0, 1) === 0 ? -1 : 1;
  return {
    x: paddleX + PADDLE_WIDTH / 2,
    y: PADDLE_TOP - BALL_RADIUS - 4,
    vx: side * BREAKOUT_CONFIG.BALL_START_VX,
    vy: BREAKOUT_CONFIG.BALL_START_VY,
  };
}

function initialPaddle(): number {
  return Math.round((BOARD_WIDTH - PADDLE_WIDTH) / 2);
}

export class BreakoutGameEngine
  implements GameEngine<BreakoutAction, BreakoutState, BreakoutSummary>
{
  readonly gameId = "breakout";
  readonly name = "Breakout Sprint";
  readonly description =
    "Clear a seeded brick wall with one ball and three lives. Faster clears rank higher.";
  readonly targetDescription = "Break every brick";

  init(seed: string): BreakoutState {
    const bricks = buildBricks(seed);
    const paddleX = initialPaddle();
    return {
      seed,
      tickMs: BREAKOUT_CONFIG.TICK_MS,
      tickCount: 0,
      status: "READY",
      paddleX,
      paddleVelocity: 0,
      paddleTarget: null,
      ball: startBall(paddleX, seed),
      bricks,
      bricksLeft: bricks.filter((hp) => hp > 0).length,
      bricksBroken: 0,
      paddleHits: 0,
      lives: BREAKOUT_CONFIG.LIVES,
      serveTicks: BREAKOUT_CONFIG.SERVE_TICKS,
      lastEvent: "none",
      eventTick: 0,
    };
  }

  /** Applies one player action to the paddle. */
  private applyAction(
    state: BreakoutState,
    action: BreakoutAction | undefined
  ): { paddleX: number; velocity: number; target: number | null } {
    let paddleX = state.paddleX;
    let velocity = 0;
    let target = state.paddleTarget;

    if (!action) {
      target = null;
    } else if (action.type === "AIM") {
      target = clamp(
        Math.round(action.x) - PADDLE_WIDTH / 2,
        0,
        BOARD_WIDTH - PADDLE_WIDTH
      );
    } else if (action.type === "MOVE") {
      target = null;
      if (action.dir === "LEFT") velocity = -1;
      else if (action.dir === "RIGHT") velocity = 1;
    }

    if (velocity !== 0) {
      paddleX = clamp(
        paddleX + velocity * BREAKOUT_CONFIG.PADDLE_SPEED,
        0,
        BOARD_WIDTH - PADDLE_WIDTH
      );
    } else if (target !== null) {
      const delta = target - paddleX;
      const step = BREAKOUT_CONFIG.PADDLE_SPEED;
      paddleX = clamp(
        Math.abs(delta) <= step ? target : paddleX + Math.sign(delta) * step,
        0,
        BOARD_WIDTH - PADDLE_WIDTH
      );
    }

    return { paddleX, velocity, target };
  }

  /**
   * Resolves the ball against bricks, walls and the paddle for one sub-step.
   * Returns the most interesting event so the client can react (sound, sparks).
   */
  private resolve(
    state: BreakoutState
  ): { event: BreakoutEvent; lost: boolean } {
    const ball = state.ball;
    const radius = BALL_RADIUS;
    let event: BreakoutEvent = "none";

    // Walls: top and both sides.
    if (ball.x - radius < 0) {
      ball.x = radius;
      ball.vx = Math.abs(ball.vx);
      event = "wall";
    } else if (ball.x + radius > BOARD_WIDTH) {
      ball.x = BOARD_WIDTH - radius;
      ball.vx = -Math.abs(ball.vx);
      event = "wall";
    }

    if (ball.y - radius < 0) {
      ball.y = radius;
      ball.vy = Math.abs(ball.vy);
      event = "wall";
    }

    // Bricks. Collision uses the ball's centre so a brick row can be thinner
    // than the ball without the ball ever getting wedged between two rows.
    // At most one brick per sub-step keeps the bounce predictable.
    const centreX = ball.x;
    const centreY = ball.y;

    for (let row = 0; row < BRICK_ROWS; row++) {
      const bTop = brickTop(row);
      const bBottom = bTop + BRICK_HEIGHT;
      if (centreY < bTop || centreY >= bBottom) continue;

      const col = clamp(Math.floor(centreX / SUB), 0, COLS - 1);
      const index = brickIndex(row, col);
      if (state.bricks[index] <= 0) continue;

      const bLeft = col * SUB;
      const bRight = bLeft + SUB;

      const distanceLeft = centreX - bLeft;
      const distanceRight = bRight - centreX;
      const distanceTop = centreY - bTop;
      const distanceBottom = bBottom - centreY;
      const minDistance = Math.min(
        distanceLeft,
        distanceRight,
        distanceTop,
        distanceBottom
      );

      if (minDistance === distanceLeft) {
        ball.x = bLeft - 1;
        ball.vx = -Math.abs(ball.vx);
      } else if (minDistance === distanceRight) {
        ball.x = bRight + 1;
        ball.vx = Math.abs(ball.vx);
      } else if (minDistance === distanceTop) {
        ball.y = bTop - 1;
        ball.vy = -Math.abs(ball.vy);
      } else {
        ball.y = bBottom + 1;
        ball.vy = Math.abs(ball.vy);
      }

      state.bricks[index] = state.bricks[index] - 1;
      if (state.bricks[index] === 0) {
        state.bricksLeft -= 1;
        state.bricksBroken += 1;
      }

      // Every impact nudges the ball faster, with a hard cap so the run
      // stays humanly playable.
      ball.vx =
        Math.sign(ball.vx) *
        Math.min(
          Math.abs(ball.vx) + BREAKOUT_CONFIG.BALL_SPEEDUP,
          BREAKOUT_CONFIG.BALL_MAX_VX
        );
      ball.vy =
        Math.sign(ball.vy) *
        Math.min(
          Math.abs(ball.vy) + BREAKOUT_CONFIG.BALL_SPEEDUP,
          BREAKOUT_CONFIG.BALL_MAX_VY
        );

      event = "brick";
      break;
    }

    // Paddle.
    const paddleRight = state.paddleX + PADDLE_WIDTH;
    const paddleBottom = PADDLE_TOP + PADDLE_HEIGHT;
    if (
      ball.vy > 0 &&
      ball.y + radius >= PADDLE_TOP &&
      ball.y - radius <= paddleBottom &&
      ball.x + radius >= state.paddleX &&
      ball.x - radius <= paddleRight
    ) {
      ball.y = PADDLE_TOP - radius;
      const relative = clamp(
        (ball.x - (state.paddleX + PADDLE_WIDTH / 2)) / (PADDLE_WIDTH / 2),
        -1,
        1
      );
      let vx = Math.round(relative * BREAKOUT_CONFIG.PADDLE_MAX_VX);
      if (Math.abs(vx) < BREAKOUT_CONFIG.PADDLE_MIN_VX) {
        const sign = vx !== 0 ? Math.sign(vx) : ball.vx >= 0 ? 1 : -1;
        vx = sign * BREAKOUT_CONFIG.PADDLE_MIN_VX;
      }
      ball.vx = vx;
      ball.vy = -Math.max(
        BREAKOUT_CONFIG.PADDLE_MIN_VY,
        Math.abs(ball.vy)
      );
      state.paddleHits += 1;
      event = "paddle";
    }

    // Fell past the paddle.
    if (ball.y - radius > BOARD_HEIGHT) {
      return { event: "lifeLost", lost: true };
    }

    return { event, lost: false };
  }

  step(
    state: BreakoutState,
    action?: BreakoutAction
  ): BreakoutStepResult {
    if (state.status === "WON" || state.status === "LOST") {
      return {
        state,
        win: state.status === "WON",
        gameOver: state.status === "LOST",
        event: state.lastEvent,
      };
    }

    // The board is frozen until the first move: the stopwatch starts then.
    if (state.status === "READY" && !action) {
      return { state, win: false, gameOver: false, event: "none" };
    }

    const next: BreakoutState = {
      ...state,
      bricks: [...state.bricks],
      ball: { ...state.ball },
      status: "RUNNING",
    };

    const applied = this.applyAction(state, action);
    next.paddleX = applied.paddleX;
    next.paddleVelocity = applied.velocity;
    next.paddleTarget = applied.target;

    let event: BreakoutEvent = "none";

    if (next.serveTicks > 0) {
      // Ball rides the paddle while the serve counts down.
      next.serveTicks -= 1;
      next.ball.x = next.paddleX + PADDLE_WIDTH / 2;
      next.ball.y = PADDLE_TOP - BALL_RADIUS - 4;
      if (next.serveTicks === 0) {
        event = "serve";
      }
      next.tickCount += 1;
      if (event !== "none") {
        next.lastEvent = event;
        next.eventTick = state.tickCount;
      }
      return { state: next, win: false, gameOver: false, event };
    }

    // Integer sub-stepping: velocity is re-read every sub-step so a bounce in
    // the middle of a tick is honoured immediately, and the remainder carries
    // so the tick distance stays exact.
    const steps = BREAKOUT_CONFIG.SUB_STEPS;
    let carryX = 0;
    let carryY = 0;
    let lost = false;

    for (let i = 0; i < steps; i++) {
      carryX += next.ball.vx;
      carryY += next.ball.vy;
      const stepX = Math.trunc(carryX / steps);
      const stepY = Math.trunc(carryY / steps);
      carryX -= stepX * steps;
      carryY -= stepY * steps;

      next.ball.x += stepX;
      next.ball.y += stepY;

      const hit = this.resolve(next);
      if (hit.event === "brick") {
        event = "brick";
      } else if (hit.event === "paddle") {
        event = "paddle";
      } else if (hit.event === "wall" && event === "none") {
        event = "wall";
      }

      if (hit.lost) {
        lost = true;
        break;
      }
    }

    next.tickCount += 1;

    // Time pressure: the ball keeps accelerating, so a defensive game still
    // ends and the last bricks cannot be farmed forever.
    if (next.tickCount % BREAKOUT_CONFIG.SPEEDUP_INTERVAL_TICKS === 0) {
      next.ball.vx =
        Math.sign(next.ball.vx) *
        Math.min(
          Math.abs(next.ball.vx) + BREAKOUT_CONFIG.SPEEDUP_EXTRA,
          BREAKOUT_CONFIG.BALL_MAX_VX
        );
      next.ball.vy =
        Math.sign(next.ball.vy) *
        Math.min(
          Math.abs(next.ball.vy) + BREAKOUT_CONFIG.SPEEDUP_EXTRA,
          BREAKOUT_CONFIG.BALL_MAX_VY
        );
    }

    if (lost) {
      next.lives -= 1;
      next.lastEvent = "lifeLost";
      next.eventTick = state.tickCount;
      if (next.lives <= 0) {
        return {
          state: {
            ...next,
            status: "LOST",
            lives: 0,
            lastEvent: "lifeLost",
          },
          win: false,
          gameOver: true,
          event: "lifeLost",
        };
      }
      next.ball = startBall(next.paddleX, `${state.seed}:${next.lives}`);
      next.serveTicks = BREAKOUT_CONFIG.SERVE_TICKS;
      return {
        state: next,
        win: false,
        gameOver: false,
        event: "lifeLost",
      };
    }

    if (next.bricksLeft === 0) {
      next.status = "WON";
      next.lastEvent = "brick";
      next.eventTick = state.tickCount;
      return { state: next, win: true, gameOver: false, event: "brick" };
    }

    if (next.tickCount >= BREAKOUT_CONFIG.MAX_TICKS) {
      next.status = "LOST";
      next.lastEvent = "timeout";
      next.eventTick = state.tickCount;
      return {
        state: next,
        win: false,
        gameOver: true,
        event: "timeout",
      };
    }

    if (event !== "none") {
      next.lastEvent = event;
      next.eventTick = state.tickCount;
    }

    return { state: next, win: false, gameOver: false, event };
  }

  verify(
    seed: string,
    inputs: TimestampedInput<BreakoutAction>[],
    claimedTimeMs: number
  ): VerificationResult<BreakoutSummary> {
    if (!claimedTimeMs || claimedTimeMs <= 0) {
      return { valid: false, reason: "Invalid claimed time" };
    }
    if (!Array.isArray(inputs) || inputs.length === 0) {
      return { valid: false, reason: "Inputs must be a non-empty array" };
    }
    if (inputs.length > BREAKOUT_CONFIG.MAX_INPUTS) {
      return { valid: false, reason: "Too many input events" };
    }
    if (claimedTimeMs < BREAKOUT_CONFIG.MIN_RUN_TIME_MS) {
      return {
        valid: false,
        reason: "Run time is below plausible human reaction speed",
      };
    }

    const ticks: number[] = [];
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      if (
        !input ||
        typeof input.t !== "number" ||
        !Number.isFinite(input.t) ||
        input.t < 0
      ) {
        return { valid: false, reason: `Invalid timestamp at input ${i + 1}` };
      }
      const action = input.action;
      if (!action || typeof action !== "object" || !("type" in action)) {
        return { valid: false, reason: `Malformed action at input ${i + 1}` };
      }
      if (action.type === "MOVE") {
        if (
          action.dir !== "LEFT" &&
          action.dir !== "RIGHT" &&
          action.dir !== "STOP"
        ) {
          return { valid: false, reason: `Unknown move at input ${i + 1}` };
        }
      } else if (action.type === "AIM") {
        if (
          typeof action.x !== "number" ||
          !Number.isFinite(action.x) ||
          action.x < 0 ||
          action.x > BOARD_WIDTH
        ) {
          return { valid: false, reason: `Invalid aim at input ${i + 1}` };
        }
      } else {
        return { valid: false, reason: `Unknown action at input ${i + 1}` };
      }

      if (i > 0 && input.t < inputs[i - 1].t) {
        return { valid: false, reason: "Timestamps must be non-decreasing" };
      }

      const tick =
        input.tick !== undefined
          ? input.tick
          : Math.round(input.t / BREAKOUT_CONFIG.TICK_MS);
      if (!Number.isInteger(tick) || tick < 0) {
        return { valid: false, reason: `Invalid tick at input ${i + 1}` };
      }
      if (i > 0 && tick < ticks[i - 1]) {
        return { valid: false, reason: "Tick order must be non-decreasing" };
      }
      if (i > 0 && tick === ticks[i - 1]) {
        return { valid: false, reason: "Only one input is allowed per tick" };
      }
      ticks.push(tick);
    }

    if (ticks[0] !== 0) {
      return { valid: false, reason: "Run must start at tick 0" };
    }

    let state = this.init(seed);
    let inputIndex = 0;
    // Actions are sticky: the paddle keeps the last instruction until a new one
    // arrives, which is exactly what held keys and pointer drags produce.
    let current: BreakoutAction | undefined;

    while (state.tickCount < BREAKOUT_CONFIG.MAX_TICKS) {
      while (
        inputIndex < inputs.length &&
        ticks[inputIndex] === state.tickCount
      ) {
        current = inputs[inputIndex].action;
        inputIndex += 1;
      }
      if (
        inputIndex < inputs.length &&
        ticks[inputIndex] < state.tickCount
      ) {
        return { valid: false, reason: "Input tick is in the past" };
      }

      const result = this.step(state, current);
      state = result.state;

      if (result.gameOver) {
        return {
          valid: false,
          reason: `Run ended at tick ${state.tickCount} (${result.event})`,
        };
      }

      if (result.win) {
        const simulatedTimeMs = state.tickCount * state.tickMs;
        const drift = Math.abs(claimedTimeMs - simulatedTimeMs);
        if (drift > BREAKOUT_CONFIG.MAX_ALLOWED_DRIFT_MS) {
          return {
            valid: false,
            reason: `Claimed time (${claimedTimeMs}ms) drifted excessively from simulated time (${simulatedTimeMs}ms)`,
          };
        }
        return {
          valid: true,
          verifiedTimeMs: simulatedTimeMs,
          summary: {
            ticks: state.tickCount,
            bricksBroken: state.bricksBroken,
            bricksTotal: state.bricksBroken + state.bricksLeft,
            livesLeft: state.lives,
            paddleHits: state.paddleHits,
          },
        };
      }

    }

    return {
      valid: false,
      reason: `Only ${state.bricksBroken} of ${
        state.bricksBroken + state.bricksLeft
      } bricks broken`,
    };
  }
}
