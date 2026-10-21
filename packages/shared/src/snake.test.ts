import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPRNG, hashString } from "./prng.js";
import { SnakeGameEngine } from "./games/snake.js";
import { TimestampedInput } from "./types.js";

describe("PRNG Determinism", () => {
  it("produces identical random sequences for the same seed", () => {
    const seed = "2026-10-19:snake";
    const rng1 = createPRNG(seed);
    const rng2 = createPRNG(seed);

    const seq1 = Array.from({ length: 10 }, () => rng1());
    const seq2 = Array.from({ length: 10 }, () => rng2());

    assert.deepEqual(seq1, seq2);
  });

  it("produces different sequences for different seeds", () => {
    const rng1 = createPRNG("seed-alpha");
    const rng2 = createPRNG("seed-beta");

    assert.notEqual(rng1(), rng2());
  });
});

describe("Snake Game Engine & Replay Verification", () => {
  const engine = new SnakeGameEngine();
  const seed = "2026-10-19:snake:test";

  it("initializes deterministic state from seed", () => {
    const state1 = engine.init(seed);
    const state2 = engine.init(seed);

    assert.deepEqual(state1.body, state2.body);
    assert.deepEqual(state1.food, state2.food);
    assert.equal(state1.targetLength, 20);
    assert.equal(state1.direction, "RIGHT");
    assert.equal(state1.rngState, state2.rngState);
  });

  it("rejects run that crashes into wall", () => {
    const inputs: TimestampedInput<"UP" | "DOWN" | "LEFT" | "RIGHT">[] = [];
    const result = engine.verify(seed, inputs, 2000);

    assert.equal(result.valid, false);
    assert.match(result.reason || "", /Crash detected/);
  });

  it("rejects invalid claimed time that drifts excessively", () => {
    const inputs: TimestampedInput<"UP" | "DOWN" | "LEFT" | "RIGHT">[] = [];
    const result = engine.verify(seed, inputs, 0);

    assert.equal(result.valid, false);
    assert.equal(result.reason, "Invalid claimed time");
  });

  it("verifies a simulated valid win sequence", () => {
    let state = engine.init(seed);
    const inputs: TimestampedInput<"UP" | "DOWN" | "LEFT" | "RIGHT">[] = [];
    let tick = 0;

    // Simulate safe pathing to win
    while (!state.isWin && !state.isGameOver && tick < 1000) {
      const head = state.body[0];
      const food = state.food;

      // Ordered candidates towards food
      const candidates: Array<"UP" | "DOWN" | "LEFT" | "RIGHT"> = [];
      if (food.x > head.x) candidates.push("RIGHT");
      if (food.x < head.x) candidates.push("LEFT");
      if (food.y > head.y) candidates.push("DOWN");
      if (food.y < head.y) candidates.push("UP");

      for (const d of ["RIGHT", "DOWN", "LEFT", "UP"] as const) {
        if (!candidates.includes(d)) candidates.push(d);
      }

      // Check purely without side-effects (since state is immutable in step)
      let chosenDir = state.direction;
      for (const dir of candidates) {
        const testRes = engine.step(state, dir);
        if (!testRes.gameOver) {
          chosenDir = dir;
          break;
        }
      }

      if (chosenDir !== state.direction) {
        inputs.push({
          t: tick * state.tickMs + 10,
          action: chosenDir,
        });
      }

      const res = engine.step(state, chosenDir);
      state = res.state;
      tick++;
    }

    assert.equal(state.isWin, true, "Simulation should successfully reach target length");

    const expectedTime = state.tickCount * state.tickMs;
    const verifyRes = engine.verify(seed, inputs, expectedTime);

    assert.equal(verifyRes.valid, true, `Verification failed: ${verifyRes.reason}`);
    assert.equal(verifyRes.verifiedTimeMs, expectedTime);
    assert.equal(verifyRes.summary?.applesEaten, 17);
  });
});
