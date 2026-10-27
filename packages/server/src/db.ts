import { Challenge, LeaderboardEntry } from "@daily-speedruns/shared";
import { timingSafeEqual } from "./auth.js";

/**
 * Returns today's UTC date in YYYY-MM-DD format.
 */
export function getTodayDateString(): string {
  const now = new Date();
  return now.toISOString().split("T")[0];
}

/**
 * Ensures a challenge exists for the given date and gameId.
 * If not present in D1, creates one deterministically.
 */
export async function getOrCreateDailyChallenge(
  db: D1Database,
  dateStr: string = getTodayDateString(),
  gameId: string = "snake"
): Promise<Challenge> {
  const existing = await db
    .prepare("SELECT date, game_id as gameId, seed, version FROM challenges WHERE date = ? AND game_id = ?")
    .bind(dateStr, gameId)
    .first<Challenge>();

  if (existing) {
    return existing;
  }

  // Pure deterministic seed for the day
  const seed = `${dateStr}:${gameId}:v1`;
  const version = 1;

  await db
    .prepare(
      "INSERT INTO challenges (date, game_id, seed, version) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING"
    )
    .bind(dateStr, gameId, seed, version)
    .run();

  return {
    date: dateStr,
    gameId,
    seed,
    version,
  };
}

/**
 * Creates or updates a runner identity.
 *
 * Returns false when the supplied token does not match an existing runner.
 * A legacy runner without a stored token claims it on their first write.
 */
export async function upsertUser(
  db: D1Database,
  userId: string,
  tokenHash: string,
  nickname?: string
): Promise<boolean> {
  const trimmed = nickname ? nickname.trim().slice(0, 30) : null;
  const now = Date.now();

  const existing = await db
    .prepare("SELECT token_hash as tokenHash FROM users WHERE id = ?")
    .bind(userId)
    .first<{ tokenHash: string | null }>();

  if (!existing) {
    await db
      .prepare(
        "INSERT INTO users (id, nickname, token_hash, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING"
      )
      .bind(userId, trimmed, tokenHash, now)
      .run();

    // If another request created the user first, re-check the token.
    const created = await db
      .prepare("SELECT token_hash as tokenHash FROM users WHERE id = ?")
      .bind(userId)
      .first<{ tokenHash: string | null }>();
    if (created?.tokenHash && created.tokenHash !== tokenHash) {
      return false;
    }
    if (created && !created.tokenHash) {
      await db
        .prepare("UPDATE users SET token_hash = ? WHERE id = ?")
        .bind(tokenHash, userId)
        .run();
    }
    return true;
  }

  if (!existing.tokenHash) {
    await db
      .prepare(
        "UPDATE users SET token_hash = ?, nickname = COALESCE(?, nickname) WHERE id = ?"
      )
      .bind(tokenHash, trimmed, userId)
      .run();
    return true;
  }

  if (!timingSafeEqual(existing.tokenHash, tokenHash)) {
    return false;
  }

  if (trimmed) {
    await db
      .prepare("UPDATE users SET nickname = ? WHERE id = ?")
      .bind(trimmed, userId)
      .run();
  }

  return true;
}

/**
 * Saves a completed run into the database.
 *
 * Games with a deterministic engine land here already verified. Doom lands here
 * as `pending` with its demo recording attached, and is promoted later through
 * the review script.
 */
export async function saveRun(
  db: D1Database,
  run: {
    id: string;
    userId: string;
    date: string;
    gameId: string;
    timeMs: number;
    inputs: string;
    verified: boolean;
    reviewStatus?: "verified" | "pending" | "rejected";
    proof?: {
      kind: string;
      data: string;
      sha256: string;
      tics: number;
    };
  }
): Promise<void> {
  const now = Date.now();
  const reviewStatus = run.reviewStatus ?? (run.verified ? "verified" : "pending");
  await db
    .prepare(`
      INSERT INTO runs (
        id, user_id, date, game_id, time_ms, inputs, verified, created_at,
        review_status, proof_kind, proof_data, proof_sha256, proof_tics
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      run.id,
      run.userId,
      run.date,
      run.gameId,
      run.timeMs,
      run.inputs,
      run.verified ? 1 : 0,
      now,
      reviewStatus,
      run.proof?.kind ?? null,
      run.proof?.data ?? null,
      run.proof?.sha256 ?? null,
      run.proof?.tics ?? null
    )
    .run();
}

export interface PendingRun {
  id: string;
  date: string;
  gameId: string;
  timeMs: number;
  reviewStatus: string;
  createdAt: number;
}

/**
 * The requesting runner's most recent run that is still waiting for review, so
 * the UI can show "pending" instead of pretending the run does not exist.
 */
export async function getPendingRun(
  db: D1Database,
  userId: string,
  dateStr: string,
  gameId: string
): Promise<PendingRun | null> {
  const row = await db
    .prepare(`
      SELECT id, date, game_id AS gameId, time_ms AS timeMs,
             review_status AS reviewStatus, created_at AS createdAt
      FROM runs
      WHERE user_id = ? AND date = ? AND game_id = ? AND review_status = 'pending'
      ORDER BY time_ms ASC, created_at ASC
      LIMIT 1
    `)
    .bind(userId, dateStr, gameId)
    .first<PendingRun>();

  return row ?? null;
}

/**
 * Retrieves the daily leaderboard for a specific game and date.
 */
export async function getLeaderboard(
  db: D1Database,
  dateStr: string,
  gameId: string = "snake",
  currentUserId?: string | null
): Promise<LeaderboardEntry[]> {
  const { results } = await db
    .prepare(`
      SELECT
        id,
        userId,
        nickname,
        date,
        timeMs,
        verified,
        createdAt
      FROM (
        SELECT
          r.id,
          r.user_id AS userId,
          COALESCE(u.nickname, 'Runner #' || SUBSTR(r.user_id, 1, 6)) AS nickname,
          r.date,
          r.time_ms AS timeMs,
          r.verified,
          r.created_at AS createdAt,
          ROW_NUMBER() OVER (
            PARTITION BY r.user_id
            ORDER BY r.time_ms ASC, r.created_at ASC
          ) AS rowNumber
        FROM runs r
        LEFT JOIN users u ON r.user_id = u.id
        WHERE r.date = ? AND r.game_id = ? AND r.verified = 1
      )
      WHERE rowNumber = 1
      ORDER BY timeMs ASC, createdAt ASC
      LIMIT 100
    `)
    .bind(dateStr, gameId)
    .all<{
      id: string;
      userId: string;
      nickname: string;
      date: string;
      timeMs: number;
      verified: number;
      createdAt: number;
    }>();

  return (results || []).map((row, index) => ({
    id: row.id,
    nickname: row.nickname,
    date: row.date,
    timeMs: row.timeMs,
    verified: row.verified === 1,
    createdAt: row.createdAt,
    rank: index + 1,
    isCurrentUser: currentUserId != null && row.userId === currentUserId,
  }));
}

/**
 * Returns the best verified time for a user on a given date and game.
 */
export async function getUserBestRun(
  db: D1Database,
  userId: string,
  dateStr: string,
  gameId: string = "snake"
): Promise<number | null> {
  const res = await db
    .prepare(`
      SELECT MIN(time_ms) as bestTime
      FROM runs
      WHERE user_id = ? AND date = ? AND game_id = ? AND verified = 1
    `)
    .bind(userId, dateStr, gameId)
    .first<{ bestTime: number | null }>();

  return res?.bestTime ?? null;
}
