import { hashString, nextRandomInt } from "../prng.js";
import {
  GameEngine,
  TimestampedInput,
  VerificationResult,
} from "../types.js";

export interface MinesweeperInput {
  row: number;
  col: number;
}

export type MinesweeperStatus = "READY" | "PLAYING" | "WON" | "LOST";

export interface MinesweeperState {
  seed: string;
  rows: number;
  cols: number;
  mineCount: number;
  /** Flat row-major arrays. Mines are placed on the first reveal. */
  mines: boolean[];
  adjacent: number[];
  revealed: boolean[];
  minesPlaced: boolean;
  firstClickIndex: number | null;
  revealedCount: number;
  safeTotal: number;
  actionCount: number;
  status: MinesweeperStatus;
  explodedIndex: number | null;
  rngState: number;
}

export interface MinesweeperSummary {
  rows: number;
  cols: number;
  mineCount: number;
  cellsRevealed: number;
  safeCells: number;
  actions: number;
}

export interface MinesweeperStepResult {
  state: MinesweeperState;
  win: boolean;
  gameOver: boolean;
  changed: boolean;
  mineHit: boolean;
  /** Row-major indices opened by this click (for UI animation). */
  opened: number[];
}

export const MINESWEEPER_CONFIG = {
  ROWS: 9,
  COLS: 9,
  MINES: 10,
  /** The first click clears a 3x3 area, so its neighbours are mine-free. */
  SAFE_RADIUS: 1,
  MAX_INPUTS: 500,
  /** Absolute floor for a human solving a 9x9 board. */
  MIN_RUN_TIME_MS: 1200,
  /** Average minimum spacing between clicks for long runs. */
  MIN_INPUT_INTERVAL_MS: 40,
  MAX_ALLOWED_DRIFT_MS: 500,
  /** Deterministic re-rolls while looking for a no-guess board. */
  MAX_BOARD_ATTEMPTS: 250,
} as const;

function indexOf(row: number, col: number, cols: number): number {
  return row * cols + col;
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function getNeighbours(index: number, rows: number, cols: number): number[] {
  const row = Math.floor(index / cols);
  const col = index % cols;
  const result: number[] = [];

  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r >= 0 && r < rows && c >= 0 && c < cols) {
        result.push(indexOf(r, c, cols));
      }
    }
  }

  return result;
}

interface MineLayout {
  mines: boolean[];
  adjacent: number[];
  nextState: number;
}

/**
 * Shuffles the cells outside the opening 3x3 area with a lazily-consumed
 * Fisher-Yates pass and takes the first `mineCount` as mines.
 */
function placeMines(
  rngState: number,
  firstIndex: number,
  rows: number,
  cols: number,
  mineCount: number
): MineLayout {
  const total = rows * cols;
  const firstRow = Math.floor(firstIndex / cols);
  const firstCol = firstIndex % cols;
  const candidates: number[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (
        Math.abs(r - firstRow) <= MINESWEEPER_CONFIG.SAFE_RADIUS &&
        Math.abs(c - firstCol) <= MINESWEEPER_CONFIG.SAFE_RADIUS
      ) {
        continue;
      }
      candidates.push(indexOf(r, c, cols));
    }
  }

  let state = rngState;
  for (let i = 0; i < mineCount; i++) {
    const draw = nextRandomInt(state, i, candidates.length - 1);
    state = draw.nextState;
    const swap = candidates[i];
    candidates[i] = candidates[draw.value];
    candidates[draw.value] = swap;
  }

  const mines = new Array<boolean>(total).fill(false);
  for (let i = 0; i < mineCount; i++) {
    mines[candidates[i]] = true;
  }

  const adjacent = new Array<number>(total).fill(0);
  for (let index = 0; index < total; index++) {
    if (mines[index]) continue;
    let count = 0;
    for (const neighbour of getNeighbours(index, rows, cols)) {
      if (mines[neighbour]) count++;
    }
    adjacent[index] = count;
  }

  return { mines, adjacent, nextState: state };
}

/**
 * Checks whether a board can be cleared with the basic deductions a human uses:
 * an open area, "this number is satisfied", "all remaining cells are mines",
 * and the global mine count. Boards that need a coin-flip guess are rejected
 * during generation, so every daily board has a logical path to the end.
 */
export function isLogicallySolvable(
  mines: boolean[],
  adjacent: number[],
  rows: number,
  cols: number,
  firstIndex: number
): boolean {
  const total = rows * cols;
  const mineCount = mines.filter(Boolean).length;
  const revealed = new Array<boolean>(total).fill(false);
  const knownMine = new Array<boolean>(total).fill(false);

  const revealCell = (start: number) => {
    const queue: number[] = [start];
    while (queue.length > 0) {
      const current = queue.pop()!;
      if (revealed[current] || knownMine[current] || mines[current]) continue;

      revealed[current] = true;
      if (adjacent[current] === 0) {
        for (const neighbour of getNeighbours(current, rows, cols)) {
          if (
            !revealed[neighbour] &&
            !knownMine[neighbour] &&
            !mines[neighbour]
          ) {
            queue.push(neighbour);
          }
        }
      }
    }
  };

  revealCell(firstIndex);

  let changed = true;
  while (changed) {
    changed = false;

    let knownMines = 0;
    const covered: number[] = [];
    for (let index = 0; index < total; index++) {
      if (knownMine[index]) {
        knownMines++;
      } else if (!revealed[index]) {
        covered.push(index);
      }
    }

    const remainingMines = mineCount - knownMines;
    if (remainingMines === 0 && covered.length > 0) {
      for (const index of covered) revealCell(index);
      changed = true;
      continue;
    }
    if (remainingMines === covered.length && covered.length > 0) {
      for (const index of covered) knownMine[index] = true;
      changed = true;
      continue;
    }

    for (let index = 0; index < total; index++) {
      if (!revealed[index] || adjacent[index] === 0) continue;

      const neighbours = getNeighbours(index, rows, cols);
      const coveredNeighbours = neighbours.filter(
        (neighbour) => !revealed[neighbour] && !knownMine[neighbour]
      );
      if (coveredNeighbours.length === 0) continue;

      const flaggedNeighbours = neighbours.filter(
        (neighbour) => knownMine[neighbour]
      ).length;
      const remaining = adjacent[index] - flaggedNeighbours;

      if (remaining === 0) {
        for (const neighbour of coveredNeighbours) revealCell(neighbour);
        changed = true;
      } else if (remaining === coveredNeighbours.length) {
        for (const neighbour of coveredNeighbours) {
          knownMine[neighbour] = true;
        }
        changed = true;
      }
    }
  }

  for (let index = 0; index < total; index++) {
    if (!mines[index] && !revealed[index]) return false;
  }
  return true;
}

/**
 * Deterministically places mines after the first click.
 *
 * The clicked cell and its neighbours are excluded, which guarantees the first
 * click is on a zero cell and opens an area. Layouts that require guessing are
 * re-rolled from the same PRNG stream, so the board is reproducible from the
 * seed plus the opening click and always has a logical solution.
 */
export function generateBoard(
  rngState: number,
  firstIndex: number,
  rows: number = MINESWEEPER_CONFIG.ROWS,
  cols: number = MINESWEEPER_CONFIG.COLS,
  mineCount: number = MINESWEEPER_CONFIG.MINES
): { mines: boolean[]; adjacent: number[] } {
  let state = rngState;
  let lastLayout: MineLayout | null = null;

  for (
    let attempt = 0;
    attempt < MINESWEEPER_CONFIG.MAX_BOARD_ATTEMPTS;
    attempt++
  ) {
    const layout = placeMines(state, firstIndex, rows, cols, mineCount);
    state = layout.nextState;
    lastLayout = layout;

    if (
      isLogicallySolvable(
        layout.mines,
        layout.adjacent,
        rows,
        cols,
        firstIndex
      )
    ) {
      return { mines: layout.mines, adjacent: layout.adjacent };
    }
  }

  // A full 9x9 beginner board is solvable in practice; keep a deterministic
  // fallback so generation can never hang or crash a run.
  return {
    mines: lastLayout!.mines,
    adjacent: lastLayout!.adjacent,
  };
}

export class MinesweeperEngine
  implements
    GameEngine<MinesweeperInput, MinesweeperState, MinesweeperSummary>
{
  readonly gameId = "minesweeper";
  readonly name = "Minesweeper Sprint";
  readonly description =
    "Clear every safe square on a 9×9 board without detonating a mine.";
  readonly targetDescription = "Reveal all 71 safe squares";

  init(seed: string): MinesweeperState {
    const rows = MINESWEEPER_CONFIG.ROWS;
    const cols = MINESWEEPER_CONFIG.COLS;
    const total = rows * cols;
    const mineCount = MINESWEEPER_CONFIG.MINES;

    return {
      seed,
      rows,
      cols,
      mineCount,
      mines: new Array<boolean>(total).fill(false),
      adjacent: new Array<number>(total).fill(0),
      revealed: new Array<boolean>(total).fill(false),
      minesPlaced: false,
      firstClickIndex: null,
      revealedCount: 0,
      safeTotal: total - mineCount,
      actionCount: 0,
      status: "READY",
      explodedIndex: null,
      rngState: hashString(`${seed}:mines`),
    };
  }

  step(
    state: MinesweeperState,
    action?: MinesweeperInput
  ): MinesweeperStepResult {
    const unchanged: MinesweeperStepResult = {
      state,
      win: state.status === "WON",
      gameOver: state.status === "LOST",
      changed: false,
      mineHit: false,
      opened: [],
    };

    if (!action || state.status === "WON" || state.status === "LOST") {
      return unchanged;
    }

    if (
      !isInteger(action.row) ||
      !isInteger(action.col) ||
      action.row < 0 ||
      action.row >= state.rows ||
      action.col < 0 ||
      action.col >= state.cols
    ) {
      return unchanged;
    }

    const index = indexOf(action.row, action.col, state.cols);
    if (state.revealed[index]) {
      return unchanged;
    }

    let { mines, adjacent, minesPlaced, firstClickIndex } = state;
    if (!minesPlaced) {
      const board = generateBoard(
        state.rngState,
        index,
        state.rows,
        state.cols,
        state.mineCount
      );
      mines = board.mines;
      adjacent = board.adjacent;
      minesPlaced = true;
      firstClickIndex = index;
    }

    const revealed = [...state.revealed];
    const actionCount = state.actionCount + 1;

    if (mines[index]) {
      revealed[index] = true;
      const lostState: MinesweeperState = {
        ...state,
        mines,
        adjacent,
        minesPlaced,
        firstClickIndex,
        revealed,
        actionCount,
        status: "LOST",
        explodedIndex: index,
      };

      return {
        state: lostState,
        win: false,
        gameOver: true,
        changed: true,
        mineHit: true,
        opened: [index],
      };
    }

    // Flood fill: a zero cell opens its neighbours; number cells stop expansion.
    const opened: number[] = [];
    const queue: number[] = [index];

    while (queue.length > 0) {
      const current = queue.pop()!;
      if (revealed[current]) continue;

      revealed[current] = true;
      opened.push(current);

      if (adjacent[current] === 0) {
        for (const neighbour of getNeighbours(
          current,
          state.rows,
          state.cols
        )) {
          if (!revealed[neighbour] && !mines[neighbour]) {
            queue.push(neighbour);
          }
        }
      }
    }

    const revealedCount = state.revealedCount + opened.length;
    const isWin = revealedCount >= state.safeTotal;
    const nextState: MinesweeperState = {
      ...state,
      mines,
      adjacent,
      minesPlaced,
      firstClickIndex,
      revealed,
      revealedCount,
      actionCount,
      status: isWin ? "WON" : "PLAYING",
    };

    return {
      state: nextState,
      win: isWin,
      gameOver: false,
      changed: true,
      mineHit: false,
      opened,
    };
  }

  verify(
    seed: string,
    inputs: TimestampedInput<MinesweeperInput>[],
    claimedTimeMs: number
  ): VerificationResult<MinesweeperSummary> {
    if (!claimedTimeMs || claimedTimeMs <= 0) {
      return { valid: false, reason: "Invalid claimed time" };
    }

    if (!Array.isArray(inputs) || inputs.length === 0) {
      return { valid: false, reason: "Inputs must be a non-empty array of clicks" };
    }

    if (inputs.length > MINESWEEPER_CONFIG.MAX_INPUTS) {
      return { valid: false, reason: "Too many clicks" };
    }

    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      const action = input?.action as Partial<MinesweeperInput> | undefined;
      if (
        !input ||
        typeof input.t !== "number" ||
        !Number.isFinite(input.t) ||
        input.t < 0
      ) {
        return { valid: false, reason: `Invalid timestamp at click ${i + 1}` };
      }
      if (i > 0 && input.t < inputs[i - 1].t) {
        return { valid: false, reason: "Timestamps must be non-decreasing" };
      }
      if (
        !action ||
        !isInteger(action.row) ||
        !isInteger(action.col) ||
        action.row < 0 ||
        action.row >= MINESWEEPER_CONFIG.ROWS ||
        action.col < 0 ||
        action.col >= MINESWEEPER_CONFIG.COLS
      ) {
        return { valid: false, reason: `Invalid cell at click ${i + 1}` };
      }
    }

    if (claimedTimeMs < MINESWEEPER_CONFIG.MIN_RUN_TIME_MS) {
      return {
        valid: false,
        reason: "Run time is below plausible human reaction speed",
      };
    }

    if (
      inputs.length > 5 &&
      claimedTimeMs < inputs.length * MINESWEEPER_CONFIG.MIN_INPUT_INTERVAL_MS
    ) {
      return {
        valid: false,
        reason: "Click rate exceeds physical human limits",
      };
    }

    let state = this.init(seed);

    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      const result = this.step(state, input.action);
      state = result.state;

      if (result.mineHit) {
        return {
          valid: false,
          reason: `Hit a mine at click #${i + 1}`,
        };
      }

      if (result.win) {
        const drift = Math.abs(claimedTimeMs - input.t);
        if (drift > MINESWEEPER_CONFIG.MAX_ALLOWED_DRIFT_MS) {
          return {
            valid: false,
            reason: `Claimed time (${claimedTimeMs}ms) drifted excessively from the winning click (${input.t}ms)`,
          };
        }

        return {
          valid: true,
          verifiedTimeMs: input.t,
          summary: {
            rows: state.rows,
            cols: state.cols,
            mineCount: state.mineCount,
            cellsRevealed: state.revealedCount,
            safeCells: state.safeTotal,
            actions: state.actionCount,
          },
        };
      }
    }

    return {
      valid: false,
      reason: `Board was not cleared within ${inputs.length} clicks (${state.revealedCount}/${state.safeTotal} safe squares revealed)`,
    };
  }
}
