import {
  GameEngine,
  TimestampedInput,
  VerificationResult,
} from "../types.js";
import { createPRNG, randomInt } from "../prng.js";
import {
  CAPTCHA_ASSET_BASE,
  CAPTCHA_CATEGORY_ASSETS,
  CAPTCHA_DISTRACTOR_ASSETS,
} from "./captcha-manifest.js";

/**
 * Authentic reCAPTCHA v2 "Type A" challenge model.
 *
 * Google serves two flavours of the 3x3 visual challenge:
 *  - STATIC:  all matching tiles must be selected in one pass.
 *  - DYNAMIC: every matching tile is swapped for a new image as soon as it is
 *             clicked, and the player verifies once no matches are left
 *             ("Click verify once there are none left").
 *
 * Both flavours are deterministic here: the daily seed decides the category,
 * the grid, and the replacement queue, so the server can replay every click.
 */

export type CaptchaMode = "static" | "dynamic";

export type CaptchaCategoryKey =
  | "bicycle"
  | "bridge"
  | "bus"
  | "car"
  | "chimney"
  | "crosswalk"
  | "fire_hydrant"
  | "motorcycle"
  | "mountain"
  | "palm_tree"
  | "traffic_light";

export interface CaptchaCategoryInfo {
  key: CaptchaCategoryKey;
  /** Singular noun, e.g. "fire hydrant". */
  displayName: string;
  /** Exact plural wording Google uses in the prompt. */
  pluralName: string;
}

/**
 * The categories Google actually asks about in reCAPTCHA v2 image challenges.
 * Wording mirrors the real prompts ("fire hydrants", "traffic lights", ...).
 */
export const CAPTCHA_CATEGORIES: CaptchaCategoryInfo[] = [
  { key: "bicycle", displayName: "bicycle", pluralName: "bicycles" },
  { key: "bridge", displayName: "bridge", pluralName: "bridges" },
  { key: "bus", displayName: "bus", pluralName: "buses" },
  { key: "car", displayName: "car", pluralName: "cars" },
  { key: "chimney", displayName: "chimney", pluralName: "chimneys" },
  { key: "crosswalk", displayName: "crosswalk", pluralName: "crosswalks" },
  { key: "fire_hydrant", displayName: "fire hydrant", pluralName: "fire hydrants" },
  { key: "motorcycle", displayName: "motorcycle", pluralName: "motorcycles" },
  { key: "mountain", displayName: "mountain or hill", pluralName: "mountains or hills" },
  { key: "palm_tree", displayName: "palm tree", pluralName: "palm trees" },
  { key: "traffic_light", displayName: "traffic light", pluralName: "traffic lights" },
];

export const CAPTCHA_GRID_SIZE = 3;

export interface CaptchaTile {
  index: number;
  /** Unique per tile instance; changes when a dynamic tile is refreshed. */
  id: string;
  /** Manifest-relative asset path, e.g. "bicycle/001.png". */
  asset: string;
  imageSrc: string;
  alt: string;
  /** Ground truth used by the deterministic verifier. */
  isTarget: boolean;
  /** True once a dynamic challenge has swapped this tile out. */
  replaced?: boolean;
}

export interface CaptchaChallenge {
  category: CaptchaCategoryKey;
  /** Plural wording shown in the header, e.g. "fire hydrants". */
  categoryDisplayName: string;
  /** "Select all images with" / "Select all squares with". */
  promptPrefix: string;
  /** Full instruction, e.g. "Select all images with fire hydrants". */
  prompt: string;
  mode: CaptchaMode;
  gridSize: number;
  sampleImageSrc: string;
  tiles: CaptchaTile[];
  /** Initial matching positions (0-indexed). */
  targetIndices: number[];
  /** Dynamic mode only: deterministic queue of replacement tiles. */
  replacements: string[];
}

export interface CaptchaState {
  challenge: CaptchaChallenge;
  selectedIndices: number[];
  /** Dynamic mode: tiles that were matched and swapped out. */
  solvedIndices: number[];
  remainingTargets: number;
  mistakes: number;
  completed: boolean;
}

export interface CaptchaAction {
  type: "TOGGLE" | "VERIFY";
  index?: number;
}

export interface CaptchaSummary {
  category: string;
  mode: CaptchaMode;
  gridSize: number;
  mistakes: number;
  totalClicks: number;
  selectedCount: number;
}

function toImageSrc(asset: string): string {
  return `${CAPTCHA_ASSET_BASE}/${asset}`;
}

function shuffle<T>(rng: () => number, items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function categoriesWithAssets(): CaptchaCategoryInfo[] {
  return CAPTCHA_CATEGORIES.filter(
    (category) => (CAPTCHA_CATEGORY_ASSETS[category.key] ?? []).length >= 4
  );
}

/**
 * Deterministically generates today's authentic 3x3 reCAPTCHA challenge.
 */
export function generateCaptchaChallenge(seed: string): CaptchaChallenge {
  const rng = createPRNG(`${seed}:captcha:v2`);

  const availableCategories = categoriesWithAssets();
  if (availableCategories.length === 0) {
    throw new Error("No captcha assets available. Run `npm run captcha:fetch`.");
  }

  if (CAPTCHA_DISTRACTOR_ASSETS.length < 8) {
    throw new Error("Not enough captcha distractor tiles. Run `npm run captcha:fetch`.");
  }

  // 1. Authentic variant: static grid, or dynamic grid where matches refresh.
  const mode: CaptchaMode = rng() < 0.45 ? "dynamic" : "static";

  // 2. Target category.
  const category =
    availableCategories[randomInt(rng, 0, availableCategories.length - 1)];

  // Real prompts alternate between "images" and "squares".
  const promptPrefix =
    rng() < 0.72 ? "Select all images with" : "Select all squares with";

  const targetPool = CAPTCHA_CATEGORY_ASSETS[category.key];
  const maxTargets = Math.min(
    4,
    targetPool.length,
    CAPTCHA_GRID_SIZE * CAPTCHA_GRID_SIZE - 3
  );
  const targetCount = randomInt(rng, 2, maxTargets);
  const targetAssets = shuffle(rng, targetPool).slice(0, targetCount);

  // 3. Fill the rest of the grid with real non-target street tiles.
  const neededDistractors = CAPTCHA_GRID_SIZE * CAPTCHA_GRID_SIZE - targetCount;
  // Dynamic mode also needs one replacement tile per match.
  const neededReplacements = mode === "dynamic" ? targetCount : 0;
  const distractorPool = shuffle(rng, CAPTCHA_DISTRACTOR_ASSETS);
  const gridDistractors = distractorPool.slice(0, neededDistractors);
  const replacements = distractorPool.slice(
    neededDistractors,
    neededDistractors + neededReplacements
  );

  // 4. Combine and deterministically shuffle all nine cells.
  const cells = shuffle(rng, [
    ...targetAssets.map((asset) => ({ asset, isTarget: true })),
    ...gridDistractors.map((asset) => ({ asset, isTarget: false })),
  ]);

  const targetIndices: number[] = [];
  const tiles: CaptchaTile[] = cells.map((cell, index) => {
    if (cell.isTarget) targetIndices.push(index);
    return {
      index,
      id: `${index}:${cell.asset}`,
      asset: cell.asset,
      imageSrc: toImageSrc(cell.asset),
      alt: `Captcha tile ${index + 1}`,
      isTarget: cell.isTarget,
    };
  });

  return {
    category: category.key,
    categoryDisplayName: category.pluralName,
    promptPrefix,
    prompt: `${promptPrefix} ${category.pluralName}`,
    mode,
    gridSize: CAPTCHA_GRID_SIZE,
    sampleImageSrc: toImageSrc(targetAssets[0]),
    tiles,
    targetIndices: targetIndices.sort((a, b) => a - b),
    replacements,
  };
}

export class CaptchaEngine
  implements GameEngine<CaptchaAction, CaptchaState, CaptchaSummary>
{
  readonly gameId = "captcha";
  readonly name = "reCAPTCHA Sprint";
  readonly description =
    "Solve a real 3x3 reCAPTCHA challenge — fire hydrants, bicycles, traffic lights and more — as fast as possible.";
  readonly targetDescription =
    "Select every matching image, then click VERIFY";

  init(seed: string): CaptchaState {
    const challenge = generateCaptchaChallenge(seed);
    return {
      challenge,
      selectedIndices: [],
      solvedIndices: [],
      remainingTargets: challenge.targetIndices.length,
      mistakes: 0,
      completed: false,
    };
  }

  step(
    state: CaptchaState,
    action?: CaptchaAction
  ): {
    state: CaptchaState;
    win: boolean;
    gameOver: boolean;
    correct?: boolean;
  } {
    if (!action || state.completed) {
      return { state, win: state.completed, gameOver: false };
    }

    const { challenge } = state;

    if (action.type === "TOGGLE") {
      const idx = action.index;
      if (
        typeof idx !== "number" ||
        !Number.isInteger(idx) ||
        idx < 0 ||
        idx >= challenge.tiles.length
      ) {
        return { state, win: false, gameOver: false };
      }

      const tile = challenge.tiles[idx];

      // Dynamic reCAPTCHA: matching tiles disappear and are replaced by a
      // fresh street-view image instead of staying selected.
      if (challenge.mode === "dynamic" && tile.isTarget) {
        const replacement =
          challenge.replacements[state.solvedIndices.length] ??
          CAPTCHA_DISTRACTOR_ASSETS[0];
        const tiles = challenge.tiles.map((current, i) =>
          i === idx
            ? {
                ...current,
                id: `${idx}:${replacement}`,
                asset: replacement,
                imageSrc: toImageSrc(replacement),
                isTarget: false,
                replaced: true,
              }
            : current
        );

        return {
          state: {
            ...state,
            challenge: { ...challenge, tiles },
            selectedIndices: state.selectedIndices.filter((i) => i !== idx),
            solvedIndices: [...state.solvedIndices, idx],
            remainingTargets: Math.max(0, state.remainingTargets - 1),
          },
          win: false,
          gameOver: false,
          correct: true,
        };
      }

      const isSelected = state.selectedIndices.includes(idx);
      const selectedIndices = isSelected
        ? state.selectedIndices.filter((i) => i !== idx)
        : [...state.selectedIndices, idx].sort((a, b) => a - b);

      return {
        state: { ...state, selectedIndices },
        win: false,
        gameOver: false,
      };
    }

    if (action.type === "VERIFY") {
      const targetSet = new Set(challenge.targetIndices);
      const selectedSet = new Set(state.selectedIndices);

      // Static: the exact matching set must be selected.
      // Dynamic: every match must have been swapped out, and no leftovers
      // (wrongly selected distractor tiles) may remain selected.
      const isMatch =
        challenge.mode === "dynamic"
          ? state.remainingTargets === 0 && state.selectedIndices.length === 0
          : targetSet.size === selectedSet.size &&
            [...targetSet].every((value) => selectedSet.has(value));

      if (isMatch) {
        return {
          state: { ...state, completed: true },
          win: true,
          gameOver: false,
          correct: true,
        };
      }

      return {
        state: { ...state, mistakes: state.mistakes + 1 },
        win: false,
        gameOver: false,
        correct: false,
      };
    }

    return { state, win: false, gameOver: false };
  }

  verify(
    seed: string,
    inputs: TimestampedInput<CaptchaAction>[],
    claimedTimeMs: number
  ): VerificationResult<CaptchaSummary> {
    if (!Array.isArray(inputs) || inputs.length === 0) {
      return { valid: false, reason: "No actions recorded" };
    }

    if (inputs.length > 200) {
      return { valid: false, reason: "Too many actions" };
    }

    const challenge = generateCaptchaChallenge(seed);
    let state = this.init(seed);
    let finishTimeMs = -1;
    let previousTime = -1;

    for (const input of inputs) {
      if (
        !input ||
        typeof input.t !== "number" ||
        !Number.isFinite(input.t) ||
        input.t < 0
      ) {
        return { valid: false, reason: "Invalid timestamp" };
      }

      if (input.t < previousTime) {
        return { valid: false, reason: "Timestamps must be non-decreasing" };
      }
      previousTime = input.t;

      const action = input.action;
      if (!action || (action.type !== "TOGGLE" && action.type !== "VERIFY")) {
        return { valid: false, reason: "Invalid or missing action" };
      }

      if (
        action.type === "TOGGLE" &&
        (typeof action.index !== "number" ||
          !Number.isInteger(action.index) ||
          action.index < 0 ||
          action.index >= challenge.tiles.length)
      ) {
        return { valid: false, reason: "Invalid tile index" };
      }

      const result = this.step(state, action);
      state = result.state;

      if (result.win) {
        finishTimeMs = input.t;
        break;
      }
    }

    if (finishTimeMs < 0) {
      return {
        valid: false,
        reason: "Captcha was not successfully verified with matching tiles",
      };
    }

    // Minimum cognitive/click time sanity check (at least 300ms total)
    if (finishTimeMs < 300) {
      return {
        valid: false,
        reason: "Completion time exceeds physical human cognitive speed limits (< 300ms)",
      };
    }

    const tolerance = 400; // 400ms tolerance
    if (Math.abs(claimedTimeMs - finishTimeMs) > tolerance) {
      return {
        valid: false,
        reason: `Claimed time (${claimedTimeMs}ms) drifts from verified finish time (${finishTimeMs}ms)`,
      };
    }

    return {
      valid: true,
      verifiedTimeMs: finishTimeMs,
      summary: {
        category: challenge.categoryDisplayName,
        mode: challenge.mode,
        gridSize: challenge.gridSize,
        mistakes: state.mistakes,
        totalClicks: inputs.length,
        selectedCount: challenge.targetIndices.length,
      },
    };
  }
}
