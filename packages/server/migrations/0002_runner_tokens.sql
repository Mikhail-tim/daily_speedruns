-- 0002: add a hashed runner capability token to users.
-- Existing runners claim their token on their first write.
ALTER TABLE users ADD COLUMN token_hash TEXT;
