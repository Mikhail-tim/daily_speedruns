import { createPRNG, randomInt } from "../prng.js";
import {
  GameEngine,
  TimestampedInput,
  VerificationResult,
} from "../types.js";

export type FrogDirection = "UP" | "DOWN" | "LEFT" | "RIGHT";
export type FrogEvent =
  | "none"
  | "roadkill"
  | "drown"
  | "edge"
  | "turtle"
  | "gator"
  | "home"
  | "blocked"
  | "timeout";

export type FrogStatus = "READY" | "RUNNING" | "WON" | "LOST";

export type VehicleKind = "bike" | "car" | "truck";
export type PlatformKind = "log" | "turtle" | "alligator";

export interface Vehicle {
  id: number;
  kind: VehicleKind;
  /** Left edge in sub-cells. */
  x: number;
  length: number;
  speed: number;
}

export interface RoadLane {
  row: number;
  direction: 1 | -1;
  speed: number;
  laneLength: number;
  vehicles: Vehicle[];
}

export interface Platform {
  id: number;
  kind: PlatformKind;
  /** Left edge in sub-cells. */
  x: number;
  length: number;
  speed: number;
  /** Turtle dive-cycle offset. */
  phase: number;
  /** Alligator mouth cell index, or -1. */
  mouthCell: number;
}

export interface RiverLane {
  row: number;
  direction: 1 | -1;
  speed: number;
  laneLength: number;
  platforms: Platform[];
}

export interface FrogPlayer {
  /** Left edge in sub-cells. Grid cells are exact multiples of SUB. */
  x: number;
  y: number;
  facing: FrogDirection;
  cooldown: number;
  ridingPlatformId: number | null;
}

export interface FrogState {
  seed: string;
  tickMs: number;
  tickCount: number;
  status: FrogStatus;
  player: FrogPlayer;
  roadLanes: RoadLane[];
  riverLanes: RiverLane[];
  homes: boolean[];
  homesFilled: number;
  lives: number;
  deaths: number;
  hops: number;
  respawnTicks: number;
  respawnX: number;
  respawnY: number;
  lastEvent: FrogEvent;
  eventTick: number;
}

export interface FrogSummary {
  ticks: number;
  homesFilled: number;
  deaths: number;
  livesLeft: number;
  hops: number;
}

export interface FrogStepResult {
  state: FrogState;
  win: boolean;
  gameOver: boolean;
  event: FrogEvent;
  moved: boolean;
}

export const FROG_CONFIG = {
  COLS: 13,
  ROWS: 13,
  SUB: 1000,
  TICK_MS: 20,
  HOP_TICKS: 5,
  START_COL: 6,
  MEDIAN_ROW: 6,
  HOME_ROW: 12,
  HOME_COLS: [1, 3, 6, 9, 11] as const,
  /** Fraction of a cell trimmed from each side of the frog's hit box. */
  FROG_HIT_INSET: 0.16,
  /** Fraction of a cell trimmed from each end of a vehicle's hit box. */
  VEHICLE_HIT_INSET: 0.12,
  /** Extra reach (in cells) the frog gets at either end of a platform. */
  PLATFORM_GRACE: 0.28,
  LIVES: 5,
  RESPAWN_TICKS: 20,
  MAX_TICKS: 9000,
  MIN_RUN_TIME_MS: 8000,
  MAX_INPUTS: 5000,
  MAX_ALLOWED_DRIFT_MS: 500,
  TURTLE_PERIOD: 240,
  TURTLE_WARNING: 170,
  TURTLE_DOWN: 205,
} as const;

const { COLS, SUB, HOME_ROW, MEDIAN_ROW, HOME_COLS } = FROG_CONFIG;
const BOARD_WIDTH = COLS * SUB;
const DIRECTION_DELTAS: Record<
  FrogDirection,
  { x: number; y: number }
> = {
  // Row 0 is the start bank and row 12 is the home row, so UP increases y.
  UP: { x: 0, y: 1 },
  DOWN: { x: 0, y: -1 },
  LEFT: { x: -SUB, y: 0 },
  RIGHT: { x: SUB, y: 0 },
};

interface RoadSpec {
  row: number;
  direction: 1 | -1;
  speed: [number, number];
  gap: [number, number];
  kinds: VehicleKind[];
}

interface RiverSpec {
  row: number;
  direction: 1 | -1;
  kind: "log" | "turtle";
  speed: [number, number];
  length: [number, number];
  gap: [number, number];
}

const ROAD_SPECS: RoadSpec[] = [
  { row: 1, direction: 1, speed: [40, 58], gap: [3, 6], kinds: ["bike", "car", "car", "truck"] },
  { row: 2, direction: -1, speed: [50, 70], gap: [3, 5], kinds: ["car", "truck", "car"] },
  { row: 3, direction: 1, speed: [62, 84], gap: [2, 5], kinds: ["car", "car", "bike"] },
  { row: 4, direction: -1, speed: [48, 66], gap: [3, 6], kinds: ["truck", "car", "bike"] },
  { row: 5, direction: 1, speed: [80, 105], gap: [2, 4], kinds: ["car", "truck"] },
];

const RIVER_SPECS: RiverSpec[] = [
  { row: 7, direction: 1, kind: "log", speed: [20, 32], length: [4, 6], gap: [1, 1] },
  { row: 8, direction: -1, kind: "turtle", speed: [24, 38], length: [3, 4], gap: [1, 1] },
  { row: 9, direction: -1, kind: "log", speed: [30, 45], length: [4, 5], gap: [1, 1] },
  { row: 10, direction: 1, kind: "turtle", speed: [28, 42], length: [3, 4], gap: [1, 1] },
  { row: 11, direction: 1, kind: "log", speed: [38, 55], length: [4, 6], gap: [1, 1] },
];

function wrap(value: number, length: number): number {
  return ((value % length) + length) % length;
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isRoadRow(row: number): boolean {
  return row >= 1 && row <= 5;
}

function isRiverRow(row: number): boolean {
  return row >= 7 && row <= 11;
}

function vehicleLength(kind: VehicleKind): number {
  return kind === "bike" ? 1 : kind === "car" ? 2 : 3;
}

/** Turtle dive phase used by both the engine and the renderer. */
export function getTurtlePhase(
  platform: Platform,
  tick: number
): "up" | "warning" | "down" {
  if (platform.kind !== "turtle") return "up";
  const phase =
    (tick + platform.phase) % FROG_CONFIG.TURTLE_PERIOD;
  if (phase >= FROG_CONFIG.TURTLE_DOWN) return "down";
  if (phase >= FROG_CONFIG.TURTLE_WARNING) return "warning";
  return "up";
}

function platformCovers(platform: Platform, x: number): boolean {
  const center = x + SUB / 2;
  const grace = FROG_CONFIG.PLATFORM_GRACE * SUB;
  return (
    center >= platform.x - grace &&
    center < platform.x + platform.length * SUB + grace
  );
}

function hitsAlligatorMouth(platform: Platform, x: number): boolean {
  if (platform.kind !== "alligator" || platform.mouthCell < 0) return false;
  const center = x + SUB / 2;
  // The mouth only bites the inner part of its cell, so brushing the very
  // leading edge of the log is survivable.
  const inset = 0.18 * SUB;
  const start = platform.x + platform.mouthCell * SUB + inset;
  return center >= start && center < start + SUB - inset * 2;
}

function buildRoadLane(seed: string, spec: RoadSpec): RoadLane {
  const rng = createPRNG(`${seed}:road:${spec.row}`);
  const speed = randomInt(rng, spec.speed[0], spec.speed[1]);
  const laneLength = (COLS + 4) * SUB;
  const vehicles: Vehicle[] = [];
  let cursor = randomInt(rng, 1, 2) * SUB;
  let id = 0;

  while (cursor < laneLength - 4 * SUB) {
    const kind = spec.kinds[randomInt(rng, 0, spec.kinds.length - 1)];
    const length = vehicleLength(kind);
    const gap = randomInt(rng, spec.gap[0], spec.gap[1]) * SUB;
    vehicles.push({ id: spec.row * 100 + id++, kind, x: cursor, length, speed });
    cursor += length * SUB + gap;
  }

  if (vehicles.length > 1) {
    const last = vehicles[vehicles.length - 1];
    const wrapGap =
      laneLength - (last.x + last.length * SUB) + vehicles[0].x;
    if (wrapGap < 2 * SUB) vehicles.pop();
  }

  if (vehicles.length === 0) {
    vehicles.push({
      id: spec.row * 100,
      kind: "car",
      x: 4 * SUB,
      length: 2,
      speed,
    });
  }

  return { row: spec.row, direction: spec.direction, speed, laneLength, vehicles };
}

function buildRiverLane(seed: string, spec: RiverSpec): RiverLane {
  const rng = createPRNG(`${seed}:river:${spec.row}`);
  const speed = randomInt(rng, spec.speed[0], spec.speed[1]);
  const laneLength = (COLS + 6) * SUB;
  const platforms: Platform[] = [];
  let cursor = randomInt(rng, 0, 2) * SUB;
  let id = 0;

  while (cursor < laneLength - 3 * SUB) {
    const length = randomInt(rng, spec.length[0], spec.length[1]);
    const gap = randomInt(rng, spec.gap[0], spec.gap[1]) * SUB;
    platforms.push({
      id: spec.row * 100 + id++,
      kind: spec.kind,
      x: cursor,
      length,
      speed,
      phase:
        spec.kind === "turtle"
          ? randomInt(rng, 0, FROG_CONFIG.TURTLE_PERIOD - 1)
          : 0,
      mouthCell: -1,
    });
    cursor += length * SUB + gap;
  }

  if (platforms.length > 1) {
    const last = platforms[platforms.length - 1];
    const wrapGap =
      laneLength - (last.x + last.length * SUB) + platforms[0].x;
    if (wrapGap < 1 * SUB) platforms.pop();
  }

  if (platforms.length === 0) {
    platforms.push({
      id: spec.row * 100,
      kind: spec.kind,
      x: 4 * SUB,
      length: spec.length[0],
      speed,
      phase: 0,
      mouthCell: -1,
    });
  }

  return { row: spec.row, direction: spec.direction, speed, laneLength, platforms };
}

/**
 * Exactly one alligator log per river, with the mouth at the leading edge.
 */
function addAlligator(riverLanes: RiverLane[], seed: string): RiverLane[] {
  const rng = createPRNG(`${seed}:alligator`);
  const candidates: Array<{ lane: RiverLane; platform: Platform }> = [];
  for (const lane of riverLanes) {
    if (lane.direction !== 1) continue;
    for (const platform of lane.platforms) {
      if (platform.kind === "log" && platform.length >= 2) {
        candidates.push({ lane, platform });
      }
    }
  }
  if (candidates.length === 0) return riverLanes;

  const choice = candidates[randomInt(rng, 0, candidates.length - 1)];
  const platform = choice.platform;
  platform.kind = "alligator";
  platform.mouthCell = platform.length - 1;

  return riverLanes;
}

function initialPlayer(): FrogPlayer {
  return {
    x: FROG_CONFIG.START_COL * SUB,
    y: 0,
    facing: "UP",
    cooldown: 0,
    ridingPlatformId: null,
  };
}

function findPlatform(
  lane: RiverLane,
  x: number
): Platform | undefined {
  return lane.platforms.find((platform) => platformCovers(platform, x));
}

function spansOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function vehicleHitsFrog(
  vehicle: Vehicle,
  lane: RoadLane,
  frogStart: number,
  frogEnd: number
): boolean {
  // Both boxes are trimmed so the frog only dies on real contact, not when it
  // is merely next to a sprite.
  const inset = FROG_CONFIG.VEHICLE_HIT_INSET * SUB;
  const newStart = vehicle.x + inset;
  const newEnd = vehicle.x + vehicle.length * SUB - inset;
  const oldX = wrap(
    vehicle.x - lane.direction * lane.speed,
    lane.laneLength
  );
  const oldStart = wrap(oldX + inset, lane.laneLength);
  const oldEnd = oldX + vehicle.length * SUB - inset;

  const wrapped =
    lane.direction === 1 ? oldX > vehicle.x : oldX < vehicle.x;

  if (!wrapped) {
    return spansOverlap(
      Math.min(oldStart, newStart),
      Math.max(oldEnd, newEnd),
      frogStart,
      frogEnd
    );
  }

  if (lane.direction === 1) {
    return (
      spansOverlap(oldStart, lane.laneLength, frogStart, frogEnd) ||
      spansOverlap(0, newEnd, frogStart, frogEnd)
    );
  }

  return (
    spansOverlap(0, oldEnd, frogStart, frogEnd) ||
    spansOverlap(newStart, lane.laneLength, frogStart, frogEnd)
  );
}

export class FrogGameEngine
  implements GameEngine<FrogDirection, FrogState, FrogSummary>
{
  readonly gameId = "frog";
  readonly name = "Frog Cross: River Run";
  readonly description =
    "Hop a neon frog across five lanes of night traffic, ride the river, and fill all five homes.";
  readonly targetDescription = "Fill all 5 homes";

  init(seed: string): FrogState {
    const roadLanes = ROAD_SPECS.map((spec) => buildRoadLane(seed, spec));
    const riverLanes = addAlligator(
      RIVER_SPECS.map((spec) => buildRiverLane(seed, spec)),
      seed
    );

    return {
      seed,
      tickMs: FROG_CONFIG.TICK_MS,
      tickCount: 0,
      status: "READY",
      player: initialPlayer(),
      roadLanes,
      riverLanes,
      homes: new Array<boolean>(HOME_COLS.length).fill(false),
      homesFilled: 0,
      lives: FROG_CONFIG.LIVES,
      deaths: 0,
      hops: 0,
      respawnTicks: 0,
      respawnX: FROG_CONFIG.START_COL * SUB,
      respawnY: 0,
      lastEvent: "none",
      eventTick: 0,
    };
  }

  private advanceWorld(state: FrogState): FrogState {
    const roadLanes = state.roadLanes.map((lane) => ({
      ...lane,
      vehicles: lane.vehicles.map((vehicle) => ({
        ...vehicle,
        x: wrap(
          vehicle.x + lane.direction * lane.speed,
          lane.laneLength
        ),
      })),
    }));

    const riverLanes = state.riverLanes.map((lane) => ({
      ...lane,
      platforms: lane.platforms.map((platform) => ({
        ...platform,
        x: wrap(
          platform.x + lane.direction * lane.speed,
          lane.laneLength
        ),
      })),
    }));

    return { ...state, roadLanes, riverLanes };
  }

  private die(
    state: FrogState,
    event: FrogEvent
  ): FrogState {
    const lives = state.lives - 1;
    const riverDeath =
      state.player.y >= 7 && state.player.y <= 11;
    const respawnX = riverDeath
      ? Math.max(
          0,
          Math.min(
            COLS - 1,
            Math.floor((state.player.x + SUB / 2) / SUB)
          )
        ) * SUB
      : FROG_CONFIG.START_COL * SUB;
    const respawnY = riverDeath ? MEDIAN_ROW : 0;
    const next: FrogState = {
      ...state,
      lives: Math.max(0, lives),
      deaths: state.deaths + 1,
      lastEvent: event,
      eventTick: state.tickCount,
      respawnX,
      respawnY,
      player: { ...state.player, ridingPlatformId: null },
    };

    if (lives <= 0) {
      return { ...next, status: "LOST", respawnTicks: 0 };
    }

    return {
      ...next,
      status: "RUNNING",
      respawnTicks: FROG_CONFIG.RESPAWN_TICKS,
    };
  }

  private sideCollision(state: FrogState): boolean {
    const { player } = state;
    if (!isRoadRow(player.y)) return false;

    const lane = state.roadLanes.find((entry) => entry.row === player.y);
    if (!lane) return false;

    const frogStart = player.x + FROG_CONFIG.FROG_HIT_INSET * SUB;
    const frogEnd = player.x + SUB - FROG_CONFIG.FROG_HIT_INSET * SUB;
    return lane.vehicles.some((vehicle) =>
      vehicleHitsFrog(vehicle, lane, frogStart, frogEnd)
    );
  }

  private riverHazard(
    state: FrogState
  ): { platform?: Platform; event?: FrogEvent } {
    const { player } = state;
    if (!isRiverRow(player.y)) return {};

    const lane = state.riverLanes.find((entry) => entry.row === player.y);
    if (!lane) return { event: "drown" };

    const platform =
      player.ridingPlatformId !== null
        ? lane.platforms.find(
            (entry) => entry.id === player.ridingPlatformId
          )
        : findPlatform(lane, player.x);

    if (!platform || !platformCovers(platform, player.x)) {
      return { event: "drown" };
    }
    if (getTurtlePhase(platform, state.tickCount) === "down") {
      return { event: "turtle" };
    }
    if (hitsAlligatorMouth(platform, player.x)) {
      return { event: "gator" };
    }

    return { platform };
  }

  private checkEdge(state: FrogState): boolean {
    const center = state.player.x + SUB / 2;
    return center < 0 || center >= BOARD_WIDTH;
  }

  private resetToStart(state: FrogState): FrogState {
    return {
      ...state,
      player: {
        ...initialPlayer(),
        x: state.respawnX,
        y: state.respawnY,
      },
      respawnTicks: 0,
    };
  }

  step(
    state: FrogState,
    action?: FrogDirection
  ): FrogStepResult {
    if (state.status === "WON" || state.status === "LOST") {
      return {
        state,
        win: state.status === "WON",
        gameOver: state.status === "LOST",
        event: state.lastEvent,
        moved: false,
      };
    }

    // The board is frozen until the first input.
    if (state.status === "READY" && !action) {
      return {
        state,
        win: false,
        gameOver: false,
        event: "none",
        moved: false,
      };
    }

    let next = this.advanceWorld(state);

    // A respawn is a short freeze; the world keeps moving.
    if (next.respawnTicks > 0) {
      const respawnTicks = next.respawnTicks - 1;
      next = {
        ...next,
        respawnTicks,
        tickCount: next.tickCount + 1,
      };
      if (respawnTicks === 0 && next.lives > 0) {
        next = this.resetToStart(next);
      }
      return {
        state: next,
        win: false,
        gameOver: next.status === "LOST",
        event: "none",
        moved: false,
      };
    }

    let player: FrogPlayer = {
      ...next.player,
      cooldown: Math.max(0, next.player.cooldown - 1),
    };
    let moved = false;
    let stepEvent: FrogEvent = "none";
    let died = false;
    const wasRiding = next.player.ridingPlatformId !== null;
    let justHopped = false;

    if (action && player.cooldown === 0) {
      next = { ...next, status: "RUNNING" };
      player = { ...player, facing: action, cooldown: FROG_CONFIG.HOP_TICKS };
      const delta = DIRECTION_DELTAS[action];
      const targetY = player.y + delta.y;
      const targetX = player.x + delta.x;

      if (targetY === HOME_ROW) {
        const targetCol = Math.floor((targetX + SUB / 2) / SUB);
        const homeIndex = HOME_COLS.indexOf(
          targetCol as (typeof HOME_COLS)[number]
        );
        if (homeIndex >= 0 && !next.homes[homeIndex]) {
          const homes = [...next.homes];
          homes[homeIndex] = true;
          const homesFilled = next.homesFilled + 1;
          const isWin = homesFilled >= HOME_COLS.length;
          next = {
            ...next,
            homes,
            homesFilled,
            hops: next.hops + 1,
            lastEvent: "home",
            eventTick: next.tickCount,
            respawnX: FROG_CONFIG.START_COL * SUB,
            respawnY: 0,
            status: isWin ? "WON" : "RUNNING",
            player: isWin
              ? { ...player, x: targetX, y: targetY, ridingPlatformId: null }
              : initialPlayer(),
          };
          return {
            state: {
              ...next,
              tickCount: next.tickCount + 1,
            },
            win: isWin,
            gameOver: false,
            event: "home",
            moved: true,
          };
        }

        stepEvent = "blocked";
        next = { ...next, lastEvent: stepEvent, eventTick: next.tickCount };
      } else if (
        targetY < 0 ||
        targetY > HOME_ROW ||
        targetX < 0 ||
        targetX + SUB > BOARD_WIDTH
      ) {
        stepEvent = "blocked";
      } else {
        const snappedX = isRiverRow(targetY)
          ? targetX
          : Math.round(targetX / SUB) * SUB;
        player = {
          ...player,
          x: snappedX,
          y: targetY,
          ridingPlatformId: null,
        };
        moved = true;
        justHopped = true;
      }
    }

    next = { ...next, player };
    if (moved) {
      next = { ...next, hops: next.hops + 1 };
    }

    // Carry a frog that was already riding a platform.
    if (
      wasRiding &&
      !justHopped &&
      isRiverRow(next.player.y) &&
      next.player.ridingPlatformId !== null
    ) {
      const lane = next.riverLanes.find(
        (entry) => entry.row === next.player.y
      );
      if (lane) {
        next = {
          ...next,
          player: {
            ...next.player,
            x: next.player.x + lane.direction * lane.speed,
          },
        };
      }
    }

    // River checks: platform coverage, turtle dive, alligator mouth.
    if (isRiverRow(next.player.y)) {
      const hazard = this.riverHazard(next);
      if (hazard.event) {
        next = this.die(next, hazard.event);
        stepEvent = hazard.event;
        died = true;
      } else if (hazard.platform) {
        next = {
          ...next,
          player: {
            ...next.player,
            ridingPlatformId: hazard.platform.id,
          },
        };
      }
    } else {
      next = {
        ...next,
        player: { ...next.player, ridingPlatformId: null },
      };
    }

    // Edge of the screen.
    if (!died && this.checkEdge(next)) {
      next = this.die(next, "edge");
      stepEvent = "edge";
      died = true;
    }

    // Road collision.
    if (!died && this.sideCollision(next)) {
      next = this.die(next, "roadkill");
      stepEvent = "roadkill";
      died = true;
    }

    // Timeout.
    const tickCount = next.tickCount + 1;
    if (
      next.status !== "WON" &&
      next.status !== "LOST" &&
      tickCount >= FROG_CONFIG.MAX_TICKS
    ) {
      next = {
        ...this.die(next, "timeout"),
        status: "LOST",
        respawnTicks: 0,
      };
      stepEvent = "timeout";
      died = true;
    }

    next = { ...next, tickCount };

    if (!died && stepEvent !== "none") {
      next = {
        ...next,
        lastEvent: stepEvent,
        eventTick: state.tickCount,
      };
    }

    return {
      state: next,
      win: next.status === "WON",
      gameOver: next.status === "LOST",
      event: stepEvent,
      moved,
    };
  }

  verify(
    seed: string,
    inputs: TimestampedInput<FrogDirection>[],
    claimedTimeMs: number
  ): VerificationResult<FrogSummary> {
    if (!claimedTimeMs || claimedTimeMs <= 0) {
      return { valid: false, reason: "Invalid claimed time" };
    }
    if (!Array.isArray(inputs) || inputs.length === 0) {
      return { valid: false, reason: "Inputs must be a non-empty array" };
    }
    if (inputs.length > FROG_CONFIG.MAX_INPUTS) {
      return { valid: false, reason: "Too many input events" };
    }
    if (claimedTimeMs < FROG_CONFIG.MIN_RUN_TIME_MS) {
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
      if (
        !["UP", "DOWN", "LEFT", "RIGHT"].includes(input.action)
      ) {
        return { valid: false, reason: `Unknown action at input ${i + 1}` };
      }
      if (i > 0 && input.t < inputs[i - 1].t) {
        return { valid: false, reason: "Timestamps must be non-decreasing" };
      }

      const tick =
        input.tick !== undefined
          ? input.tick
          : Math.round(input.t / FROG_CONFIG.TICK_MS);
      if (!isInteger(tick) || tick < 0) {
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

    while (state.tickCount < FROG_CONFIG.MAX_TICKS) {
      let action: FrogDirection | undefined;
      if (
        inputIndex < inputs.length &&
        ticks[inputIndex] === state.tickCount
      ) {
        action = inputs[inputIndex].action;
        inputIndex++;
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
          reason: `Run ended at tick ${state.tickCount} (${result.event})`,
        };
      }

      if (result.win) {
        const simulatedTimeMs = state.tickCount * state.tickMs;
        const drift = Math.abs(claimedTimeMs - simulatedTimeMs);
        if (drift > FROG_CONFIG.MAX_ALLOWED_DRIFT_MS) {
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
            homesFilled: state.homesFilled,
            deaths: state.deaths,
            livesLeft: state.lives,
            hops: state.hops,
          },
        };
      }

      if (inputIndex >= inputs.length) {
        return {
          valid: false,
          reason: `Only ${state.homesFilled}/${HOME_COLS.length} homes filled`,
        };
      }
    }

    return {
      valid: false,
      reason: `Only ${state.homesFilled}/${HOME_COLS.length} homes filled`,
    };
  }
}
