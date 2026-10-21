import {
  GameEngine,
  TimestampedInput,
  VerificationResult,
} from "../types.js";
import { createPRNG, randomInt } from "../prng.js";

export interface MathQuestion {
  id: number;
  prompt: string;
  category: string;
  hint?: string;
  answer: number;
}

export interface MathState {
  questions: MathQuestion[];
  currentIndex: number;
  score: number;
  mistakes: number;
  completed: boolean;
}

export interface MathInput {
  questionIndex: number;
  answer: number;
}

export interface MathSummary {
  questionsCount: number;
  totalAttempts: number;
  mistakes: number;
  accuracyPercent: number;
}

/**
 * 10 Question Generators designed for Mental Math:
 * Solvable in head, but requires active thought for post-high-school minds.
 */

// 1. Mental Algebra: ax + b = c, solve for x
function genLinearEquation(rng: () => number, id: number): MathQuestion {
  const a = randomInt(rng, 3, 8);
  const x = randomInt(rng, 6, 17);
  const b = randomInt(rng, 11, 47);
  const c = a * x + b;
  return {
    id,
    prompt: `Solve for x:   ${a}x + ${b} = ${c}`,
    category: "Algebra",
    answer: x,
  };
}

// 2. Factoring / Distributive multiplication trick
function genDistributive(rng: () => number, id: number): MathQuestion {
  const k = randomInt(rng, 12, 19);
  const diff = randomInt(rng, 2, 4) * 5; // e.g. 10, 15, 20
  const b = randomInt(rng, 6, 14);
  const a = b + diff;
  // k * a - k * b = k * (a - b) = k * diff
  return {
    id,
    prompt: `Calculate:   ${k} × ${a} − ${k} × ${b}`,
    category: "Arithmetic Shortcut",
    answer: k * diff,
  };
}

// 3. Percentages with clean mental shortcuts
function genPercentage(rng: () => number, id: number): MathQuestion {
  const percents = [15, 25, 35, 45, 75];
  const pct = percents[randomInt(rng, 0, percents.length - 1)];
  // Pick base such that (pct * base / 100) is an integer
  // e.g. for 15% -> base mult of 20
  const multiplier = randomInt(rng, 4, 15);
  const base = multiplier * 20;
  const answer = Math.round((pct * base) / 100);
  return {
    id,
    prompt: `What is ${pct}% of ${base}?`,
    category: "Percentages",
    answer,
  };
}

// 4. Difference of squares or powers: a^2 - b^2 = (a-b)(a+b)
function genDifferenceOfSquares(rng: () => number, id: number): MathQuestion {
  const diff = randomInt(rng, 2, 4);
  const b = randomInt(rng, 11, 22);
  const a = b + diff;
  const answer = (a - b) * (a + b);
  return {
    id,
    prompt: `Calculate:   ${a}² − ${b}²`,
    category: "Powers & Squares",
    answer,
  };
}

// 5. Square Roots & Powers
function genRootsAndPowers(rng: () => number, id: number): MathQuestion {
  // Pairs of square roots like sqrt(289) + sqrt(144) = 17 + 12 = 29
  const roots = [
    { root: 13, sq: 169 },
    { root: 14, sq: 196 },
    { root: 15, sq: 225 },
    { root: 16, sq: 256 },
    { root: 17, sq: 289 },
    { root: 18, sq: 324 },
    { root: 19, sq: 361 },
  ];
  const idx1 = randomInt(rng, 0, roots.length - 1);
  const r1 = roots[idx1];
  const offset = randomInt(rng, 5, 12);
  const answer = r1.root + offset;
  return {
    id,
    prompt: `Calculate:   √${r1.sq} + ${offset}`,
    category: "Roots",
    answer,
  };
}

// 6. Number Sequences (Reasoning)
function genSequence(rng: () => number, id: number): MathQuestion {
  const type = randomInt(rng, 1, 3);
  if (type === 1) {
    // 2x + 1 or 2x - 1
    const start = randomInt(rng, 2, 5);
    const seq = [start];
    for (let i = 0; i < 3; i++) {
      seq.push(seq[seq.length - 1] * 2 + 1);
    }
    const answer = seq[seq.length - 1] * 2 + 1;
    return {
      id,
      prompt: `Next number in sequence:   ${seq.join(", ")},  ?`,
      category: "Sequences",
      answer,
    };
  } else if (type === 2) {
    // Increasing differences: +3, +5, +7, +9, +11
    const start = randomInt(rng, 1, 5);
    let cur = start;
    let diff = randomInt(rng, 2, 4);
    const stepDiff = 2;
    const seq = [cur];
    for (let i = 0; i < 4; i++) {
      cur += diff;
      diff += stepDiff;
      seq.push(cur);
    }
    const answer = cur + diff;
    return {
      id,
      prompt: `Next number in sequence:   ${seq.join(", ")},  ?`,
      category: "Sequences",
      answer,
    };
  } else {
    // n * (n + 1): 2, 6, 12, 20, 30, ? -> 42
    const n = randomInt(rng, 1, 3);
    const seq = [];
    for (let i = n; i < n + 5; i++) {
      seq.push(i * (i + 1));
    }
    const answer = (n + 5) * (n + 6);
    return {
      id,
      prompt: `Next number in sequence:   ${seq.join(", ")},  ?`,
      category: "Sequences",
      answer,
    };
  }
}

// 7. Missing Average Value
function genAverage(rng: () => number, id: number): MathQuestion {
  // Average of 4 numbers is target
  const target = randomInt(rng, 18, 35);
  const n1 = target - randomInt(rng, 4, 9);
  const n2 = target + randomInt(rng, 3, 8);
  const n3 = target - randomInt(rng, 2, 6);
  // target * 4 = n1 + n2 + n3 + x
  const x = target * 4 - (n1 + n2 + n3);
  return {
    id,
    prompt: `If the average of ${n1}, ${n2}, ${n3}, and x is ${target}, find x:`,
    category: "Averages",
    answer: x,
  };
}

// 8. Remainder / Modular Arithmetic
function genModulo(rng: () => number, id: number): MathQuestion {
  const divisor = randomInt(rng, 6, 9);
  const mult = randomInt(rng, 14, 28);
  const rem = randomInt(rng, 1, divisor - 1);
  const num = mult * divisor + rem;
  return {
    id,
    prompt: `Find the remainder when ${num} is divided by ${divisor}:`,
    category: "Modular Arithmetic",
    answer: rem,
  };
}

// 9. Fraction proportions of integers
function genFraction(rng: () => number, id: number): MathQuestion {
  const denominators = [6, 7, 8, 9, 12];
  const d = denominators[randomInt(rng, 0, denominators.length - 1)];
  const n = randomInt(rng, 2, d - 1);
  const multiplier = randomInt(rng, 7, 16);
  const total = d * multiplier;
  const answer = n * multiplier;
  return {
    id,
    prompt: `Calculate:   ${n}/${d} of ${total}`,
    category: "Fractions & Proportions",
    answer,
  };
}

// 10. Practical Mental Rate / Proportion
function genRateProblem(rng: () => number, id: number): MathQuestion {
  const variant = randomInt(rng, 1, 2);
  if (variant === 1) {
    // Workers inverse proportion: A workers take B hours. How many hours for C workers?
    // e.g. 3 workers take 12 hours -> 36 total worker-hours. 4 workers -> 9 hours.
    const w1 = randomInt(rng, 2, 4);
    const w2 = w1 + randomInt(rng, 1, 2);
    const mult = randomInt(rng, 2, 5);
    const hours1 = w2 * mult;
    const hours2 = (w1 * hours1) / w2;
    return {
      id,
      prompt: `${w1} workers build a wall in ${hours1} hours. How many hours would it take ${w2} workers at the same rate?`,
      category: "Rates & Proportions",
      answer: hours2,
    };
  } else {
    // Speed, distance, time: traveling at 75 km/h for 1 hr 20 min -> 100 km
    const speeds = [60, 75, 90];
    const sp = speeds[randomInt(rng, 0, speeds.length - 1)];
    // 1 hr 20 min (4/3) or 1 hr 40 min (5/3) or 1 hr 30 min (3/2)
    if (sp === 75 || sp === 90 || sp === 60) {
      // 1 hr 20 min = 80 min = 4/3 hours
      const dist = Math.round((sp * 4) / 3);
      return {
        id,
        prompt: `A car travels at ${sp} km/h. How many km does it travel in 1 hour and 20 minutes?`,
        category: "Speed & Distance",
        answer: dist,
      };
    }
    return {
      id,
      prompt: `A store offers 20% off. If an item costs $96 on sale, what was its original price?`,
      category: "Percentages",
      answer: 120,
    };
  }
}

/**
 * Generate 10 deterministic questions from the daily seed.
 */
export function generateMathQuestions(seed: string): MathQuestion[] {
  const rng = createPRNG(`${seed}:questions`);

  const generators = [
    genLinearEquation,
    genDistributive,
    genPercentage,
    genDifferenceOfSquares,
    genRootsAndPowers,
    genSequence,
    genAverage,
    genModulo,
    genFraction,
    genRateProblem,
  ];

  return generators.map((gen, idx) => gen(rng, idx + 1));
}

export class MathSprintEngine
  implements GameEngine<MathInput, MathState, MathSummary>
{
  readonly gameId = "math";
  readonly name = "Mental Math Sprint";
  readonly description =
    "Solve 10 mental math challenges as fast as possible without a calculator.";
  readonly targetDescription = "Answer all 10 questions correctly";

  init(seed: string): MathState {
    const questions = generateMathQuestions(seed);
    return {
      questions,
      currentIndex: 0,
      score: 0,
      mistakes: 0,
      completed: false,
    };
  }

  step(
    state: MathState,
    input?: MathInput
  ): {
    state: MathState;
    win: boolean;
    gameOver: boolean;
    correct: boolean;
  } {
    if (!input || state.completed) {
      return {
        state,
        win: state.completed,
        gameOver: false,
        correct: false,
      };
    }

    const currentQ = state.questions[state.currentIndex];
    if (!currentQ || input.questionIndex !== state.currentIndex) {
      return {
        state,
        win: false,
        gameOver: false,
        correct: false,
      };
    }

    const isCorrect = input.answer === currentQ.answer;

    if (isCorrect) {
      const nextIndex = state.currentIndex + 1;
      const isCompleted = nextIndex >= state.questions.length;
      const nextState: MathState = {
        ...state,
        currentIndex: nextIndex,
        score: state.score + 100,
        completed: isCompleted,
      };

      return {
        state: nextState,
        win: isCompleted,
        gameOver: false,
        correct: true,
      };
    } else {
      // Mistake: player stays on current question to correct it immediately
      const nextState: MathState = {
        ...state,
        mistakes: state.mistakes + 1,
      };

      return {
        state: nextState,
        win: false,
        gameOver: false,
        correct: false,
      };
    }
  }

  verify(
    seed: string,
    inputs: TimestampedInput<MathInput>[],
    claimedTimeMs: number
  ): VerificationResult<MathSummary> {
    if (!Array.isArray(inputs) || inputs.length < 10) {
      return {
        valid: false,
        reason: "Fewer than 10 submitted answers for a 10-question sprint",
      };
    }

    if (inputs.length > 1000) {
      return { valid: false, reason: "Too many answer attempts" };
    }

    if (typeof claimedTimeMs !== "number" || !Number.isFinite(claimedTimeMs) || claimedTimeMs <= 0) {
      return { valid: false, reason: "Invalid claimed time" };
    }

    const questions = generateMathQuestions(seed);
    let currentIndex = 0;
    let mistakes = 0;
    let lastCorrectTimeMs = 0;
    let previousTime = -1;

    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      if (!input) {
        return { valid: false, reason: "Invalid input entry" };
      }
      const { t, action } = input;

      if (typeof t !== "number" || !Number.isFinite(t) || t < 0) {
        return { valid: false, reason: "Invalid input timestamp" };
      }

      if (t < previousTime) {
        return { valid: false, reason: "Timestamps must be non-decreasing" };
      }
      previousTime = t;

      if (
        !action ||
        typeof action.answer !== "number" ||
        !Number.isFinite(action.answer) ||
        !Number.isInteger(action.questionIndex)
      ) {
        return { valid: false, reason: "Missing or invalid question answer" };
      }

      if (action.questionIndex !== currentIndex) {
        return {
          valid: false,
          reason: `Out of sequence: expected question ${currentIndex}, got ${action.questionIndex}`,
        };
      }

      const expectedAnswer = questions[currentIndex].answer;
      if (action.answer === expectedAnswer) {
        lastCorrectTimeMs = t;
        currentIndex++;
        if (currentIndex === 10) break;
      } else {
        mistakes++;
      }
    }

    if (currentIndex < 10) {
      return {
        valid: false,
        reason: `Completed only ${currentIndex} of 10 questions`,
      };
    }

    // Physical speed sanity check: Minimum 1.5 seconds total for 10 math questions (<150ms/q is inhuman botting)
    if (lastCorrectTimeMs < 1500) {
      return {
        valid: false,
        reason: "Time exceeds physical human cognitive speed limits (< 1.5s total)",
      };
    }

    const tolerance = 500; // 500ms browser submission drift tolerance
    if (Math.abs(claimedTimeMs - lastCorrectTimeMs) > tolerance) {
      return {
        valid: false,
        reason: `Claimed time (${claimedTimeMs}ms) drifts from verified time (${lastCorrectTimeMs}ms)`,
      };
    }

    const totalAttempts = inputs.length;
    const accuracyPercent = Math.round((10 / totalAttempts) * 100);

    return {
      valid: true,
      verifiedTimeMs: lastCorrectTimeMs,
      summary: {
        questionsCount: 10,
        totalAttempts,
        mistakes,
        accuracyPercent,
      },
    };
  }
}
