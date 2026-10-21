-- Daily challenges
CREATE TABLE IF NOT EXISTS challenges (
    date TEXT NOT NULL,              -- Format: YYYY-MM-DD
    game_id TEXT NOT NULL,          -- e.g. 'snake', 'wordle'
    seed TEXT NOT NULL,             -- Deterministic seed for that day
    version INTEGER DEFAULT 1,
    PRIMARY KEY (date, game_id)
);

-- Users (anonymous UUIDs generated in localStorage + optional nickname)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    nickname TEXT,
    token_hash TEXT,                -- SHA-256 of the runner's local capability token
    created_at INTEGER NOT NULL
);

-- Submitted runs
CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    game_id TEXT NOT NULL DEFAULT 'snake',
    time_ms INTEGER NOT NULL,
    inputs TEXT NOT NULL,           -- JSON array of TimestampedInput
    verified INTEGER NOT NULL,       -- 1 = true, 0 = false
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Index for fast daily leaderboard queries (best verified time first)
CREATE INDEX IF NOT EXISTS idx_runs_daily ON runs(date, game_id, verified, time_ms ASC);
CREATE INDEX IF NOT EXISTS idx_runs_user ON runs(user_id, date, game_id);
