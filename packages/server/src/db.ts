import { Challenge, LeaderboardEntry } from "@daily-speedruns/shared";

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
 * Upserts a user identity (anonymous UUID + optional nickname).
 */
export async function upsertUser(
  db: D1Database,
  userId: string,
  nickname?: string
): Promise<void> {
  const trimmed = nickname ? nickname.trim().slice(0, 30) : null;
  const now = Date.now();

  await db
    .prepare(`
      INSERT INTO users (id, nickname, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        nickname = COALESCE(?, users.nickname)
    `)
    .bind(userId, trimmed, now, trimmed)
    .run();
}

/**
 * Saves a completed run into the database.
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
  }
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(`
      INSERT INTO runs (id, user_id, date, game_id, time_ms, inputs, verified, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      run.id,
      run.userId,
      run.date,
      run.gameId,
      run.timeMs,
      run.inputs,
      run.verified ? 1 : 0,
      now
    )
    .run();
}

/**
 * Retrieves the daily leaderboard for a specific game and date.
 */
export async function getLeaderboard(
  db: D1Database,
  dateStr: string,
  gameId: string = "snake"
): Promise<LeaderboardEntry[]> {
  const { results } = await db
    .prepare(`
      SELECT 
        r.id,
        r.user_id as userId,
        COALESCE(u.nickname, 'Runner #' || SUBSTR(r.user_id, 1, 6)) as nickname,
        r.date,
        MIN(r.time_ms) as timeMs,
        r.verified,
        r.created_at as createdAt
      FROM runs r
      LEFT JOIN users u ON r.user_id = u.id
      WHERE r.date = ? AND r.game_id = ? AND r.verified = 1
      GROUP BY r.user_id
      ORDER BY timeMs ASC
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
    userId: row.userId,
    nickname: row.nickname,
    date: row.date,
    timeMs: row.timeMs,
    verified: row.verified === 1,
    createdAt: row.createdAt,
    rank: index + 1,
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
