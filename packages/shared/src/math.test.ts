import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MathSprintEngine,
  generateMathQuestions,
} from "./games/math.js";

describe("Mental Math Sprint Engine & Verification", () => {
  const engine = new MathSprintEngine();
  const seed = "2026-10-21:math:v1";

  it("produces 10 deterministic questions from seed", () => {
    const q1 = generateMathQuestions(seed);
    const q2 = generateMathQuestions(seed);

    assert.equal(q1.length, 10);
    assert.equal(q2.length, 10);

    for (let i = 0; i < 10; i++) {
      assert.equal(q1[i].prompt, q2[i].prompt);
      assert.equal(q1[i].answer, q2[i].answer);
      assert.equal(typeof q1[i].answer, "number");
      assert.ok(Number.isInteger(q1[i].answer));
    }
  });

  it("different seeds produce different question sets", () => {
    const q1 = generateMathQuestions("seed-alpha");
    const q2 = generateMathQuestions("seed-beta");

    let differences = 0;
    for (let i = 0; i < 10; i++) {
      if (q1[i].prompt !== q2[i].prompt || q1[i].answer !== q2[i].answer) {
        differences++;
      }
    }
    assert.ok(differences > 0);
  });

  it("handles step progression and mistakes correctly", () => {
    const state = engine.init(seed);
    assert.equal(state.currentIndex, 0);
    assert.equal(state.mistakes, 0);

    const q0 = state.questions[0];

    // Submit wrong answer
    const wrongRes = engine.step(state, {
      questionIndex: 0,
      answer: q0.answer + 99,
    });

    assert.equal(wrongRes.correct, false);
    assert.equal(wrongRes.win, false);
    assert.equal(wrongRes.state.currentIndex, 0, "Mistake stays on current question");
    assert.equal(wrongRes.state.mistakes, 1);

    // Submit right answer to correct the mistake
    const rightRes = engine.step(wrongRes.state, {
      questionIndex: 0,
      answer: q0.answer,
    });

    assert.equal(rightRes.correct, true);
    assert.equal(rightRes.state.currentIndex, 1, "Correct answer advances to question 1");
    assert.equal(rightRes.state.mistakes, 1, "Preserves mistake counter");
  });

  it("verifies a valid winning sequence with immediate correction", () => {
    const questions = generateMathQuestions(seed);
    const inputs = [];
    let t = 800;

    // Simulate answering: question 0 has 1 mistake then correction, others answered directly
    inputs.push({
      t: 600,
      action: { questionIndex: 0, answer: questions[0].answer - 5 },
    });
    inputs.push({
      t: 1100,
      action: { questionIndex: 0, answer: questions[0].answer },
    });

    for (let i = 1; i < 10; i++) {
      t += 1200;
      inputs.push({
        t,
        action: { questionIndex: i, answer: questions[i].answer },
      });
    }

    const totalTime = t;
    const result = engine.verify(seed, inputs, totalTime);

    assert.equal(result.valid, true);
    assert.equal(result.verifiedTimeMs, totalTime);
    assert.equal(result.summary?.mistakes, 1);
    assert.equal(result.summary?.questionsCount, 10);
    assert.equal(result.summary?.totalAttempts, 11);
  });

  it("rejects incomplete sequence", () => {
    const questions = generateMathQuestions(seed);
    const inputs = [
      { t: 1000, action: { questionIndex: 0, answer: questions[0].answer } },
      { t: 2000, action: { questionIndex: 1, answer: questions[1].answer } },
    ];

    const result = engine.verify(seed, inputs, 2000);
    assert.equal(result.valid, false);
    assert.match(result.reason || "", /Fewer than 10 submitted answers/);
  });

  it("rejects bot speed (< 1.5s total)", () => {
    const questions = generateMathQuestions(seed);
    const inputs = questions.map((q, idx) => ({
      t: 100 + idx * 50, // total ~550ms
      action: { questionIndex: idx, answer: q.answer },
    }));

    const result = engine.verify(seed, inputs, 550);
    assert.equal(result.valid, false);
    assert.match(result.reason || "", /human cognitive speed limits/);
  });

  it("rejects out-of-order timestamps", () => {
    const questions = generateMathQuestions(seed);
    const inputs = questions.map((q, idx) => ({
      t: idx < 5 ? 1000 + idx * 500 : 500,
      action: { questionIndex: idx, answer: q.answer },
    }));

    const result = engine.verify(seed, inputs, 3000);
    assert.equal(result.valid, false);
    assert.match(result.reason || "", /non-decreasing/);
  });
});
