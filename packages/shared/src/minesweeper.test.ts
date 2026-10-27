import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MINESWEEPER_CONFIG,
  MinesweeperEngine,
  MinesweeperInput,
  MinesweeperState,
  isLogicallySolvable,
} from "./games/minesweeper.js";
import { TimestampedInput } from "./types.js";

const seed = "2026-10-27:minesweeper:v1";

function click(
  engine: MinesweeperEngine,
  state: MinesweeperState,
  action: MinesweeperInput,
  t: number,
  inputs: TimestampedInput<MinesweeperInput>[]
) {
  inputs.push({ t, action });
  return engine.step(state, action);
}

/**
 * Replays the board to a win, clicking every safe square that is still covered.
 * Returns the winning timestamp (the moment the last safe square is revealed).
 */
function buildWinningRun(
  engine: MinesweeperEngine,
  targetSeed: string,
  first: MinesweeperInput = { row: 4, col: 4 }
) {
  let state = engine.init(targetSeed);
  const inputs: TimestampedInput<MinesweeperInput>[] = [];
  let t = 500;

  t += 120;
  let result = click(engine, state, first, t, inputs);
  state = result.state;
  assert.equal(result.mineHit, false, "first click must always be safe");

  const cols = state.cols;
  while (!result.win) {
    let nextIndex = -1;
    for (let i = 0; i < state.mines.length; i++) {
      if (!state.mines[i] && !state.revealed[i]) {
        nextIndex = i;
        break;
      }
    }
    assert.notEqual(nextIndex, -1, "win should be reachable on a full board");

    t += 120;
    result = click(
      engine,
      state,
      { row: Math.floor(nextIndex / cols), col: nextIndex % cols },
      t,
      inputs
    );
    state = result.state;
    assert.equal(result.mineHit, false, "solver must only click safe cells");
  }

  return { inputs, state, result, timeMs: t };
}

describe("Minesweeper Sprint Engine & Verification", () => {
  const engine = new MinesweeperEngine();

  it("starts ready with mines deferred until the first click", () => {
    const state = engine.init(seed);

    assert.equal(state.status, "READY");
    assert.equal(state.minesPlaced, false);
    assert.equal(state.mines.length, 81);
    assert.equal(state.revealedCount, 0);
    assert.equal(state.safeTotal, 71);
    assert.equal(state.mineCount, 10);
    assert.equal(state.mines.filter(Boolean).length, 0);
  });

  it("opens a safe 3x3 area on the first click, wherever it is", () => {
    for (const first of [
      { row: 4, col: 4 },
      { row: 0, col: 0 },
      { row: 8, col: 8 },
      { row: 0, col: 8 },
    ]) {
      const state = engine.init(seed);
      const result = engine.step(state, first);
      const clickedIndex = first.row * 9 + first.col;

      assert.equal(result.changed, true);
      assert.equal(result.mineHit, false);
      assert.equal(result.opened.includes(clickedIndex), true);
      assert.equal(result.state.revealed[clickedIndex], true);
      assert.equal(result.state.adjacent[clickedIndex], 0);

      for (const opened of result.opened) {
        assert.equal(result.state.mines[opened], false);
      }
      assert.ok(result.opened.length >= 4, "corner starts still open a 2x2 area");
    }
  });

  it("places exactly 10 mines outside the opening area, deterministically", () => {
    const first = { row: 4, col: 4 };
    const a = engine.step(engine.init(seed), first).state;
    const b = engine.step(engine.init(seed), first).state;

    assert.equal(a.mines.filter(Boolean).length, 10);
    assert.deepEqual(a.mines, b.mines);
    assert.deepEqual(a.adjacent, b.adjacent);

    for (let r = 3; r <= 5; r++) {
      for (let c = 3; c <= 5; c++) {
        assert.equal(a.mines[r * 9 + c], false);
      }
    }
  });

  it("produces different layouts for different days", () => {
    const first = { row: 4, col: 4 };
    const a = engine.step(engine.init("2026-10-27:minesweeper:v1"), first).state;
    const b = engine.step(engine.init("2026-10-28:minesweeper:v1"), first).state;

    assert.notDeepEqual(a.mines, b.mines);
  });

  it("generates boards that can be solved without guessing", () => {
    const seeds = [
      seed,
      "seed-alpha",
      "2026-11-01:minesweeper:v1",
      "2027-02-14:minesweeper:v1",
    ];
    const openings = [
      { row: 0, col: 0 },
      { row: 4, col: 4 },
      { row: 8, col: 2 },
    ];

    for (const targetSeed of seeds) {
      for (const first of openings) {
        const state = engine.step(engine.init(targetSeed), first).state;
        assert.equal(
          isLogicallySolvable(
            state.mines,
            state.adjacent,
            state.rows,
            state.cols,
            first.row * state.cols + first.col
          ),
          true,
          `${targetSeed} opening ${first.row},${first.col} needs a guess`
        );
      }
    }
  });

  it("ignores clicks on covered cells that are already revealed", () => {
    const first = { row: 4, col: 4 };
    const opened = engine.step(engine.init(seed), first).state;
    const again = engine.step(opened, first);

    assert.equal(again.changed, false);
    assert.equal(again.state.revealedCount, opened.revealedCount);
    assert.equal(again.state.actionCount, opened.actionCount);
  });

  it("toggles flags without revealing cells or placing mines", () => {
    const first = engine.step(engine.init(seed), {
      row: 0,
      col: 0,
      type: "FLAG",
    });

    assert.equal(first.changed, true);
    assert.equal(first.state.flagged[0], true);
    assert.equal(first.state.flagCount, 1);
    assert.equal(first.state.revealedCount, 0);
    assert.equal(first.state.minesPlaced, false);
    assert.equal(first.state.status, "READY");
    assert.equal(first.state.actionCount, 1);

    const second = engine.step(first.state, {
      row: 0,
      col: 0,
      type: "FLAG",
    });

    assert.equal(second.changed, true);
    assert.equal(second.state.flagged[0], false);
    assert.equal(second.state.flagCount, 0);
    assert.equal(second.state.minesPlaced, false);
  });

  it("does not reveal a flagged cell", () => {
    let state = engine.step(engine.init(seed), { row: 4, col: 4 }).state;
    const safeIndex = state.revealed.findIndex(
      (isRevealed, index) => !isRevealed && !state.mines[index]
    );
    const cell = {
      row: Math.floor(safeIndex / state.cols),
      col: safeIndex % state.cols,
    };

    state = engine.step(state, { ...cell, type: "FLAG" }).state;
    const reveal = engine.step(state, { ...cell, type: "REVEAL" });

    assert.equal(reveal.changed, false);
    assert.equal(reveal.state.revealed[safeIndex], false);
    assert.equal(reveal.state.flagged[safeIndex], true);
  });

  it("caps flags at the number of mines", () => {
    let state = engine.step(engine.init(seed), { row: 4, col: 4 }).state;
    const mineIndices = state.mines
      .map((isMine, index) => (isMine ? index : -1))
      .filter((index) => index >= 0);

    for (const index of mineIndices) {
      const result = engine.step(state, {
        row: Math.floor(index / state.cols),
        col: index % state.cols,
        type: "FLAG",
      });
      assert.equal(result.changed, true);
      state = result.state;
    }

    assert.equal(state.flagCount, 10);
    const extraIndex = state.revealed.findIndex(
      (isRevealed, index) =>
        !isRevealed && !state.mines[index] && !state.flagged[index]
    );
    const extra = engine.step(state, {
      row: Math.floor(extraIndex / state.cols),
      col: extraIndex % state.cols,
      type: "FLAG",
    });

    assert.equal(extra.changed, false);
    assert.equal(extra.state.flagCount, 10);
  });

  it("verifies a complete winning run", () => {
    const { inputs, timeMs } = buildWinningRun(engine, seed);
    const result = engine.verify(seed, inputs, timeMs);

    assert.equal(result.valid, true);
    assert.equal(result.verifiedTimeMs, timeMs);
    assert.equal(result.summary?.cellsRevealed, 71);
    assert.equal(result.summary?.safeCells, 71);
    assert.equal(result.summary?.mineCount, 10);
    assert.equal(result.summary?.flags, 0);
    assert.ok((result.summary?.actions ?? 0) > 0);
  });

  it("verifies a winning run that includes flags", () => {
    // The flag is placed before the clock starts, then the board is cleared.
    const probe = engine.step(engine.init(seed), { row: 4, col: 4 }).state;
    const mineIndex = probe.mines.findIndex(Boolean);
    const cols = probe.cols;

    let state = engine.init(seed);
    const inputs: TimestampedInput<MinesweeperInput>[] = [
      {
        t: 0,
        action: {
          row: Math.floor(mineIndex / cols),
          col: mineIndex % cols,
          type: "FLAG",
        },
      },
    ];
    state = engine.step(state, inputs[0].action).state;

    let t = 1200;
    inputs.push({ t, action: { row: 4, col: 4, type: "REVEAL" } });
    let result = engine.step(state, inputs[1].action);
    state = result.state;
    assert.equal(result.mineHit, false);

    while (!result.win) {
      const nextIndex = state.revealed.findIndex(
        (isRevealed, index) =>
          !isRevealed && !state.mines[index] && !state.flagged[index]
      );
      assert.notEqual(nextIndex, -1, "a full board must be reachable");

      t += 120;
      const action = {
        row: Math.floor(nextIndex / cols),
        col: nextIndex % cols,
        type: "REVEAL" as const,
      };
      inputs.push({ t, action });
      result = engine.step(state, action);
      state = result.state;
      assert.equal(result.mineHit, false);
    }

    const verified = engine.verify(seed, inputs, t);
    assert.equal(verified.valid, true);
    assert.equal(verified.summary?.flags, 1);
    assert.equal(verified.summary?.cellsRevealed, 71);
  });

  it("rejects unknown action types", () => {
    const result = engine.verify(
      seed,
      [
        {
          t: 2000,
          action: { row: 0, col: 0, type: "BOMB" as any },
        },
      ],
      2000
    );

    assert.equal(result.valid, false);
    assert.match(result.reason || "", /Unknown action/);
  });

  it("rejects a run that hits a mine", () => {
    const state = engine.step(engine.init(seed), { row: 4, col: 4 }).state;
    const mineIndex = state.mines.findIndex(Boolean);
    const inputs: TimestampedInput<MinesweeperInput>[] = [
      { t: 1300, action: { row: 4, col: 4 } },
      {
        t: 1700,
        action: {
          row: Math.floor(mineIndex / state.cols),
          col: mineIndex % state.cols,
        },
      },
    ];

    const result = engine.verify(seed, inputs, 1700);
    assert.equal(result.valid, false);
    assert.match(result.reason || "", /Hit a mine/);
  });

  it("rejects an incomplete board", () => {
    const inputs: TimestampedInput<MinesweeperInput>[] = [
      { t: 5000, action: { row: 4, col: 4 } },
    ];
    const result = engine.verify(seed, inputs, 5000);

    assert.equal(result.valid, false);
    assert.match(result.reason || "", /not cleared/);
  });

  it("rejects implausibly fast runs", () => {
    const { inputs } = buildWinningRun(engine, seed);
    const result = engine.verify(seed, inputs, 500);

    assert.equal(result.valid, false);
    assert.match(result.reason || "", /plausible human reaction speed/);
  });

  it("rejects click rates above human limits", () => {
    // A fast solver may legitimately finish a lucky board in a few dozen
    // clicks, so exercise the rate guard with a dense no-op spam sequence.
    const inputs: TimestampedInput<MinesweeperInput>[] = Array.from(
      { length: 60 },
      (_, index) => ({
        t: 1200 + index,
        action: { row: 4, col: 4 },
      })
    );
    const result = engine.verify(seed, inputs, 1259);

    assert.equal(result.valid, false);
    assert.match(result.reason || "", /physical human limits/);
  });

  it("rejects out-of-order timestamps", () => {
    const { inputs } = buildWinningRun(engine, seed);
    const broken = inputs.map((input, index) =>
      index >= 5 ? { ...input, t: inputs[4].t - 1 } : input
    );
    const result = engine.verify(seed, broken, inputs[inputs.length - 1].t);

    assert.equal(result.valid, false);
    assert.match(result.reason || "", /non-decreasing/);
  });

  it("rejects clicks outside the board and non-integer cells", () => {
    const outside = engine.verify(
      seed,
      [{ t: 2000, action: { row: 9, col: 0 } }],
      2000
    );
    assert.equal(outside.valid, false);
    assert.match(outside.reason || "", /Invalid cell/);

    const fractional = engine.verify(
      seed,
      [{ t: 2000, action: { row: 1.5, col: 2 } }],
      2000
    );
    assert.equal(fractional.valid, false);
    assert.match(fractional.reason || "", /Invalid cell/);
  });

  it("exposes the public config used by the client", () => {
    assert.equal(MINESWEEPER_CONFIG.ROWS, 9);
    assert.equal(MINESWEEPER_CONFIG.COLS, 9);
    assert.equal(MINESWEEPER_CONFIG.MINES, 10);
  });
});
