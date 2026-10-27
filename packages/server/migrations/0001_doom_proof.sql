-- Doom demo-review support.
--
-- Doom runs are recorded demos rather than replayable inputs, so they arrive as
-- `pending` and only reach the leaderboard after a reviewer replays the demo.
--
-- `verified` stays the single column the leaderboard query filters on; the
-- review columns describe how it got there.

ALTER TABLE runs ADD COLUMN review_status TEXT NOT NULL DEFAULT 'verified';
ALTER TABLE runs ADD COLUMN proof_kind TEXT;
ALTER TABLE runs ADD COLUMN proof_data TEXT;
ALTER TABLE runs ADD COLUMN proof_sha256 TEXT;
ALTER TABLE runs ADD COLUMN proof_tics INTEGER;
ALTER TABLE runs ADD COLUMN reviewed_at INTEGER;
ALTER TABLE runs ADD COLUMN review_note TEXT;

CREATE INDEX IF NOT EXISTS idx_runs_review
  ON runs(game_id, review_status, created_at DESC);
