import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Game2048Engine, executeMove } from "./games/game2048.js";

describe("2048 Slide & Merge Mechanics", () => {
  it("slides and merges tiles to the left correctly", () => {
    const grid = [
      [2, 2, 4, 8],
      [4, 0, 4, 0],
      [2, 2, 2, 2],
      [0, 0, 0, 0],
    ];

    const { grid: result, scoreGained, changed } = executeMove(grid, "LEFT");
    assert.equal(changed, true);
    // Row 0: 2+2=4 -> [4, 4, 8, 0]
    assert.deepEqual(result[0], [4, 4, 8, 0]);
    // Row 1: 4+4=8 -> [8, 0, 0, 0]
    assert.deepEqual(result[1], [8, 0, 0, 0]);
    // Row 2: 2+2=4, 2+2=4 -> [4, 4, 0, 0]
    assert.deepEqual(result[2], [4, 4, 0, 0]);
    assert.equal(scoreGained, 4 + 8 + 4 + 4);
  });

  it("slides downwards correctly", () => {
    const grid = [
      [2, 0, 0, 0],
      [2, 0, 0, 0],
      [4, 0, 0, 0],
      [4, 0, 0, 0],
    ];

    const { grid: result, changed } = executeMove(grid, "DOWN");
    assert.equal(changed, true);
    assert.equal(result[3][0], 8); // 4+4=8
    assert.equal(result[2][0], 4); // 2+2=4
  });

  it("detects when a move does not change the board", () => {
    const grid = [
      [2, 4, 8, 16],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];

    const { changed } = executeMove(grid, "LEFT");
    assert.equal(changed, false);
  });
});

describe("Game2048Engine & Replay Verification", () => {
  const engine = new Game2048Engine();
  const seed = "2026-10-21:game2048:test";

  it("produces deterministic initial board from seed", () => {
    const s1 = engine.init(seed);
    const s2 = engine.init(seed);

    assert.deepEqual(s1.grid, s2.grid);
    assert.equal(s1.targetTile, 512);
    assert.equal(s1.score, 0);
  });

  it("verifies a simulated winning run reaching 512", () => {
    // Manually create a board that is one merge away from 512
    const state = engine.init(seed);
    state.grid[0][0] = 256;
    state.grid[0][1] = 256;

    const stepRes = engine.step(state, "LEFT");
    assert.equal(stepRes.win, true);
    assert.ok(stepRes.state.maxTile >= 512);

    // Test verify() with a sequence that reaches 512
    // We can simulate an automated run or verify replay mechanics
    const inputs = [
      { t: 300, action: "LEFT" as const },
    ];

    // Testing verify with an initial state that wins in 1 move
    const customEngine = new (class extends Game2048Engine {
      init(s: string) {
        const initSt = super.init(s);
        initSt.grid[0][0] = 256;
        initSt.grid[0][1] = 256;
        return initSt;
      }
    })();

    const result = customEngine.verify(seed, inputs, 300);
    assert.equal(result.valid, true);
    assert.equal(result.verifiedTimeMs, 300);
    assert.equal(result.summary?.maxTile, 512);
  });

  it("rejects run when 512 is not reached", () => {
    const inputs = [
      { t: 500, action: "LEFT" as const },
      { t: 1000, action: "UP" as const },
    ];
    const result = engine.verify(seed, inputs, 1000);
    assert.equal(result.valid, false);
    assert.match(result.reason || "", /512 tile was not reached/);
  });

  it("rejects inhuman move rate", () => {
    const inputs = Array.from({ length: 20 }, (_, idx) => ({
      t: idx * 10, // 10ms per move = 100 moves/sec
      action: "LEFT" as const,
    }));
    const result = engine.verify(seed, inputs, 200);
    assert.equal(result.valid, false);
    assert.match(result.reason || "", /exceeds physical human limits/);
  });
});
