import { Hono } from "hono";
import { cors } from "hono/cors";
import { getGameEngine, TimestampedInput } from "@daily-speedruns/shared";
import { Env } from "./types.js";
import {
  getLeaderboard,
  getOrCreateDailyChallenge,
  getPendingRun,
  getTodayDateString,
  getUserBestRun,
  saveRun,
  upsertUser,
} from "./db.js";
import { validateDoomRun } from "./doom.js";
import {
  RUNNER_TOKEN_HEADER,
  hashRunnerToken,
  isValidRunnerToken,
} from "./auth.js";

const app = new Hono<{ Bindings: Env }>();

const MAX_RUN_BODY_BYTES = 256 * 1024;
const MAX_INPUTS = 5000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateString(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function isFutureDate(value: string): boolean {
  return value > getTodayDateString();
}

function validateGame(gameId: string): string | null {
  if (!gameId || typeof gameId !== "string") {
    return "Missing or invalid gameId";
  }
  if (!getGameEngine(gameId)) {
    return `Unsupported game: ${gameId}`;
  }
  return null;
}

function validateRunInputs(inputs: unknown): string | null {
  if (!Array.isArray(inputs)) return "Inputs must be an array";
  if (inputs.length === 0) return "No inputs submitted";
  if (inputs.length > MAX_INPUTS) return "Too many inputs";

  for (const entry of inputs) {
    if (!entry || typeof entry !== "object") {
      return "Invalid input entry";
    }
    const input = entry as Partial<TimestampedInput>;
    if (
      typeof input.t !== "number" ||
      !Number.isFinite(input.t) ||
      input.t < 0
    ) {
      return "Invalid input timestamp";
    }
    if (input.action === undefined || input.action === null) {
      return "Missing input action";
    }
  }

  return null;
}

async function authorizeRunner(
  db: D1Database,
  userId: string,
  token: string,
  nickname?: string
): Promise<{ ok: boolean; error?: string }> {
  if (!isValidRunnerToken(token)) {
    return { ok: false, error: "Missing or invalid runner token" };
  }

  const tokenHash = await hashRunnerToken(token);
  const ok = await upsertUser(db, userId, tokenHash, nickname);
  return ok
    ? { ok: true }
    : { ok: false, error: "Runner token does not match this identity" };
}

// Enable CORS for development & Pages frontend
app.use(
  "/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", RUNNER_TOKEN_HEADER],
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

  const gameError = validateGame(gameParam);
  if (gameError) {
    return c.json({ error: gameError }, 400);
  }

  if (!isValidDateString(dateParam)) {
    return c.json({ error: "Invalid date (expected YYYY-MM-DD)" }, 400);
  }

  if (isFutureDate(dateParam)) {
    return c.json({ error: "Future challenges are not available" }, 400);
  }

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
  const rawUserId = c.req.query("userId");
  const userId = rawUserId && rawUserId.length <= 100 ? rawUserId : null;

  const gameError = validateGame(gameParam);
  if (gameError) {
    return c.json({ error: gameError }, 400);
  }

  if (!isValidDateString(dateParam)) {
    return c.json({ error: "Invalid date (expected YYYY-MM-DD)" }, 400);
  }

  if (isFutureDate(dateParam)) {
    return c.json({ error: "Future leaderboards are not available" }, 400);
  }

  const leaderboard = await getLeaderboard(c.env.DB, dateParam, gameParam, userId);

  let userBest: number | null = null;
  let pendingRun: Awaited<ReturnType<typeof getPendingRun>> = null;
  if (userId) {
    userBest = await getUserBestRun(c.env.DB, userId, dateParam, gameParam);
    pendingRun = await getPendingRun(c.env.DB, userId, dateParam, gameParam);
  }

  return c.json({
    date: dateParam,
    gameId: gameParam,
    leaderboard,
    userBestTimeMs: userBest,
    pendingRun,
  });
});

/**
 * POST /api/runs
 * Replays submitted inputs against the shared game engine.
 * Only verified runs are stored.
 */
app.post("/api/runs", async (c) => {
  const rawBody = await c.req.text();

  if (rawBody.length > MAX_RUN_BODY_BYTES) {
    return c.json({ error: "Payload too large" }, 413);
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { userId, nickname, date, gameId, timeMs, inputs, proof } = body;

  if (!userId || typeof userId !== "string" || userId.length > 100) {
    return c.json({ error: "Missing or invalid userId" }, 400);
  }

  if (!date || typeof date !== "string" || !isValidDateString(date)) {
    return c.json({ error: "Missing or invalid date" }, 400);
  }

  if (date !== getTodayDateString()) {
    return c.json(
      { error: "Runs can only be submitted for today's challenge" },
      400
    );
  }

  const gameError = validateGame(gameId as string);
  if (gameError) {
    return c.json({ error: gameError }, 400);
  }

  if (typeof timeMs !== "number" || !Number.isFinite(timeMs) || timeMs <= 0) {
    return c.json({ error: "Invalid claimed time" }, 400);
  }

  if (nickname !== undefined && typeof nickname !== "string") {
    return c.json({ error: "Missing or invalid nickname" }, 400);
  }

  const isDoom = gameId === "doom";

  // Doom uploads a demo instead of an input stream, so the replay input rules
  // do not apply to it.
  if (!isDoom) {
    const inputsError = validateRunInputs(inputs);
    if (inputsError) {
      return c.json({ error: inputsError }, 400);
    }
  }

  // Writes require the runner's local capability token. This is not a full
  // account system, but it prevents one runner from writing as another.
  const auth = await authorizeRunner(
    c.env.DB,
    userId,
    c.req.header(RUNNER_TOKEN_HEADER) ?? "",
    typeof nickname === "string" ? nickname : undefined
  );
  if (!auth.ok) {
    return c.json({ error: auth.error }, 401);
  }

  // --- DOOM: DEMO ARTIFACT, MANUAL REVIEW ---
  // The engine cannot be replayed on the edge, so the best the server can do is
  // prove the demo is intact and on the locked challenge, then park the run as
  // pending until a reviewer replays it.
  if (isDoom) {
    const validation = await validateDoomRun({ timeMs, proof });
    if (!validation.ok) {
      return c.json(
        {
          verified: false,
          error: "Doom run rejected",
          reason: validation.error,
        },
        422
      );
    }

    await getOrCreateDailyChallenge(c.env.DB, date, "doom");

    const runId = crypto.randomUUID();
    await saveRun(c.env.DB, {
      id: runId,
      userId,
      date,
      gameId: "doom",
      timeMs: validation.timeMs,
      inputs: "[]",
      verified: false,
      reviewStatus: "pending",
      proof: {
        kind: "doom-demo",
        data: validation.demoBase64,
        sha256: validation.demoSha256,
        tics: validation.demoTics,
      },
    });

    return c.json(
      {
        verified: false,
        reviewStatus: "pending",
        runId,
        reason: "Waiting for demo review",
      },
      202
    );
  }

  // Retrieve challenge to get authoritative seed for that game
  const challenge = await getOrCreateDailyChallenge(
    c.env.DB,
    date,
    gameId as string
  );

  const engine = getGameEngine(challenge.gameId)!;

  // --- REPLAY & ANTI-CHEAT VERIFICATION ---
  const verification = engine.verify(
    challenge.seed,
    inputs as TimestampedInput<unknown>[],
    timeMs
  );

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

  // Store the verified run
  const runId = crypto.randomUUID();
  await saveRun(c.env.DB, {
    id: runId,
    userId,
    date,
    gameId: gameId as string,
    timeMs: officialTimeMs,
    inputs: JSON.stringify(inputs),
    verified: true,
  });

  // Fetch updated user rank and best time for this game
  const updatedLeaderboard = await getLeaderboard(
    c.env.DB,
    date,
    gameId as string,
    userId
  );
  const userRank =
    updatedLeaderboard.findIndex((entry) => entry.isCurrentUser) + 1;

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
  if (
    !body ||
    typeof body.userId !== "string" ||
    body.userId.length === 0 ||
    body.userId.length > 100 ||
    typeof body.nickname !== "string"
  ) {
    return c.json({ error: "Invalid request" }, 400);
  }

  const nickname = body.nickname.trim().slice(0, 30);
  if (!nickname) {
    return c.json({ error: "Nickname cannot be empty" }, 400);
  }

  const auth = await authorizeRunner(
    c.env.DB,
    body.userId,
    c.req.header(RUNNER_TOKEN_HEADER) ?? "",
    nickname
  );
  if (!auth.ok) {
    return c.json({ error: auth.error }, 401);
  }

  return c.json({ success: true, nickname });
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
        getOrCreateDailyChallenge(env.DB, today, "math"),
        getOrCreateDailyChallenge(env.DB, today, "captcha"),
        getOrCreateDailyChallenge(env.DB, today, "minesweeper"),
        getOrCreateDailyChallenge(env.DB, today, "frog"),
        getOrCreateDailyChallenge(env.DB, today, "doom"),
      ])
    );
  },
};
