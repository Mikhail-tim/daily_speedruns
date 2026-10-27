import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CHICKEN_CONFIG,
  ChickenDirection,
  ChickenGameEngine,
  ChickenState,
  Vehicle,
} from "./games/chicken.js";
import { TimestampedInput } from "./types.js";

const seed = "2026-10-27:chicken:v1";

function clone(state: ChickenState): ChickenState {
  return JSON.parse(JSON.stringify(state)) as ChickenState;
}

function place(
  state: ChickenState,
  x: number,
  y: number,
  ridingPlatformId: number | null = null
): ChickenState {
  const next = clone(state);
  next.player = {
    ...next.player,
    x,
    y,
    ridingPlatformId,
    cooldown: 0,
  };
  next.status = "RUNNING";
  return next;
}

/** Steps with no input for a short lookahead. */
function safeFor(
  engine: ChickenGameEngine,
  state: ChickenState,
  ticks: number
): boolean {
  let current = state;
  for (let i = 0; i < ticks; i++) {
    const result = engine.step(current);
    current = result.state;
    if (
      result.gameOver ||
      current.status === "LOST" ||
      current.respawnTicks > 0
    ) {
      return false;
    }
  }
  return true;
}

function distanceToHome(state: ChickenState): number {
  const center = state.player.x + CHICKEN_CONFIG.SUB / 2;
  let best = Number.MAX_SAFE_INTEGER;
  CHICKEN_CONFIG.HOME_COLS.forEach((col, index) => {
    if (state.homes[index]) return;
    best = Math.min(
      best,
      Math.abs(center - (col * CHICKEN_CONFIG.SUB + CHICKEN_CONFIG.SUB / 2))
    );
  });
  return best / CHICKEN_CONFIG.SUB;
}

/**
 * Greedy test pilot: chooses a safe hop with a short lookahead and waits when
 * no hop is safe. It is intentionally simple; the point is to produce a real
 * winning input stream for the replay verifier.
 */
function chooseAction(
  engine: ChickenGameEngine,
  state: ChickenState
): ChickenDirection | undefined {
  const directions: ChickenDirection[] = ["UP", "LEFT", "RIGHT", "DOWN"];
  const candidates = directions.map((direction) => {
    const result = engine.step(state, direction);
    return { direction, result };
  });

  const home = candidates.find(
    (candidate) =>
      candidate.result.state.homesFilled > state.homesFilled
  );
  if (home) return home.direction;

  let best: { direction: ChickenDirection; score: number } | null = null;
  for (const candidate of candidates) {
    const { result, direction } = candidate;
    if (!result.moved) continue;
    if (result.gameOver) continue;
    const next = result.state;
    if (next.respawnTicks > 0 || next.status === "LOST") continue;
    if (!safeFor(engine, next, 6)) continue;

    const rowGain = next.player.y - state.player.y;
    let score = rowGain * 100 - distanceToHome(next);
    if (rowGain < 0) score -= 250;
    if (
      rowGain === 0 &&
      state.player.y === CHICKEN_CONFIG.HOME_ROW - 1
    ) {
      score += 40;
    }
    if (!best || score > best.score) {
      best = { direction, score };
    }
  }

  if (best) return best.direction;
  if (safeFor(engine, state, 6)) return undefined;

  // Last resort: take the first move that does not die instantly.
  for (const candidate of candidates) {
    if (
      candidate.result.moved &&
      !candidate.result.gameOver &&
      candidate.result.state.respawnTicks === 0
    ) {
      return candidate.direction;
    }
  }

  return undefined;
}

function playToWin(
  engine: ChickenGameEngine,
  targetSeed: string
): {
  inputs: TimestampedInput<ChickenDirection>[];
  state: ChickenState;
} {
  let state = engine.init(targetSeed);
  const inputs: TimestampedInput<ChickenDirection>[] = [];
  let guard = 0;

  while (
    state.status !== "WON" &&
    state.status !== "LOST" &&
    state.tickCount < CHICKEN_CONFIG.MAX_TICKS &&
    guard++ < CHICKEN_CONFIG.MAX_TICKS
  ) {
    let action: ChickenDirection | undefined;
    if (
      state.respawnTicks === 0 &&
      state.player.cooldown === 0 &&
      (state.status === "READY" || state.status === "RUNNING")
    ) {
      action = chooseAction(engine, state);
    }

    if (action) {
      inputs.push({
        t: state.tickCount * CHICKEN_CONFIG.TICK_MS,
        tick: state.tickCount,
        action,
      });
    }

    const result = engine.step(state, action);
    state = result.state;
    if (result.gameOver || result.win) break;
  }

  return { inputs, state };
}

describe("Chicken Cross engine", () => {
  const engine = new ChickenGameEngine();

  it("initializes a deterministic five-home course", () => {
    const state = engine.init(seed);

    assert.equal(state.status, "READY");
    assert.equal(state.lives, 5);
    assert.equal(state.homes.length, 5);
    assert.equal(state.homesFilled, 0);
    assert.equal(state.roadLanes.length, 5);
    assert.equal(state.riverLanes.length, 5);
    assert.equal(state.player.y, 0);
    assert.equal(state.player.x, 6 * CHICKEN_CONFIG.SUB);
    assert.equal(state.tickCount, 0);

    const again = engine.init(seed);
    assert.deepEqual(state.roadLanes, again.roadLanes);
    assert.deepEqual(state.riverLanes, again.riverLanes);
  });

  it("produces different traffic for different days", () => {
    const a = engine.init("2026-10-27:chicken:v1");
    const b = engine.init("2026-10-28:chicken:v1");

    assert.notDeepEqual(a.roadLanes, b.roadLanes);
    assert.notDeepEqual(a.riverLanes, b.riverLanes);
  });

  it("places exactly one alligator mouth on a log", () => {
    const state = engine.init(seed);
    const alligators = state.riverLanes.flatMap((lane) =>
      lane.platforms.filter((platform) => platform.kind === "alligator")
    );

    assert.equal(alligators.length, 1);
    assert.ok(alligators[0].length >= 2);
    assert.equal(alligators[0].mouthCell, alligators[0].length - 1);
  });

  it("starts only when the first direction is pressed", () => {
    const ready = engine.step(engine.init(seed));
    assert.equal(ready.state.tickCount, 0);
    assert.equal(ready.state.player.y, 0);

    const started = engine.step(engine.init(seed), "LEFT");
    assert.equal(started.state.status, "RUNNING");
    assert.equal(started.state.player.y, 0);
    assert.equal(started.state.player.x, 5 * CHICKEN_CONFIG.SUB);
    assert.equal(started.state.hops, 1);
    assert.equal(started.state.tickCount, 1);
  });

  it("kills the chicken on a road vehicle", () => {
    const base = engine.init(seed);
    const lane = base.roadLanes.find((entry) =>
      entry.vehicles.some((vehicle) => vehicle.length >= 2)
    )!;
    const vehicle: Vehicle = lane.vehicles.find(
      (entry) => entry.length >= 2
    )!;
    const state = place(
      base,
      vehicle.x + CHICKEN_CONFIG.SUB / 2,
      lane.row
    );
    const result = engine.step(state);

    assert.equal(result.event, "roadkill");
    assert.equal(result.state.lives, 4);
    assert.equal(result.state.deaths, 1);
    assert.ok(result.state.respawnTicks > 0);
  });

  it("drowns when the chicken is in open water", () => {
    const base = engine.init(seed);
    const state = clone(base);
    state.riverLanes = state.riverLanes.map((lane) =>
      lane.row === 7 ? { ...lane, platforms: [] } : lane
    );
    state.player = {
      ...state.player,
      x: 0,
      y: 7,
      ridingPlatformId: null,
    };
    state.status = "RUNNING";

    const result = engine.step(state);
    assert.equal(result.event, "drown");
    assert.equal(result.state.lives, 4);
  });

  it("carries the chicken with a log", () => {
    const base = engine.init(seed);
    const lane = base.riverLanes.find(
      (entry) =>
        entry.row === 7 &&
        entry.platforms.some((platform) => platform.kind === "log")
    )!;
    const platform = lane.platforms.find(
      (entry) => entry.kind === "log" && entry.length >= 2
    )!;
    const startX =
      platform.x +
      (platform.length * CHICKEN_CONFIG.SUB) / 2 -
      CHICKEN_CONFIG.SUB / 2;
    const state = place(base, startX, lane.row, platform.id);

    const result = engine.step(state);
    const expectedX =
      startX + lane.direction * lane.speed;

    assert.equal(result.state.respawnTicks, 0);
    assert.equal(result.state.player.x, expectedX);
    assert.equal(result.state.player.ridingPlatformId, platform.id);
  });

  it("drowns on a submerged turtle but survives a floating one", () => {
    const base = engine.init(seed);
    const lane = base.riverLanes.find((entry) =>
      entry.platforms.some((platform) => platform.kind === "turtle")
    )!;
    const turtle = lane.platforms.find(
      (entry) => entry.kind === "turtle"
    )!;
    const x =
      turtle.x +
      (turtle.length * CHICKEN_CONFIG.SUB) / 2 -
      CHICKEN_CONFIG.SUB / 2;

    const floating = place(clone(base), x, lane.row, turtle.id);
    const up = engine.step(floating);
    assert.equal(up.event, "none");
    assert.equal(up.state.lives, 5);

    const down = clone(base);
    down.tickCount =
      (CHICKEN_CONFIG.TURTLE_DOWN - turtle.phase +
        CHICKEN_CONFIG.TURTLE_PERIOD) %
      CHICKEN_CONFIG.TURTLE_PERIOD;
    const submerged = place(down, x, lane.row, turtle.id);
    const result = engine.step(submerged);

    assert.equal(result.event, "turtle");
    assert.equal(result.state.lives, 4);
  });

  it("kills the chicken on the alligator mouth", () => {
    const base = engine.init(seed);
    const lane = base.riverLanes.find((entry) =>
      entry.platforms.some((platform) => platform.kind === "alligator")
    )!;
    const gator = lane.platforms.find(
      (platform) => platform.kind === "alligator"
    )!;
    const x =
      gator.x +
      gator.mouthCell * CHICKEN_CONFIG.SUB;
    const state = place(clone(base), x, lane.row, gator.id);

    const result = engine.step(state);
    assert.equal(result.event, "gator");
    assert.equal(result.state.lives, 4);
  });

  it("fills a home and resets the chicken to the start", () => {
    const base = engine.init(seed);
    const state = place(
      base,
      6 * CHICKEN_CONFIG.SUB,
      CHICKEN_CONFIG.HOME_ROW - 1
    );

    const result = engine.step(state, "UP");
    assert.equal(result.event, "home");
    assert.equal(result.state.homesFilled, 1);
    assert.equal(result.state.homes[2], true);
    assert.equal(result.state.player.y, 0);
    assert.equal(result.state.player.x, 6 * CHICKEN_CONFIG.SUB);
    assert.equal(result.state.status, "RUNNING");
  });

  it("blocks hedges and occupied homes", () => {
    const base = engine.init(seed);
    const hedge = place(
      base,
      2 * CHICKEN_CONFIG.SUB,
      CHICKEN_CONFIG.HOME_ROW - 1
    );
    const blocked = engine.step(hedge, "UP");

    assert.equal(blocked.event, "blocked");
    assert.equal(blocked.moved, false);
    assert.equal(blocked.state.homesFilled, 0);
    assert.equal(blocked.state.player.y, CHICKEN_CONFIG.HOME_ROW - 1);
  });

  it("wins when the fifth home is filled", () => {
    const base = engine.init(seed);
    base.homes = [true, true, true, true, false];
    base.homesFilled = 4;
    const state = place(
      base,
      11 * CHICKEN_CONFIG.SUB,
      CHICKEN_CONFIG.HOME_ROW - 1
    );

    const result = engine.step(state, "UP");
    assert.equal(result.win, true);
    assert.equal(result.state.status, "WON");
    assert.equal(result.state.homesFilled, 5);
    assert.equal(result.state.tickCount, 1);
  });

  it("verifies a full winning run", () => {
    const { inputs, state } = playToWin(engine, seed);

    assert.equal(state.status, "WON", "test pilot should finish the course");
    assert.equal(state.homesFilled, 5);
    assert.ok(inputs.length > 10);

    const claimedTimeMs = state.tickCount * CHICKEN_CONFIG.TICK_MS;
    const result = engine.verify(seed, inputs, claimedTimeMs);

    assert.equal(result.valid, true, result.reason ?? "verification failed");
    assert.equal(result.verifiedTimeMs, claimedTimeMs);
    assert.equal(result.summary?.homesFilled, 5);
    assert.equal(result.summary?.ticks, state.tickCount);
  });

  it("rejects empty, early and malformed runs", () => {
    const empty = engine.verify(seed, [], 20000);
    assert.equal(empty.valid, false);
    assert.match(empty.reason || "", /non-empty/);

    const tooFast = engine.verify(
      seed,
      [{ t: 100, tick: 0, action: "UP" }],
      100
    );
    assert.equal(tooFast.valid, false);
    assert.match(tooFast.reason || "", /plausible human/);

    const lateStart = engine.verify(
      seed,
      [{ t: 10000, tick: 5, action: "UP" }],
      20000
    );
    assert.equal(lateStart.valid, false);
    assert.match(lateStart.reason || "", /tick 0/);

    const duplicateTick = engine.verify(
      seed,
      [
        { t: 0, tick: 0, action: "UP" },
        { t: 20, tick: 0, action: "UP" },
      ],
      20000
    );
    assert.equal(duplicateTick.valid, false);
    assert.match(duplicateTick.reason || "", /one input/);

    const unknown = engine.verify(
      seed,
      [{ t: 0, tick: 0, action: "SIDEWAYS" as any }],
      20000
    );
    assert.equal(unknown.valid, false);
    assert.match(unknown.reason || "", /Unknown action/);

    const incomplete = engine.verify(
      seed,
      [{ t: 0, tick: 0, action: "UP" }],
      20000
    );
    assert.equal(incomplete.valid, false);
    assert.match(incomplete.reason || "", /homes filled/);
  });

  it("exposes the public course configuration", () => {
    assert.equal(CHICKEN_CONFIG.HOME_COLS.length, 5);
    assert.equal(CHICKEN_CONFIG.LIVES, 5);
    assert.equal(CHICKEN_CONFIG.HOME_ROW, 12);
  });
});
