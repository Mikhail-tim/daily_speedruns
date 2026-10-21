import { createPRNG, randomInt } from "../prng.js";
import {
  GameEngine,
  TimestampedInput,
  VerificationResult,
} from "../types.js";
import { WORDLE_WORDS, VALID_WORDS_SET } from "./wordle/words.js";

export type LetterEvaluation = "correct" | "present" | "absent";

export interface WordleState {
  targetWord: string;
  guesses: string[];
  evaluations: LetterEvaluation[][];
  letterStatuses: Record<string, LetterEvaluation>;
  isWin: boolean;
  isGameOver: boolean;
  maxGuesses: number;
}

export interface WordleSummary {
  guessesCount: number;
  solvedWord: string;
}

/**
 * Standard Wordle evaluation algorithm.
 * Correctly handles duplicate letters:
 * 1. Mark exact matches (green / 'correct') and count remaining available letters.
 * 2. Mark remaining letters as yellow / 'present' up to available pool, otherwise gray / 'absent'.
 */
export function evaluateWordleGuess(
  guess: string,
  target: string
): LetterEvaluation[] {
  const result: LetterEvaluation[] = new Array(5).fill("absent");
  const targetChars = target.split("");
  const guessChars = guess.split("");
  const letterPool: Record<string, number> = {};

  // Count target letters
  for (const ch of targetChars) {
    letterPool[ch] = (letterPool[ch] || 0) + 1;
  }

  // Pass 1: Exact matches ('correct')
  for (let i = 0; i < 5; i++) {
    if (guessChars[i] === targetChars[i]) {
      result[i] = "correct";
      letterPool[guessChars[i]]--;
    }
  }

  // Pass 2: Present in other positions ('present')
  for (let i = 0; i < 5; i++) {
    if (result[i] !== "correct") {
      const ch = guessChars[i];
      if (letterPool[ch] && letterPool[ch] > 0) {
        result[i] = "present";
        letterPool[ch]--;
      } else {
        result[i] = "absent";
      }
    }
  }

  return result;
}

export class WordleGameEngine
  implements GameEngine<string, WordleState, WordleSummary>
{
  readonly gameId = "wordle";
  readonly name = "Wordle Sprint";
  readonly description = "Solve today's secret 5-letter word in 6 guesses or fewer as fast as possible.";
  readonly targetDescription = "Find the 5-letter word";

  init(seed: string): WordleState {
    const rng = createPRNG(seed);
    const index = randomInt(rng, 0, WORDLE_WORDS.length - 1);
    const targetWord = WORDLE_WORDS[index];

    return {
      targetWord,
      guesses: [],
      evaluations: [],
      letterStatuses: {},
      isWin: false,
      isGameOver: false,
      maxGuesses: 6,
    };
  }

  step(
    state: WordleState,
    action?: string
  ): { state: WordleState; win: boolean; gameOver: boolean; error?: string } {
    if (state.isWin || state.isGameOver) {
      return { state, win: state.isWin, gameOver: state.isGameOver };
    }

    if (!action || typeof action !== "string") {
      return { state, win: state.isWin, gameOver: state.isGameOver };
    }

    const guess = action.toUpperCase().trim();

    if (guess.length !== 5) {
      return { state, win: false, gameOver: false, error: "Must be a 5-letter word" };
    }

    if (!VALID_WORDS_SET.has(guess)) {
      return { state, win: false, gameOver: false, error: "Word not in dictionary" };
    }

    const evaluation = evaluateWordleGuess(guess, state.targetWord);
    const newGuesses = [...state.guesses, guess];
    const newEvaluations = [...state.evaluations, evaluation];

    // Update keyboard letter coloring
    const newLetterStatuses = { ...state.letterStatuses };
    for (let i = 0; i < 5; i++) {
      const letter = guess[i];
      const evalStatus = evaluation[i];
      const prevStatus = newLetterStatuses[letter];

      // Green overrides yellow/gray; yellow overrides gray
      if (evalStatus === "correct" || !prevStatus) {
        newLetterStatuses[letter] = evalStatus;
      } else if (evalStatus === "present" && prevStatus !== "correct") {
        newLetterStatuses[letter] = "present";
      }
    }

    const isWin = guess === state.targetWord;
    const isGameOver = isWin || newGuesses.length >= state.maxGuesses;

    const nextState: WordleState = {
      ...state,
      guesses: newGuesses,
      evaluations: newEvaluations,
      letterStatuses: newLetterStatuses,
      isWin,
      isGameOver,
    };

    return {
      state: nextState,
      win: isWin,
      gameOver: isGameOver,
    };
  }

  verify(
    seed: string,
    inputs: TimestampedInput<string>[],
    claimedTimeMs: number
  ): VerificationResult<WordleSummary> {
    if (!claimedTimeMs || claimedTimeMs <= 0) {
      return { valid: false, reason: "Invalid claimed time" };
    }

    if (!Array.isArray(inputs) || inputs.length === 0) {
      return { valid: false, reason: "Inputs must be a non-empty array of guesses" };
    }

    if (inputs.length > 6) {
      return { valid: false, reason: "Exceeded maximum allowed 6 guesses" };
    }

    // Verify timestamp monotonicity
    for (let i = 0; i < inputs.length; i++) {
      const inp = inputs[i];
      if (typeof inp.t !== "number" || inp.t < 0) {
        return { valid: false, reason: `Invalid timestamp at guess ${i + 1}` };
      }
      if (i > 0 && inp.t < inputs[i - 1].t) {
        return { valid: false, reason: "Timestamps must be non-decreasing" };
      }
      if (typeof inp.action !== "string" || inp.action.length !== 5) {
        return { valid: false, reason: `Invalid guess format at guess ${i + 1}` };
      }
    }

    let state = this.init(seed);

    for (let i = 0; i < inputs.length; i++) {
      const inp = inputs[i];
      const stepRes = this.step(state, inp.action);

      if (stepRes.error) {
        return {
          valid: false,
          reason: `Guess #${i + 1} ('${inp.action}') failed: ${stepRes.error}`,
        };
      }

      state = stepRes.state;

      if (stepRes.win) {
        // Winning guess must have occurred at or before claimed time
        const winningGuessTimeMs = inp.t;
        const drift = Math.abs(claimedTimeMs - winningGuessTimeMs);

        // Allow reasonable client clock variance (e.g. 500ms)
        if (drift > 500) {
          return {
            valid: false,
            reason: `Claimed time (${claimedTimeMs}ms) drifted excessively from final guess time (${winningGuessTimeMs}ms)`,
          };
        }

        return {
          valid: true,
          verifiedTimeMs: winningGuessTimeMs,
          summary: {
            guessesCount: state.guesses.length,
            solvedWord: state.targetWord,
          },
        };
      }
    }

    return {
      valid: false,
      reason: `Wordle secret word was not solved within ${inputs.length} guesses`,
    };
  }
}
