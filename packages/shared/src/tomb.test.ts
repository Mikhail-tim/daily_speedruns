import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TOMB_CONFIG,
  TombAction,
  TombGameEngine,
  TombLevel,
  TombState,
  cellOf,
  generateTombLevel,
  optimalMoves,
  slide,
  solveFrom,
} from "./games/tomb.js";
import { TimestampedInput } from "./types.js";

const seed = "2026-11-01:tomb:v1";

/** Flat room with the border walled: the base for the mechanic tests. */
function room(): TombLevel {
  const cols = TOMB_CONFIG.COLS;
  const rows = TOMB_CONFIG.ROWS;
  const walls: boolean[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      walls.push(x === 0 || y === 0 || x === cols - 1 || y === rows - 1);
    }
  }
  return {
    cols,
    rows,
    walls,
    doorAt: -1,
    keyAt: -1,
    gateAt: -1,
    switchAt: -1,
    start: cellOf(cols, 1, 1),
    exit: cellOf(cols, 7, 7),
    optimalMoves: -1,
  };
}

function stateOn(level: TombLevel, patch: Partial<TombState> = {}): TombState {
  return {
    seed,
    tickMs: TOMB_CONFIG.TICK_MS,
    tickCount: 0,
    status: "RUNNING",
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
    ...patch,
  };
}

describe("Tomb Escape", () => {
  const engine = new TombGameEngine();

  it("generates deterministic floors that the solver can finish", () => {
    const a = engine.init(seed);
    const b = engine.init(seed);

    assert.deepEqual(a.level.walls, b.level.walls);
    assert.equal(a.level.start, b.level.start);
    assert.equal(a.level.exit, b.level.exit);
    assert.equal(a.status, "READY");
    assert.equal(a.floors, TOMB_CONFIG.FLOORS);
    assert.ok(a.level.optimalMoves >= 1);
    assert.ok(
      a.level.optimalMoves >= TOMB_CONFIG.MIN_MOVES,
      `par ${a.level.optimalMoves} should clear the minimum`
    );

    const solution = solveFrom(a.level, a.level.start, {
      hasKey: false,
      doorOpen: false,
      gateOpen: false,
    });
    assert.ok(solution, "every generated floor must be solvable");
    assert.equal(solution.length, a.level.optimalMoves, "par is the BFS optimum");
  });

  it("keeps every generated floor solvable and non-trivial", () => {
    for (const day of ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]) {
      for (let floor = 0; floor < TOMB_CONFIG.FLOORS; floor++) {
        const level = generateTombLevel(`${day}:tomb:v1`, floor);
        const par = optimalMoves(level);
        assert.ok(par > 0, `${day} floor ${floor} must be solvable`);
        assert.equal(par, level.optimalMoves, `${day} floor ${floor} par mismatch`);
        assert.ok(
          par >= TOMB_CONFIG.MIN_MOVES,
          `${day} floor ${floor} par ${par} is below the minimum`
        );
        // Every floor must actually use its lock and key.
        assert.ok(level.doorAt >= 0, "floors ship with a door");
        assert.ok(level.keyAt >= 0, "floors ship with a key");
        assert.ok(level.gateAt >= 0, "floors ship with a gate");
        assert.ok(level.switchAt >= 0, "floors ship with a switch");
      }
    }
  });

  it("varies the dungeon with the date", () => {
    const a = generateTombLevel("2026-11-01:tomb:v1", 0);
    const b = generateTombLevel("2026-11-02:tomb:v1", 0);
    assert.notDeepEqual(a.walls, b.walls);
  });

  it("slides until a wall stops it", () => {
    const level = room();
    const out = slide(
      level,
      cellOf(level.cols, 1, 1),
      "RIGHT",
      { hasKey: false, doorOpen: false, gateOpen: false }
    );

    assert.equal(out.pos, cellOf(level.cols, 7, 1));
    assert.equal(out.path.length, 6);
    assert.equal(out.hitExit, false);
  });

  it("stops at the exit instead of sliding past it", () => {
    const level = room();
    level.exit = cellOf(level.cols, 4, 1);
    const out = slide(level, cellOf(level.cols, 1, 1), "RIGHT", {
      hasKey: false,
      doorOpen: false,
      gateOpen: false,
    });
    assert.equal(out.pos, cellOf(level.cols, 4, 1));
    assert.equal(out.hitExit, true);
  });

  it("reports a blocked move without spending the run", () => {
    const level = room();
    const state = stateOn(level, { player: cellOf(level.cols, 1, 1) });
    const result = engine.step(state, "LEFT");

    assert.equal(result.event, "blocked");
    assert.equal(result.state.player, state.player);
    assert.equal(result.state.moves, 0);
    assert.equal(result.state.tickCount, 1);
    assert.equal(result.state.status, "RUNNING");
  });

  it("spends a key to open a door and refuses without one", () => {
    const level = room();
    level.doorAt = cellOf(level.cols, 4, 1);
    level.keyAt = cellOf(level.cols, 3, 5);
    level.exit = cellOf(level.cols, 7, 1);
    level.switchAt = -1;
    level.gateAt = -1;

    // No key: the door behaves like a wall.
    const locked = slide(
      level,
      cellOf(level.cols, 1, 1),
      "RIGHT",
      { hasKey: false, doorOpen: false, gateOpen: false }
    );
    assert.equal(locked.pos, cellOf(level.cols, 3, 1));
    assert.equal(locked.hitDoor, false);

    // With a key the door opens and the slide continues through it.
    const unlocked = slide(
      level,
      cellOf(level.cols, 1, 1),
      "RIGHT",
      { hasKey: true, doorOpen: false, gateOpen: false }
    );
    assert.equal(unlocked.hitDoor, true);
    assert.equal(unlocked.flags.hasKey, false, "the key is spent");
    assert.equal(unlocked.flags.doorOpen, true);
    assert.equal(unlocked.pos, cellOf(level.cols, 7, 1));

    // Picking the key up sets the flag.
    const pick = slide(
      level,
      cellOf(level.cols, 1, 5),
      "RIGHT",
      { hasKey: false, doorOpen: false, gateOpen: false }
    );
    assert.equal(pick.hitKey, true);
    assert.equal(pick.flags.hasKey, true);
  });

  it("opens gates only while the switch is pressed", () => {
    const level = room();
    level.gateAt = cellOf(level.cols, 4, 1);
    level.switchAt = cellOf(level.cols, 3, 5);
    level.exit = cellOf(level.cols, 7, 1);
    level.doorAt = -1;
    level.keyAt = -1;

    const closed = slide(
      level,
      cellOf(level.cols, 1, 1),
      "RIGHT",
      { hasKey: false, doorOpen: false, gateOpen: false }
    );
    assert.equal(closed.pos, cellOf(level.cols, 3, 1), "the gate blocks");

    const pressed = slide(
      level,
      cellOf(level.cols, 1, 5),
      "RIGHT",
      { hasKey: false, doorOpen: false, gateOpen: false }
    );
    assert.equal(pressed.hitSwitch, true);
    assert.equal(pressed.flags.gateOpen, true);

    const through = slide(
      level,
      cellOf(level.cols, 1, 1),
      "RIGHT",
      { hasKey: false, doorOpen: false, gateOpen: true }
    );
    assert.equal(through.pos, cellOf(level.cols, 7, 1));
  });

  it("moves on to the next floor and wins on the last exit", () => {
    const level = room();
    level.exit = cellOf(level.cols, 5, 1);
    const first = engine.step(
      stateOn(level, { player: cellOf(level.cols, 1, 1), floors: 3 }),
      "RIGHT"
    );

    assert.equal(first.event, "exit");
    assert.equal(first.win, false);
    assert.equal(first.state.floor, 1);
    assert.equal(first.state.player, first.state.level.start);
    assert.equal(first.state.hasKey, false, "lock state resets per floor");

    const last = engine.step(
      stateOn(level, {
        player: cellOf(level.cols, 1, 1),
        floor: 2,
        floors: 3,
      }),
      "RIGHT"
    );
    assert.equal(last.win, true);
    assert.equal(last.state.status, "WON");
  });

  it("keeps the clock running on idle ticks", () => {
    const level = room();
    let state = stateOn(level);
    const start = state.tickCount;
    for (let i = 0; i < 5; i++) state = engine.step(state).state;
    assert.equal(state.tickCount, start + 5);
    assert.equal(state.moves, 0);
  });

  it("verifies a full three-floor escape", () => {
    const { inputs, state } = escape(engine, seed);

    assert.equal(state.status, "WON");
    assert.equal(state.floor, TOMB_CONFIG.FLOORS - 1);

    const claimedTimeMs = state.tickCount * TOMB_CONFIG.TICK_MS;
    const result = engine.verify(seed, inputs, claimedTimeMs);

    assert.equal(result.valid, true, result.reason ?? "verification failed");
    assert.equal(result.verifiedTimeMs, claimedTimeMs);
    assert.equal(result.summary?.floors, TOMB_CONFIG.FLOORS);
    assert.ok((result.summary?.moves ?? 0) > 10);
  });

  it("rejects empty, early and malformed runs", () => {
    const empty = engine.verify(seed, [], 20000);
    assert.equal(empty.valid, false);
    assert.match(empty.reason || "", /non-empty/);

    const tooFast = engine.verify(seed, [{ t: 10, tick: 0, action: "DOWN" }], 100);
    assert.equal(tooFast.valid, false);
    assert.match(tooFast.reason || "", /plausible human/);

    const lateStart = engine.verify(
      seed,
      [{ t: 20000, tick: 90, action: "DOWN" }],
      20000
    );
    assert.equal(lateStart.valid, false);
    assert.match(lateStart.reason || "", /tick 0/);

    const badMove = engine.verify(
      seed,
      [{ t: 20000, tick: 0, action: "NORTH" as unknown as TombAction }],
      20000
    );
    assert.equal(badMove.valid, false);
    assert.match(badMove.reason || "", /Unknown move/);
  });

  it("rejects a run that never escapes", () => {
    const inputs: TimestampedInput<TombAction>[] = [{ t: 0, tick: 0, action: "UP" }];
    for (let i = 1; i < 40; i++) {
      inputs.push({ t: i * 100, tick: i, action: "LEFT" });
    }
    const result = engine.verify(seed, inputs, 4000 + 2000);
    assert.equal(result.valid, false);
  });

  it("exposes the public dungeon configuration", () => {
    assert.ok(TOMB_CONFIG.MIN_MOVES >= 5);
    assert.ok(TOMB_CONFIG.MAX_MOVES > TOMB_CONFIG.MIN_MOVES);
    assert.ok(TOMB_CONFIG.FLOORS >= 1);
    assert.equal(TOMB_CONFIG.COLS, TOMB_CONFIG.ROWS);
  });
});

/**
 * Solver pilot: asks the BFS for the optimal next slide on every floor and
 * pads each move with idle ticks so the replay sees one input per tick and the
 * run clears the minimum-time floor.
 */
function escape(
  engine: TombGameEngine,
  targetSeed: string
): { inputs: TimestampedInput<TombAction>[]; state: TombState } {
  let state = engine.init(targetSeed);
  const inputs: TimestampedInput<TombAction>[] = [];
  let guard = 0;

  while (state.status !== "WON" && guard++ < 400) {
    const solution = solveFrom(state.level, state.player, {
      hasKey: state.hasKey,
      doorOpen: state.doorOpen,
      gateOpen: state.gateOpen,
    });
    if (!solution || solution.length === 0) break;

    const move = solution[0];
    const tick = state.tickCount;
    inputs.push({ t: tick * TOMB_CONFIG.TICK_MS, tick, action: move });
    state = engine.step(state, move).state;

    // Think time between slides.
    for (let i = 0; i < 39 && state.status !== "WON"; i++) {
      state = engine.step(state).state;
    }
  }

  return { inputs, state };
}
