import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { WordleGameEngine, evaluateWordleGuess } from "./games/wordle.js";

describe("Wordle Evaluation Algorithm", () => {
  it("evaluates exact match correctly", () => {
    const res = evaluateWordleGuess("CRANE", "CRANE");
    assert.deepEqual(res, ["correct", "correct", "correct", "correct", "correct"]);
  });

  it("handles duplicate letters properly", () => {
    // Target has two P's. Guess has three P's.
    // Index 1 and 2 are P. In PUPPY:
    // P 0: present
    // U 1: absent
    // P 2: correct
    // P 3: absent (since 2 P's are already used)
    // Y 4: absent
    const res = evaluateWordleGuess("PUPPY", "APPLE");
    // Target APPLE: A(0), P(1), P(2), L(3), E(4)
    // Guess PUPPY: P(0), U(1), P(2), P(3), Y(4)
    // Pass 1:
    // index 2: guess[2]='P', target[2]='P' => correct. 1 'P' remaining.
    // Pass 2:
    // index 0: guess[0]='P' => present. 0 'P' remaining.
    // index 3: guess[3]='P' => absent (no more P's).
    assert.equal(res[2], "correct");
    assert.equal(res[0], "present");
    assert.equal(res[3], "absent");
  });
});

describe("Wordle Game Engine & Replay Verification", () => {
  const engine = new WordleGameEngine();
  const seed = "2026-10-21:wordle:test";

  it("produces deterministic secret word from seed", () => {
    const s1 = engine.init(seed);
    const s2 = engine.init(seed);
    assert.equal(s1.targetWord, s2.targetWord);
    assert.equal(s1.targetWord.length, 5);
  });

  it("verifies a valid winning sequence of guesses", () => {
    const state = engine.init(seed);
    const target = state.targetWord;

    const inputs = [
      { t: 1200, action: "CRANE" },
      { t: 3400, action: target },
    ];

    const result = engine.verify(seed, inputs, 3400);
    assert.equal(result.valid, true);
    assert.equal(result.verifiedTimeMs, 3400);
    assert.equal(result.summary?.solvedWord, target);
    assert.equal(result.summary?.guessesCount, 2);
  });

  it("rejects invalid word not in dictionary", () => {
    const inputs = [{ t: 1000, action: "ZZZZZ" }];
    const result = engine.verify(seed, inputs, 1000);
    assert.equal(result.valid, false);
    assert.match(result.reason || "", /Word not in dictionary/);
  });

  it("rejects an inhuman one-guess solve", () => {
    const state = engine.init(seed);
    const inputs = [{ t: 1, action: state.targetWord }];
    const result = engine.verify(seed, inputs, 1);
    assert.equal(result.valid, false);
    assert.match(result.reason || "", /human cognitive speed limits/);
  });

  it("rejects a bot-speed multi-guess run", () => {
    const state = engine.init(seed);
    const inputs = [
      { t: 100, action: "CRANE" },
      { t: 200, action: state.targetWord },
    ];
    const result = engine.verify(seed, inputs, 200);
    assert.equal(result.valid, false);
    assert.match(result.reason || "", /human cognitive speed limits/);
  });

  it("rejects when secret word was not solved", () => {
    const state = engine.init(seed);
    const wrongWord = state.targetWord === "CRANE" ? "GHOST" : "CRANE";

    const inputs = [{ t: 2000, action: wrongWord }];
    const result = engine.verify(seed, inputs, 2000);
    assert.equal(result.valid, false);
    assert.match(result.reason || "", /not solved/);
  });
});
