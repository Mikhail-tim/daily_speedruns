import { hashString, nextRandomInt } from "../prng.js";
import {
  GameEngine,
  TimestampedInput,
  VerificationResult,
} from "../types.js";

export type SnakeDirection = "UP" | "DOWN" | "LEFT" | "RIGHT";

export interface Point {
  x: number;
  y: number;
}

export interface SnakeState {
  gridSize: number;
  targetLength: number;
  tickMs: number;
  body: Point[];
  direction: SnakeDirection;
  nextDirection: SnakeDirection;
  food: Point;
  foodCount: number;
  isWin: boolean;
  isGameOver: boolean;
  tickCount: number;
  rngState: number;
}

export interface SnakeSummary {
  ticks: number;
  finalLength: number;
  applesEaten: number;
}

export const SNAKE_CONFIG = {
  GRID_SIZE: 20,
  TARGET_LENGTH: 20,
  START_LENGTH: 3,
  TICK_MS: 80, // 12.5 ticks per second (snappy & responsive)
  MAX_ALLOWED_DRIFT_MS: 500,
};

export const OPPOSITE_DIRECTIONS: Record<SnakeDirection, SnakeDirection> = {
  UP: "DOWN",
  DOWN: "UP",
  LEFT: "RIGHT",
  RIGHT: "LEFT",
};

export const DIRECTION_DELTAS: Record<SnakeDirection, Point> = {
  UP: { x: 0, y: -1 },
  DOWN: { x: 0, y: 1 },
  LEFT: { x: -1, y: 0 },
  RIGHT: { x: 1, y: 0 },
};

/**
 * Spawns the next food on an unoccupied cell deterministically using pure state.
 */
export function spawnFood(
  rngState: number,
  gridSize: number,
  body: Point[]
): { food: Point; nextRngState: number } {
  const occupied = new Set<string>();
  for (const seg of body) {
    occupied.add(`${seg.x},${seg.y}`);
  }

  const freeCells: Point[] = [];
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      if (!occupied.has(`${x},${y}`)) {
        freeCells.push({ x, y });
      }
    }
  }

  if (freeCells.length === 0) {
    return { food: { x: 0, y: 0 }, nextRngState: rngState };
  }

  const { value: index, nextState } = nextRandomInt(
    rngState,
    0,
    freeCells.length - 1
  );
  return { food: freeCells[index], nextRngState: nextState };
}

export class SnakeGameEngine
  implements GameEngine<SnakeDirection, SnakeState, SnakeSummary>
{
  readonly gameId = "snake";
  readonly name = "Snake Sprint";
  readonly description = "Navigate the grid, collect apples, and reach length 20 as fast as possible.";
  readonly targetDescription = "Reach length 20";

  init(seed: string): SnakeState {
    const initialRngState = hashString(seed);
    const gridSize = SNAKE_CONFIG.GRID_SIZE;

    // Start in the center, facing right
    const centerY = Math.floor(gridSize / 2);
    const startX = Math.floor(gridSize / 4);

    const body: Point[] = [
      { x: startX + 2, y: centerY },
      { x: startX + 1, y: centerY },
      { x: startX, y: centerY },
    ];

    const { food, nextRngState } = spawnFood(initialRngState, gridSize, body);

    return {
      gridSize,
      targetLength: SNAKE_CONFIG.TARGET_LENGTH,
      tickMs: SNAKE_CONFIG.TICK_MS,
      body,
      direction: "RIGHT",
      nextDirection: "RIGHT",
      food,
      foodCount: 0,
      isWin: false,
      isGameOver: false,
      tickCount: 0,
      rngState: nextRngState,
    };
  }

  setDirection(state: SnakeState, newDir: SnakeDirection): SnakeState {
    if (newDir !== OPPOSITE_DIRECTIONS[state.direction]) {
      return {
        ...state,
        nextDirection: newDir,
      };
    }
    return state;
  }

  step(
    state: SnakeState,
    action?: SnakeDirection
  ): { state: SnakeState; win: boolean; gameOver: boolean } {
    if (state.isGameOver || state.isWin) {
      return { state, win: state.isWin, gameOver: state.isGameOver };
    }

    let dir = state.nextDirection;
    if (action && action !== OPPOSITE_DIRECTIONS[state.direction]) {
      dir = action;
    }

    const delta = DIRECTION_DELTAS[dir];
    const head = state.body[0];
    const newHead: Point = { x: head.x + delta.x, y: head.y + delta.y };

    // Wall collision
    if (
      newHead.x < 0 ||
      newHead.x >= state.gridSize ||
      newHead.y < 0 ||
      newHead.y >= state.gridSize
    ) {
      const nextState: SnakeState = {
        ...state,
        direction: dir,
        nextDirection: dir,
        isGameOver: true,
        tickCount: state.tickCount + 1,
      };
      return { state: nextState, win: false, gameOver: true };
    }

    // Food check
    const ateFood = newHead.x === state.food.x && newHead.y === state.food.y;

    // Self collision
    // If not eating food, tail will pop off, so colliding with current tail is safe
    const bodyToCheck = ateFood
      ? state.body
      : state.body.slice(0, state.body.length - 1);

    const hitSelf = bodyToCheck.some(
      (seg) => seg.x === newHead.x && seg.y === newHead.y
    );

    if (hitSelf) {
      const nextState: SnakeState = {
        ...state,
        direction: dir,
        nextDirection: dir,
        isGameOver: true,
        tickCount: state.tickCount + 1,
      };
      return { state: nextState, win: false, gameOver: true };
    }

    const newBody = [newHead, ...state.body];
    let newFood = state.food;
    let nextRng = state.rngState;
    let newFoodCount = state.foodCount;
    let isWin = false;

    if (ateFood) {
      newFoodCount++;
      if (newBody.length >= state.targetLength) {
        isWin = true;
      } else {
        const spawned = spawnFood(state.rngState, state.gridSize, newBody);
        newFood = spawned.food;
        nextRng = spawned.nextRngState;
      }
    } else {
      newBody.pop();
    }

    const nextState: SnakeState = {
      ...state,
      body: newBody,
      direction: dir,
      nextDirection: dir,
      food: newFood,
      foodCount: newFoodCount,
      isWin,
      isGameOver: false,
      tickCount: state.tickCount + 1,
      rngState: nextRng,
    };

    return { state: nextState, win: isWin, gameOver: false };
  }

  verify(
    seed: string,
    inputs: TimestampedInput<SnakeDirection>[],
    claimedTimeMs: number
  ): VerificationResult<SnakeSummary> {
    if (!claimedTimeMs || claimedTimeMs <= 0) {
      return { valid: false, reason: "Invalid claimed time" };
    }

    // Input sanity checks
    if (!Array.isArray(inputs)) {
      return { valid: false, reason: "Inputs must be an array" };
    }

    for (let i = 0; i < inputs.length; i++) {
      const inp = inputs[i];
      if (typeof inp.t !== "number" || inp.t < 0) {
        return { valid: false, reason: `Invalid input timestamp at index ${i}` };
      }
      if (i > 0 && inp.t < inputs[i - 1].t) {
        return { valid: false, reason: "Inputs timestamps must be non-decreasing" };
      }
      if (!["UP", "DOWN", "LEFT", "RIGHT"].includes(inp.action)) {
        return { valid: false, reason: `Unknown action: ${inp.action}` };
      }
    }

    // Rate limit: reasonable max actions
    if (inputs.length > 2000) {
      return { valid: false, reason: "Too many input events" };
    }

    let state = this.init(seed);
    const tickMs = state.tickMs;
    let inputIdx = 0;
    const maxTicks = 5000; // 500 seconds ceiling for snake run

    let pendingDirection = state.direction;

    for (let tick = 0; tick < maxTicks; tick++) {
      const tickEndMs = (tick + 1) * tickMs;

      // Consume any inputs that occurred up to this tick interval
      while (
        inputIdx < inputs.length &&
        (inputs[inputIdx].tick !== undefined
          ? (inputs[inputIdx].tick as number) <= tick
          : inputs[inputIdx].t <= tickEndMs)
      ) {
        const inp = inputs[inputIdx];
        if (inp.action !== OPPOSITE_DIRECTIONS[state.direction]) {
          pendingDirection = inp.action;
        }
        inputIdx++;
      }

      const res = this.step(state, pendingDirection);
      state = res.state;

      if (res.gameOver) {
        return {
          valid: false,
          reason: `Crash detected at tick ${state.tickCount} (${state.tickCount * tickMs}ms)`,
        };
      }

      if (res.win) {
        const simulatedTimeMs = state.tickCount * tickMs;
        const drift = Math.abs(claimedTimeMs - simulatedTimeMs);

        if (drift > SNAKE_CONFIG.MAX_ALLOWED_DRIFT_MS) {
          return {
            valid: false,
            reason: `Claimed time (${claimedTimeMs}ms) drifted beyond allowed threshold from simulated time (${simulatedTimeMs}ms, drift=${drift}ms)`,
          };
        }

        return {
          valid: true,
          verifiedTimeMs: simulatedTimeMs,
          summary: {
            ticks: state.tickCount,
            finalLength: state.body.length,
            applesEaten: state.foodCount,
          },
        };
      }
    }

    return {
      valid: false,
      reason: `Goal (length ${state.targetLength}) not reached within maximum replay ticks`,
    };
  }
}
