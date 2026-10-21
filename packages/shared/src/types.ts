/**
 * Common types for Daily Speedruns game engines, challenges, and leaderboards.
 */

export interface Challenge {
  date: string;       // YYYY-MM-DD
  gameId: string;     // e.g. "snake"
  seed: string;       // Deterministic seed
  version: number;
}

export interface TimestampedInput<TAction = unknown> {
  t: number;          // Milliseconds elapsed since the run started (0-indexed)
  tick?: number;      // Exact simulation tick index when action was executed
  action: TAction;    // Specific game input action (e.g. 'UP', 'DOWN', etc.)
}

export interface VerificationResult<TSummary = Record<string, unknown>> {
  valid: boolean;
  reason?: string;
  verifiedTimeMs?: number;
  summary?: TSummary;
}

export interface GameEngine<TAction, TState, TSummary = Record<string, unknown>> {
  gameId: string;
  name: string;
  description: string;
  targetDescription: string;

  /**
   * Initializes a deterministic game state from a given seed.
   */
  init(seed: string): TState;

  /**
   * Steps the game forward.
   * Can be discrete tick-based or delta-time based.
   */
  step(state: TState, action?: TAction): {
    state: TState;
    win: boolean;
    gameOver: boolean;
  };

  /**
   * Replays the input sequence against the given seed and validates the run.
   * Usable identically on both server and client.
   */
  verify(
    seed: string,
    inputs: TimestampedInput<TAction>[],
    claimedTimeMs: number
  ): VerificationResult<TSummary>;
}

export interface RunSubmission<TAction = unknown> {
  userId: string;
  nickname?: string;
  date: string;
  gameId: string;
  timeMs: number;
  inputs: TimestampedInput<TAction>[];
}

export interface LeaderboardEntry {
  id: string;
  nickname: string;
  date: string;
  timeMs: number;
  verified: boolean;
  createdAt: number;
  rank?: number;
  /** Set by the server for the requesting runner only. */
  isCurrentUser?: boolean;
}
