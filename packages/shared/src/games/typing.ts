import { createPRNG, randomInt } from "../prng.js";
import {
  GameEngine,
  TimestampedInput,
  VerificationResult,
} from "../types.js";
import { TYPING_PARAGRAPHS } from "./typing/texts.js";

export interface TypingState {
  targetText: string;
  typedBuffer: string;
  cursorIndex: number;
  errorCount: number;
  totalKeystrokes: number;
  isWin: boolean;
  isGameOver: boolean;
  wpm?: number;
  accuracy?: number;
}

export interface TypingSummary {
  wpm: number;
  accuracy: number;
  charactersCount: number;
  errorCount: number;
}

export class TypingGameEngine
  implements GameEngine<string, TypingState, TypingSummary>
{
  readonly gameId = "typing";
  readonly name = "Typing Sprint";
  readonly description = "Type today's quote accurately and as fast as humanly possible.";
  readonly targetDescription = "Type the full paragraph";

  init(seed: string): TypingState {
    const rng = createPRNG(seed);
    const index = randomInt(rng, 0, TYPING_PARAGRAPHS.length - 1);
    const targetText = TYPING_PARAGRAPHS[index];

    return {
      targetText,
      typedBuffer: "",
      cursorIndex: 0,
      errorCount: 0,
      totalKeystrokes: 0,
      isWin: false,
      isGameOver: false,
    };
  }

  step(
    state: TypingState,
    action?: string
  ): { state: TypingState; win: boolean; gameOver: boolean; error?: string } {
    if (state.isWin || state.isGameOver) {
      return { state, win: state.isWin, gameOver: state.isGameOver };
    }

    if (!action || typeof action !== "string") {
      return { state, win: state.isWin, gameOver: state.isGameOver };
    }

    let buffer = state.typedBuffer;
    let errors = state.errorCount;
    let totalKeys = state.totalKeystrokes + 1;

    if (action === "BACKSPACE") {
      buffer = buffer.slice(0, -1);
    } else {
      const expectedChar = state.targetText[buffer.length];
      if (action !== expectedChar) {
        errors++;
      }
      buffer += action;
    }

    const isWin = buffer === state.targetText;

    const nextState: TypingState = {
      ...state,
      typedBuffer: buffer,
      cursorIndex: buffer.length,
      errorCount: errors,
      totalKeystrokes: totalKeys,
      isWin,
      isGameOver: false,
    };

    return {
      state: nextState,
      win: isWin,
      gameOver: false,
    };
  }

  verify(
    seed: string,
    inputs: TimestampedInput<string>[],
    claimedTimeMs: number
  ): VerificationResult<TypingSummary> {
    if (!claimedTimeMs || claimedTimeMs <= 0) {
      return { valid: false, reason: "Invalid claimed time" };
    }

    if (!Array.isArray(inputs) || inputs.length === 0) {
      return { valid: false, reason: "Inputs must be a non-empty array of keystrokes" };
    }

    // Monotonicity check
    for (let i = 0; i < inputs.length; i++) {
      const inp = inputs[i];
      if (typeof inp.t !== "number" || inp.t < 0) {
        return { valid: false, reason: `Invalid timestamp at keystroke ${i + 1}` };
      }
      if (i > 0 && inp.t < inputs[i - 1].t) {
        return { valid: false, reason: "Keystroke timestamps must be non-decreasing" };
      }
      if (typeof inp.action !== "string") {
        return { valid: false, reason: `Invalid keystroke action at index ${i}` };
      }
    }

    let state = this.init(seed);
    const targetLength = state.targetText.length;

    // Human typing speed limits
    // Words = characters / 5. Minutes = claimedTimeMs / 60000.
    const minutes = claimedTimeMs / 60000;
    const wordCount = targetLength / 5;
    const wpm = Math.round(wordCount / minutes);

    // World record cap: no human legitimately exceeds ~260 WPM
    if (wpm > 260) {
      return {
        valid: false,
        reason: `Calculated speed (${wpm} WPM) exceeds physical human limits (max 260 WPM)`,
      };
    }

    // Minimum time per character sanity check (prevent bot bursts)
    if (inputs.length > 10 && claimedTimeMs < inputs.length * 20) {
      return {
        valid: false,
        reason: "Keystroke cadence is too fast to be human",
      };
    }

    // Replay keystrokes
    for (let i = 0; i < inputs.length; i++) {
      const inp = inputs[i];
      const res = this.step(state, inp.action);
      state = res.state;

      if (res.win) {
        const lastKeystrokeTime = inp.t;
        const drift = Math.abs(claimedTimeMs - lastKeystrokeTime);

        if (drift > 500) {
          return {
            valid: false,
            reason: `Claimed time (${claimedTimeMs}ms) drifted excessively from final keystroke (${lastKeystrokeTime}ms)`,
          };
        }

        const accuracy = Math.max(
          0,
          Math.min(
            100,
            Math.round(
              ((targetLength - state.errorCount) / Math.max(targetLength, state.totalKeystrokes)) *
                100
            )
          )
        );

        return {
          valid: true,
          verifiedTimeMs: lastKeystrokeTime,
          summary: {
            wpm,
            accuracy,
            charactersCount: targetLength,
            errorCount: state.errorCount,
          },
        };
      }
    }

    return {
      valid: false,
      reason: "Paragraph text was not completely and accurately typed",
    };
  }
}
