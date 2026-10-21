import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TypingGameEngine } from "./games/typing.js";

describe("Typing Game Engine & Replay Verification", () => {
  const engine = new TypingGameEngine();
  const seed = "2026-10-21:typing:test";

  it("selects deterministic paragraph from seed", () => {
    const s1 = engine.init(seed);
    const s2 = engine.init(seed);
    assert.equal(s1.targetText, s2.targetText);
    assert.ok(s1.targetText.length > 50);
  });

  it("verifies a valid keystroke sequence", () => {
    const state = engine.init(seed);
    const text = state.targetText;

    // Simulate realistic typing cadence: ~60ms per char
    const inputs: Array<{ t: number; action: string }> = [];
    for (let i = 0; i < text.length; i++) {
      inputs.push({
        t: (i + 1) * 60,
        action: text[i],
      });
    }

    const totalTime = inputs[inputs.length - 1].t;
    const result = engine.verify(seed, inputs, totalTime);

    assert.equal(result.valid, true);
    assert.equal(result.verifiedTimeMs, totalTime);
    assert.ok(result.summary?.wpm && result.summary.wpm > 30);
    assert.equal(result.summary?.charactersCount, text.length);
  });

  it("handles backspaces correctly in simulation", () => {
    let state = engine.init(seed);

    // Type a wrong character 'X', then Backspace, then correct character
    state = engine.step(state, "X").state;
    assert.equal(state.typedBuffer, "X");

    state = engine.step(state, "BACKSPACE").state;
    assert.equal(state.typedBuffer, "");

    state = engine.step(state, state.targetText[0]).state;
    assert.equal(state.typedBuffer, state.targetText[0]);
  });

  it("rejects bot speed that exceeds human limits", () => {
    const state = engine.init(seed);
    const text = state.targetText;

    // Simulate impossible bot typing all characters in 100ms
    const inputs = text.split("").map((ch, idx) => ({
      t: idx + 1,
      action: ch,
    }));

    const result = engine.verify(seed, inputs, 100);
    assert.equal(result.valid, false);
    assert.match(result.reason || "", /human/);
  });

  it("rejects incomplete text", () => {
    const inputs = [
      { t: 1000, action: "H" },
      { t: 2000, action: "i" },
    ];
    const result = engine.verify(seed, inputs, 15000);
    assert.equal(result.valid, false);
    assert.match(result.reason || "", /not completely/);
  });
});
