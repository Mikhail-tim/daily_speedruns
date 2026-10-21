/**
 * Minimal runner capability tokens.
 *
 * This is intentionally not a full account system: the client generates a
 * long random token once, keeps it in localStorage, and sends it with writes.
 * The server stores only its SHA-256 hash. It prevents one runner from
 * renaming or submitting as another runner; it does not prove humanity.
 */

export const RUNNER_TOKEN_HEADER = "X-Runner-Token";

const MIN_TOKEN_LENGTH = 24;
const MAX_TOKEN_LENGTH = 256;

export function isValidRunnerToken(token: string | undefined | null): token is string {
  if (typeof token !== "string") return false;
  if (token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) {
    return false;
  }
  return /^[A-Za-z0-9_-]+$/.test(token);
}

export async function hashRunnerToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time string comparison for equal-length hex hashes. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
