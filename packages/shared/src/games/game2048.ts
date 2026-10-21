import { hashString, nextRandomInt } from "../prng.js";
import {
  GameEngine,
  TimestampedInput,
  VerificationResult,
} from "../types.js";

export type MoveDirection = "UP" | "DOWN" | "LEFT" | "RIGHT";

export type Grid = number[][]; // 4x4 array of numbers

export interface Game2048State {
  grid: Grid;
  score: number;
  moveCount: number;
  maxTile: number;
  targetTile: number;
  isWin: boolean;
  isGameOver: boolean;
  rngState: number;
}

export interface Game2048Summary {
  score: number;
  moves: number;
  maxTile: number;
}

export const GAME_2048_CONFIG = {
  GRID_SIZE: 4,
  TARGET_TILE: 512,
  MAX_ALLOWED_DRIFT_MS: 500,
};

/**
 * Creates an empty 4x4 grid.
 */
function createEmptyGrid(): Grid {
  return [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
}

/**
 * Spawns a random tile (90% 2, 10% 4) into an unoccupied cell deterministically.
 */
export function spawnTile(
  grid: Grid,
  rngState: number
): { grid: Grid; rngState: number } {
  const emptyCells: Array<{ r: number; c: number }> = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (grid[r][c] === 0) {
        emptyCells.push({ r, c });
      }
    }
  }

  if (emptyCells.length === 0) {
    return { grid, rngState };
  }

  const { value: cellIdx, nextState: s1 } = nextRandomInt(
    rngState,
    0,
    emptyCells.length - 1
  );
  const { value: roll, nextState: s2 } = nextRandomInt(s1, 1, 10);
  const val = roll === 10 ? 4 : 2;

  const target = emptyCells[cellIdx];
  const newGrid = grid.map((row, r) =>
    row.map((col, c) => (r === target.r && c === target.c ? val : col))
  );

  return { grid: newGrid, rngState: s2 };
}

/**
 * Slides and merges a single 4-element row to the left.
 */
function slideRowLeft(row: number[]): { row: number[]; scoreGained: number } {
  const nonZero = row.filter((x) => x !== 0);
  const result: number[] = [];
  let scoreGained = 0;

  for (let i = 0; i < nonZero.length; i++) {
    if (i < nonZero.length - 1 && nonZero[i] === nonZero[i + 1]) {
      const merged = nonZero[i] * 2;
      result.push(merged);
      scoreGained += merged;
      i++; // Skip merged partner
    } else {
      result.push(nonZero[i]);
    }
  }

  while (result.length < 4) {
    result.push(0);
  }

  return { row: result, scoreGained };
}

/**
 * Matrix operations for 4 directions.
 */
function transpose(grid: Grid): Grid {
  const result = createEmptyGrid();
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      result[r][c] = grid[c][r];
    }
  }
  return result;
}

function reverseRows(grid: Grid): Grid {
  return grid.map((row) => [...row].reverse());
}

/**
 * Executes a move in any of the 4 directions.
 */
export function executeMove(
  grid: Grid,
  direction: MoveDirection
): { grid: Grid; scoreGained: number; changed: boolean } {
  let workingGrid: Grid = grid.map((r) => [...r]);

  if (direction === "UP") {
    workingGrid = transpose(workingGrid);
  } else if (direction === "DOWN") {
    workingGrid = reverseRows(transpose(workingGrid));
  } else if (direction === "RIGHT") {
    workingGrid = reverseRows(workingGrid);
  }

  let totalScore = 0;
  const newRows = workingGrid.map((row) => {
    const { row: nextRow, scoreGained } = slideRowLeft(row);
    totalScore += scoreGained;
    return nextRow;
  });

  let finalGrid: Grid = newRows;
  if (direction === "UP") {
    finalGrid = transpose(finalGrid);
  } else if (direction === "DOWN") {
    finalGrid = transpose(reverseRows(finalGrid));
  } else if (direction === "RIGHT") {
    finalGrid = reverseRows(finalGrid);
  }

  let changed = false;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (grid[r][c] !== finalGrid[r][c]) {
        changed = true;
        break;
      }
    }
  }

  return { grid: finalGrid, scoreGained: totalScore, changed };
}

/**
 * Checks if any valid moves remain on the board.
 */
function hasMovesLeft(grid: Grid): boolean {
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (grid[r][c] === 0) return true;
      if (c < 3 && grid[r][c] === grid[r][c + 1]) return true;
      if (r < 3 && grid[r][c] === grid[r + 1][c]) return true;
    }
  }
  return false;
}

/**
 * Finds the highest tile on the board.
 */
function getMaxTile(grid: Grid): number {
  let max = 0;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (grid[r][c] > max) max = grid[r][c];
    }
  }
  return max;
}

export class Game2048Engine
  implements GameEngine<MoveDirection, Game2048State, Game2048Summary>
{
  readonly gameId = "game2048";
  readonly name = "2048 Sprint";
  readonly description = "Slide and merge matching tiles to reach the 512 tile as fast as possible.";
  readonly targetDescription = "Reach the 512 tile";

  init(seed: string): Game2048State {
    const initialRng = hashString(seed);

    let grid = createEmptyGrid();
    // Spawn 2 initial tiles
    const first = spawnTile(grid, initialRng);
    const second = spawnTile(first.grid, first.rngState);

    return {
      grid: second.grid,
      score: 0,
      moveCount: 0,
      maxTile: getMaxTile(second.grid),
      targetTile: GAME_2048_CONFIG.TARGET_TILE,
      isWin: false,
      isGameOver: false,
      rngState: second.rngState,
    };
  }

  step(
    state: Game2048State,
    action?: MoveDirection
  ): { state: Game2048State; win: boolean; gameOver: boolean; changed: boolean } {
    if (state.isWin || state.isGameOver || !action) {
      return { state, win: state.isWin, gameOver: state.isGameOver, changed: false };
    }

    const { grid: movedGrid, scoreGained, changed } = executeMove(state.grid, action);

    if (!changed) {
      return { state, win: state.isWin, gameOver: state.isGameOver, changed: false };
    }

    // Spawn 1 tile on valid move
    const { grid: spawnedGrid, rngState: nextRng } = spawnTile(movedGrid, state.rngState);
    const maxTile = getMaxTile(spawnedGrid);
    const isWin = maxTile >= state.targetTile;
    const isGameOver = !isWin && !hasMovesLeft(spawnedGrid);

    const nextState: Game2048State = {
      ...state,
      grid: spawnedGrid,
      score: state.score + scoreGained,
      moveCount: state.moveCount + 1,
      maxTile,
      isWin,
      isGameOver,
      rngState: nextRng,
    };

    return {
      state: nextState,
      win: isWin,
      gameOver: isGameOver,
      changed: true,
    };
  }

  verify(
    seed: string,
    inputs: TimestampedInput<MoveDirection>[],
    claimedTimeMs: number
  ): VerificationResult<Game2048Summary> {
    if (!claimedTimeMs || claimedTimeMs <= 0) {
      return { valid: false, reason: "Invalid claimed time" };
    }

    if (!Array.isArray(inputs) || inputs.length === 0) {
      return { valid: false, reason: "Inputs must be a non-empty array of moves" };
    }

    // Input sanity checks
    for (let i = 0; i < inputs.length; i++) {
      const inp = inputs[i];
      if (typeof inp.t !== "number" || inp.t < 0) {
        return { valid: false, reason: `Invalid timestamp at move ${i + 1}` };
      }
      if (i > 0 && inp.t < inputs[i - 1].t) {
        return { valid: false, reason: "Timestamps must be non-decreasing" };
      }
      if (!["UP", "DOWN", "LEFT", "RIGHT"].includes(inp.action)) {
        return { valid: false, reason: `Unknown move direction: ${inp.action}` };
      }
    }

    // Reasonable human speed cap: max 15 moves per second
    if (inputs.length > 5 && claimedTimeMs < inputs.length * 50) {
      return {
        valid: false,
        reason: "Move rate exceeds physical human limits",
      };
    }

    let state = this.init(seed);

    for (let i = 0; i < inputs.length; i++) {
      const inp = inputs[i];
      const res = this.step(state, inp.action);
      state = res.state;

      if (res.win) {
        const winningMoveTime = inp.t;
        const drift = Math.abs(claimedTimeMs - winningMoveTime);

        if (drift > GAME_2048_CONFIG.MAX_ALLOWED_DRIFT_MS) {
          return {
            valid: false,
            reason: `Claimed time (${claimedTimeMs}ms) drifted excessively from winning move (${winningMoveTime}ms)`,
          };
        }

        return {
          valid: true,
          verifiedTimeMs: winningMoveTime,
          summary: {
            score: state.score,
            moves: state.moveCount,
            maxTile: state.maxTile,
          },
        };
      }

      if (res.gameOver) {
        return {
          valid: false,
          reason: `Board locked up with no moves remaining at move #${state.moveCount}`,
        };
      }
    }

    return {
      valid: false,
      reason: `Target 512 tile was not reached within ${inputs.length} moves`,
    };
  }
}
