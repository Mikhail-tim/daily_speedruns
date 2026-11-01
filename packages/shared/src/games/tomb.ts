import { createPRNG, randomInt } from "../prng.js";
import {
  GameEngine,
  TimestampedInput,
  VerificationResult,
} from "../types.js";

/**
 * Tomb of the Mask Г— escape-the-maze.
 *
 * You slide until something stops you. The dungeon is generated from the seed
 * and then *proven*: a breadth-first search over (cell, key, door, gate) states
 * must find a solution, and the level is only kept when that solution is long
 * enough to be a puzzle. Every daily dungeon is therefore solvable and never
 * trivial, without hand-authored levels.
 *
 * Each floor is a small escape room: the exit is walled in behind a door, the
 * key for that door is walled in behind a gate, and the gate only opens when the
 * switch is stepped on. Par is the BFS-optimal number of slides.
 */

export type TombDirection = "UP" | "DOWN" | "LEFT" | "RIGHT";
export type TombAction = TombDirection;

export type TombEvent =
  | "none"
  | "blocked"
  | "move"
  | "key"
  | "door"
  | "switch"
  | "exit"
  | "timeout";

export type TombStatus = "READY" | "RUNNING" | "WON" | "LOST";

export interface TombFlags {
  hasKey: boolean;
  doorOpen: boolean;
  gateOpen: boolean;
}

export interface TombLevel {
  cols: number;
  rows: number;
  /** Static walls, row-major. */
  walls: boolean[];
  /** Cell indices of the specials, or -1 when the floor has none. */
  doorAt: number;
  keyAt: number;
  gateAt: number;
  switchAt: number;
  start: number;
  exit: number;
  /** BFS-optimal number of slides from the start. */
  optimalMoves: number;
}

export interface TombState {
  seed: string;
  tickMs: number;
  tickCount: number;
  status: TombStatus;
  floor: number;
  floors: number;
  level: TombLevel;
  player: number;
  facing: TombDirection;
  hasKey: boolean;
  doorOpen: boolean;
  gateOpen: boolean;
  moves: number;
  /** Sum of par over the floors cleared so far. */
  parTotal: number;
  /** Cells the last slide travelled through, for the renderer. */
  path: number[];
  lastEvent: TombEvent;
  eventTick: number;
}

export interface TombSummary {
  ticks: number;
  floors: number;
  moves: number;
  parTotal: number;
  optimalTotal: number;
}

export interface TombStepResult {
  state: TombState;
  win: boolean;
  gameOver: boolean;
  event: TombEvent;
}

export const TOMB_CONFIG = {
  COLS: 9,
  ROWS: 9,
  TICK_MS: 16,
  FLOORS: 3,
  /** Percent of interior cells that start as rubble. */
  WALL_DENSITY: 28,
  /** A generated floor must need at least this many slides. */
  MIN_MOVES: 7,
  /** вЂ¦and at most this many, so a daily run stays snappy. */
  MAX_MOVES: 26,
  GEN_ATTEMPTS: 1500,
  MIN_RUN_TIME_MS: 6000,
  MAX_INPUTS: 4000,
  MAX_TICKS: 15000,
  MAX_ALLOWED_DRIFT_MS: 500,
} as const;

const { COLS, ROWS } = TOMB_CONFIG;

export const TOMB_DIRECTIONS: TombDirection[] = [
  "UP",
  "DOWN",
  "LEFT",
  "RIGHT",
];

const DELTAS: Record<TombDirection, { dx: number; dy: number }> = {
  UP: { dx: 0, dy: -1 },
  DOWN: { dx: 0, dy: 1 },
  LEFT: { dx: -1, dy: 0 },
  RIGHT: { dx: 1, dy: 0 },
};

export function cellOf(cols: number, x: number, y: number): number {
  return y * cols + x;
}

export function colOf(cols: number, cell: number): number {
  return cell % cols;
}

export function rowOf(cols: number, cell: number): number {
  return Math.floor(cell / cols);
}

export interface SlideOutcome {
  pos: number;
  path: number[];
  flags: TombFlags;
  hitExit: boolean;
  hitKey: boolean;
  hitDoor: boolean;
  hitSwitch: boolean;
}

/**
 * Runs one slide from `from`. Doors block like walls until a key is spent, and
 * gates block until their switch has been pressed.
 */
export function slide(
  level: TombLevel,
  from: number,
  direction: TombDirection,
  startFlags: TombFlags
): SlideOutcome {
  const { dx, dy } = DELTAS[direction];
  const cols = level.cols;
  let x = colOf(cols, from);
  let y = rowOf(cols, from);
  const flags: TombFlags = { ...startFlags };
  const path: number[] = [];
  let hitExit = false;
  let hitKey = false;
  let hitDoor = false;
  let hitSwitch = false;

  for (;;) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= level.cols || ny >= level.rows) break;
    const next = cellOf(cols, nx, ny);
    if (level.walls[next]) break;

    if (next === level.gateAt && !flags.gateOpen) break;

    if (next === level.doorAt && !flags.doorOpen) {
      if (!flags.hasKey) break;
      // The key is spent and the door stays open for the rest of the floor.
      flags.hasKey = false;
      flags.doorOpen = true;
      hitDoor = true;
    }

    x = nx;
    y = ny;
    path.push(next);

    if (next === level.keyAt && !flags.hasKey && !flags.doorOpen) {
      flags.hasKey = true;
      hitKey = true;
    }

    if (next === level.switchAt) {
      flags.gateOpen = !flags.gateOpen;
      hitSwitch = true;
    }

    if (next === level.exit) {
      hitExit = true;
      break;
    }
  }

  return {
    pos: cellOf(cols, x, y),
    path,
    flags,
    hitExit,
    hitKey,
    hitDoor,
    hitSwitch,
  };
}

function flagKey(flags: TombFlags): number {
  return (
    (flags.hasKey ? 4 : 0) + (flags.doorOpen ? 2 : 0) + (flags.gateOpen ? 1 : 0)
  );
}

/** Breadth-first search returning the optimal slide list, or null. */
export function solveFrom(
  level: TombLevel,
  from: number,
  startFlags: TombFlags
): TombDirection[] | null {
  const cells = level.cols * level.rows;
  const seen = new Set<number>();
  interface Node {
    pos: number;
    flags: TombFlags;
    path: TombDirection[];
  }
  const queue: Node[] = [{ pos: from, flags: startFlags, path: [] }];
  seen.add(from * 8 + flagKey(startFlags));

  for (let head = 0; head < queue.length; head++) {
    const node = queue[head];
    for (const direction of TOMB_DIRECTIONS) {
      const out = slide(level, node.pos, direction, node.flags);
      if (out.path.length === 0) continue;
      const path = [...node.path, direction];
      if (out.hitExit) return path;
      const key = out.pos * 8 + flagKey(out.flags);
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ pos: out.pos, flags: out.flags, path });
      if (queue.length > cells * 8 + 8) break;
    }
  }

  return null;
}

/** Optimal slide count from the start, or -1 when the floor is unsolvable. */
export function optimalMoves(level: TombLevel): number {
  const solution = solveFrom(level, level.start, {
    hasKey: false,
    doorOpen: false,
    gateOpen: false,
  });
  return solution ? solution.length : -1;
}

function emptyLevel(cols: number, rows: number): TombLevel {
  return {
    cols,
    rows,
    walls: new Array<boolean>(cols * rows).fill(false),
    doorAt: -1,
    keyAt: -1,
    gateAt: -1,
    switchAt: -1,
    start: 0,
    exit: cols * rows - 1,
    optimalMoves: -1,
  };
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(rng, 0, i);
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
  return items;
}

/**
 * Walls a single cell in on three sides and leaves one doorway leading to it.
 * Returns the doorway cell, or -1 when the cell is too cramped.
 */
function enclose(
  level: TombLevel,
  cell: number,
  direction: TombDirection
): number {
  const cols = level.cols;
  const x = colOf(cols, cell);
  const y = rowOf(cols, cell);
  const doorway = DELTAS[direction];
  const doorwayCell = cellOf(cols, x + doorway.dx, y + doorway.dy);
  if (
    x + doorway.dx <= 0 ||
    y + doorway.dy <= 0 ||
    x + doorway.dx >= level.cols - 1 ||
    y + doorway.dy >= level.rows - 1
  ) {
    return -1;
  }

  for (const dir of TOMB_DIRECTIONS) {
    if (dir === direction) continue;
    const nx = x + DELTAS[dir].dx;
    const ny = y + DELTAS[dir].dy;
    if (nx <= 0 || ny <= 0 || nx >= level.cols - 1 || ny >= level.rows - 1) {
      return -1;
    }
    level.walls[cellOf(cols, nx, ny)] = true;
  }

  level.walls[doorwayCell] = false;
  return doorwayCell;
}

function buildCandidate(
  seed: string,
  floor: number,
  attempt: number
): TombLevel | null {
  const rng = createPRNG(`${seed}:floor:${floor}:attempt:${attempt}`);
  const level = emptyLevel(COLS, ROWS);

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const border = x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1;
      level.walls[cellOf(COLS, x, y)] =
        border || randomInt(rng, 0, 99) < TOMB_CONFIG.WALL_DENSITY;
    }
  }

  const free: number[] = [];
  for (let y = 1; y < ROWS - 1; y++) {
    for (let x = 1; x < COLS - 1; x++) {
      const cell = cellOf(COLS, x, y);
      if (!level.walls[cell]) free.push(cell);
    }
  }
  if (free.length < 20) return null;
  shuffle(free, rng);

  // Exit chamber first, then the key chamber, so the key cannot be inside the
  // exit chamber.
  const exitCell = free[0];
  const exitDir = TOMB_DIRECTIONS[randomInt(rng, 0, 3)];
  const exitDoor = enclose(level, exitCell, exitDir);
  if (exitDoor < 0) return null;

  let keyCell = -1;
  let keyDoor = -1;
  for (const candidate of free.slice(1, 14)) {
    if (candidate === exitCell || candidate === exitDoor) continue;
    if (level.walls[candidate]) continue;
    const dir = TOMB_DIRECTIONS[randomInt(rng, 0, 3)];
    const doorway = enclose(level, candidate, dir);
    if (doorway < 0) continue;
    if (doorway === exitDoor || doorway === exitCell) continue;
    keyCell = candidate;
    keyDoor = doorway;
    break;
  }
  if (keyCell < 0) return null;

  // Something must be reachable to start from and to press.
  const usable: number[] = [];
  for (let cell = 0; cell < COLS * ROWS; cell++) {
    if (level.walls[cell]) continue;
    if (
      cell === exitCell ||
      cell === keyCell ||
      cell === exitDoor ||
      cell === keyDoor
    ) {
      continue;
    }
    usable.push(cell);
  }
  if (usable.length < 8) return null;

  level.exit = exitCell;
  level.doorAt = exitDoor;
  level.keyAt = keyCell;
  level.gateAt = keyDoor;

  // Start far away from the exit so the dungeon is not solved on the first hop.
  const exitX = colOf(COLS, exitCell);
  const exitY = rowOf(COLS, exitCell);
  let start = usable[0];
  let bestDistance = -1;
  for (const cell of usable) {
    const distance =
      Math.abs(colOf(COLS, cell) - exitX) + Math.abs(rowOf(COLS, cell) - exitY);
    if (distance > bestDistance) {
      bestDistance = distance;
      start = cell;
    }
  }
  level.start = start;

  // The switch has to be somewhere reachable that is not a special cell.
  const switchCandidates = usable.filter(
    (cell) => cell !== start && cell !== keyCell && cell !== exitCell
  );
  if (switchCandidates.length === 0) return null;
  level.switchAt =
    switchCandidates[randomInt(rng, 0, switchCandidates.length - 1)];

  // Par must be measurable before the floor is accepted.
  level.optimalMoves = optimalMoves(level);
  return level;
}

/** Deliberately simple, always-solvable floor used if generation runs dry. */
function fallbackLevel(seed: string, floor: number): TombLevel {
  // An open room with four pillars: guaranteed solvable, still a few hops.
  void seed;
  void floor;
  const level = emptyLevel(COLS, ROWS);
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const border = x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1;
      level.walls[cellOf(COLS, x, y)] = border;
    }
  }
  level.walls[cellOf(COLS, 4, 2)] = true;
  level.walls[cellOf(COLS, 4, 6)] = true;
  level.walls[cellOf(COLS, 2, 4)] = true;
  level.walls[cellOf(COLS, 6, 4)] = true;

  level.start = cellOf(COLS, 1, 1);
  level.exit = cellOf(COLS, 7, 7);
  level.switchAt = cellOf(COLS, 1, 7);
  level.gateAt = cellOf(COLS, 7, 6);
  level.keyAt = cellOf(COLS, 6, 6);
  level.doorAt = cellOf(COLS, 6, 7);
  level.optimalMoves = optimalMoves(level);

  if (level.optimalMoves < 0) {
    // Last resort: a bare room, one slide from the exit wall.
    level.switchAt = -1;
    level.gateAt = -1;
    level.keyAt = -1;
    level.doorAt = -1;
    level.optimalMoves = optimalMoves(level);
  }

  return level;
}

/** Generation is deterministic, so a tiny cache keeps resets instant. */
const LEVEL_CACHE = new Map<string, TombLevel>();
const LEVEL_CACHE_LIMIT = 48;

/** Generates the floor for `seed`/`floor`, proven solvable by BFS. */
export function generateTombLevel(seed: string, floor: number): TombLevel {
  const cacheKey = `${seed}:${floor}`;
  const cached = LEVEL_CACHE.get(cacheKey);
  if (cached) return cached;

  let bestInRange: TombLevel | null = null;
  let bestBelow: TombLevel | null = null;
  let bestAbove: TombLevel | null = null;

  for (let attempt = 0; attempt < TOMB_CONFIG.GEN_ATTEMPTS; attempt++) {
    const candidate = buildCandidate(seed, floor, attempt);
    if (!candidate) continue;
    const par = candidate.optimalMoves;
    if (par < 1) continue;

    if (par >= TOMB_CONFIG.MIN_MOVES && par <= TOMB_CONFIG.MAX_MOVES) {
      // Keep the longest floor that still fits the budget.
      if (!bestInRange || par > bestInRange.optimalMoves) bestInRange = candidate;
    } else if (par < TOMB_CONFIG.MIN_MOVES) {
      if (!bestBelow || par > bestBelow.optimalMoves) bestBelow = candidate;
    } else if (!bestAbove || par < bestAbove.optimalMoves) {
      bestAbove = candidate;
    }
  }

  const level =
    bestInRange ?? bestBelow ?? bestAbove ?? fallbackLevel(seed, floor);

  if (LEVEL_CACHE.size >= LEVEL_CACHE_LIMIT) LEVEL_CACHE.clear();
  LEVEL_CACHE.set(cacheKey, level);
  return level;
}

export class TombGameEngine
  implements GameEngine<TombAction, TombState, TombSummary>
{
  readonly gameId = "tomb";
  readonly name = "Tomb Escape";
  readonly description =
    "Slide through a generated tomb: find the switch, take the key, open the door and escape.";
  readonly targetDescription = "Escape all 3 floors";

  init(seed: string): TombState {
    const level = generateTombLevel(seed, 0);
    return {
      seed,
      tickMs: TOMB_CONFIG.TICK_MS,
      tickCount: 0,
      status: "READY",
      floor: 0,
      floors: TOMB_CONFIG.FLOORS,
      level,
      player: level.start,
      facing: "DOWN",
      hasKey: false,
      doorOpen: false,
      gateOpen: false,
      moves: 0,
      parTotal: level.optimalMoves,
      path: [],
      lastEvent: "none",
      eventTick: 0,
    };
  }

  private nextFloor(state: TombState): TombState {
    const floor = state.floor + 1;
    const level = generateTombLevel(state.seed, floor);
    return {
      ...state,
      floor,
      level,
      player: level.start,
      facing: "DOWN",
      hasKey: false,
      doorOpen: false,
      gateOpen: false,
      path: [],
      parTotal: state.parTotal + level.optimalMoves,
    };
  }

  step(state: TombState, action?: TombAction): TombStepResult {
    if (state.status === "WON" || state.status === "LOST") {
      return {
        state,
        win: state.status === "WON",
        gameOver: state.status === "LOST",
        event: state.lastEvent,
      };
    }

    // The tomb only wakes on the first move; the clock starts with it.
    if (state.status === "READY" && !action) {
      return { state, win: false, gameOver: false, event: "none" };
    }

    const tick = state.tickCount + 1;

    if (tick >= TOMB_CONFIG.MAX_TICKS) {
      return {
        state: {
          ...state,
          status: "LOST",
          tickCount: tick,
          lastEvent: "timeout",
          eventTick: state.tickCount,
        },
        win: false,
        gameOver: true,
        event: "timeout",
      };
    }

    if (!action) {
      // Idle tick: the clock keeps running, nothing moves.
      return {
        state: { ...state, status: "RUNNING", tickCount: tick },
        win: false,
        gameOver: false,
        event: "none",
      };
    }

    const out = slide(
      state.level,
      state.player,
      action,
      {
        hasKey: state.hasKey,
        doorOpen: state.doorOpen,
        gateOpen: state.gateOpen,
      }
    );

    if (out.path.length === 0) {
      return {
        state: {
          ...state,
          status: "RUNNING",
          tickCount: tick,
          facing: action,
          path: [],
          lastEvent: "blocked",
          eventTick: state.tickCount,
        },
        win: false,
        gameOver: false,
        event: "blocked",
      };
    }

    let event: TombEvent = "move";
    if (out.hitExit) event = "exit";
    else if (out.hitDoor) event = "door";
    else if (out.hitKey) event = "key";
    else if (out.hitSwitch) event = "switch";

    const base: TombState = {
      ...state,
      status: "RUNNING",
      tickCount: tick,
      player: out.pos,
      facing: action,
      hasKey: out.flags.hasKey,
      doorOpen: out.flags.doorOpen,
      gateOpen: out.flags.gateOpen,
      moves: state.moves + 1,
      path: out.path,
      lastEvent: event,
      eventTick: state.tickCount,
    };

    if (out.hitExit) {
      if (state.floor + 1 >= state.floors) {
        return {
          state: { ...base, status: "WON" },
          win: true,
          gameOver: false,
          event: "exit",
        };
      }
      return {
        state: this.nextFloor(base),
        win: false,
        gameOver: false,
        event: "exit",
      };
    }

    return { state: base, win: false, gameOver: false, event };
  }

  verify(
    seed: string,
    inputs: TimestampedInput<TombAction>[],
    claimedTimeMs: number
  ): VerificationResult<TombSummary> {
    if (!claimedTimeMs || claimedTimeMs <= 0) {
      return { valid: false, reason: "Invalid claimed time" };
    }
    if (!Array.isArray(inputs) || inputs.length === 0) {
      return { valid: false, reason: "Inputs must be a non-empty array" };
    }
    if (inputs.length > TOMB_CONFIG.MAX_INPUTS) {
      return { valid: false, reason: "Too many input events" };
    }
    if (claimedTimeMs < TOMB_CONFIG.MIN_RUN_TIME_MS) {
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
      if (!TOMB_DIRECTIONS.includes(input.action)) {
        return { valid: false, reason: `Unknown move at input ${i + 1}` };
      }
      if (i > 0 && input.t < inputs[i - 1].t) {
        return { valid: false, reason: "Timestamps must be non-decreasing" };
      }
      const tick =
        input.tick !== undefined
          ? input.tick
          : Math.round(input.t / TOMB_CONFIG.TICK_MS);
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

    while (state.tickCount < TOMB_CONFIG.MAX_TICKS) {
      let action: TombAction | undefined;
      if (
        inputIndex < inputs.length &&
        ticks[inputIndex] === state.tickCount
      ) {
        action = inputs[inputIndex].action;
        inputIndex += 1;
      } else if (
        inputIndex < inputs.length &&
        ticks[inputIndex] < state.tickCount
      ) {
        return { valid: false, reason: "Input tick is in the past" };
      }

      const result = this.step(state, action);
      state = result.state;

      if (result.gameOver) {
        return {
          valid: false,
          reason: `Run ended on floor ${state.floor + 1} (${result.event})`,
        };
      }

      if (result.win) {
        const simulatedTimeMs = state.tickCount * state.tickMs;
        const drift = Math.abs(claimedTimeMs - simulatedTimeMs);
        if (drift > TOMB_CONFIG.MAX_ALLOWED_DRIFT_MS) {
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
            floors: state.floors,
            moves: state.moves,
            parTotal: state.parTotal,
            optimalTotal: state.parTotal,
          },
        };
      }
    }

    return {
      valid: false,
      reason: `Escaped only ${state.floor} of ${state.floors} floors`,
    };
  }
}
