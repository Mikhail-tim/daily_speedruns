import { Hono } from "hono";
import { cors } from "hono/cors";
import { getGameEngine } from "@daily-speedruns/shared";
import { Env } from "./types.js";
import {
  getLeaderboard,
  getOrCreateDailyChallenge,
  getTodayDateString,
  getUserBestRun,
  saveRun,
  upsertUser,
} from "./db.js";

const app = new Hono<{ Bindings: Env }>();

// Enable CORS for development & Pages frontend
app.use(
  "/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })
);

// Health check
app.get("/api/health", (c) => c.json({ status: "ok", time: new Date().toISOString() }));

/**
 * GET /api/challenge/today
 * Returns today's active challenge for a given game (defaults to snake, supports wordle).
 */
app.get("/api/challenge/today", async (c) => {
  const dateParam = c.req.query("date") || getTodayDateString();
  const gameParam = c.req.query("game") || "snake";

  const challenge = await getOrCreateDailyChallenge(c.env.DB, dateParam, gameParam);
  const engine = getGameEngine(challenge.gameId);

  return c.json({
    date: challenge.date,
    gameId: challenge.gameId,
    name: engine?.name || challenge.gameId,
    description: engine?.description || "",
    targetDescription: engine?.targetDescription || "",
    seed: challenge.seed,
    version: challenge.version,
  });
});

/**
 * GET /api/leaderboard
 * Returns verified rankings for a given date and game.
 */
app.get("/api/leaderboard", async (c) => {
  const dateParam = c.req.query("date") || getTodayDateString();
  const gameParam = c.req.query("game") || "snake";
  const userId = c.req.query("userId");

  const leaderboard = await getLeaderboard(c.env.DB, dateParam, gameParam);

  let userBest: number | null = null;
  if (userId) {
    userBest = await getUserBestRun(c.env.DB, userId, dateParam, gameParam);
  }

  return c.json({
    date: dateParam,
    gameId: gameParam,
    leaderboard,
    userBestTimeMs: userBest,
  });
});

/**
 * POST /api/runs
 * Replays submitted inputs against the shared game engine.
 * Only verified runs are stored.
 */
app.post("/api/runs", async (c) => {
  const body = await c.req.json().catch(() => null);

  if (!body) {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { userId, nickname, date, gameId, timeMs, inputs } = body;

  if (!userId || typeof userId !== "string") {
    return c.json({ error: "Missing or invalid userId" }, 400);
  }

  if (!date || typeof date !== "string") {
    return c.json({ error: "Missing or invalid date" }, 400);
  }

  if (!gameId || typeof gameId !== "string") {
    return c.json({ error: "Missing or invalid gameId" }, 400);
  }

  if (typeof timeMs !== "number" || timeMs <= 0) {
    return c.json({ error: "Invalid claimed time" }, 400);
  }

  if (!Array.isArray(inputs)) {
    return c.json({ error: "Inputs must be an array" }, 400);
  }

  // Retrieve challenge to get authoritative seed for that game
  const challenge = await getOrCreateDailyChallenge(c.env.DB, date, gameId);

  const engine = getGameEngine(challenge.gameId);
  if (!engine) {
    return c.json({ error: `Unsupported game: ${challenge.gameId}` }, 400);
  }

  // --- REPLAY & ANTI-CHEAT VERIFICATION ---
  const verification = engine.verify(challenge.seed, inputs, timeMs);

  if (!verification.valid) {
    return c.json(
      {
        verified: false,
        error: "Replay verification failed",
        reason: verification.reason || "Invalid run simulation",
      },
      422
    );
  }

  // Official verified time from deterministic simulation
  const officialTimeMs = verification.verifiedTimeMs ?? timeMs;

  // Persist user nickname if supplied
  await upsertUser(c.env.DB, userId, nickname);

  // Store the verified run
  const runId = crypto.randomUUID();
  await saveRun(c.env.DB, {
    id: runId,
    userId,
    date,
    gameId,
    timeMs: officialTimeMs,
    inputs: JSON.stringify(inputs),
    verified: true,
  });

  // Fetch updated user rank and best time for this game
  const updatedLeaderboard = await getLeaderboard(c.env.DB, date, gameId);
  const userRank = updatedLeaderboard.findIndex((r) => r.userId === userId) + 1;

  return c.json({
    verified: true,
    runId,
    verifiedTimeMs: officialTimeMs,
    rank: userRank > 0 ? userRank : null,
    summary: verification.summary,
  });
});

/**
 * POST /api/user/nickname
 * Update display nickname
 */
app.post("/api/user/nickname", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || !body.userId || typeof body.nickname !== "string") {
    return c.json({ error: "Invalid request" }, 400);
  }

  await upsertUser(c.env.DB, body.userId, body.nickname);
  return c.json({ success: true, nickname: body.nickname.trim().slice(0, 30) });
});

export default {
  fetch: app.fetch,

  /**
   * Scheduled cron trigger runs at 00:00 UTC daily to pre-populate new challenges.
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const today = getTodayDateString();
    ctx.waitUntil(
      Promise.all([
        getOrCreateDailyChallenge(env.DB, today, "snake"),
        getOrCreateDailyChallenge(env.DB, today, "wordle"),
        getOrCreateDailyChallenge(env.DB, today, "typing"),
        getOrCreateDailyChallenge(env.DB, today, "game2048"),
      ])
    );
  },
};
