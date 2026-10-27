/**
 * Server-side validation for Doom run submissions.
 *
 * There is no replayable input stream for Doom, so the server cannot decide a
 * run is *fast*. What it can do is prove the artifact is intact and internally
 * consistent, then park the run as `pending` until a human replays it.
 *
 * Accepted here means: a well-formed vanilla demo, recorded on the locked
 * challenge, on the pinned IWAD and engine build, whose length is consistent
 * with the claimed time. It does not mean the time is official.
 */
import {
  DOOM_CHALLENGE_LABEL,
  DOOM_DEMO_SKILL_ULTRA_VIOLENCE,
  DOOM_ENGINE_BUILD,
  DOOM_IWAD_SHA256,
  DOOM_MAX_DEMO_BYTES,
  DOOM_MAX_RUN_MS,
  DOOM_MIN_RUN_MS,
  DOOM_TIC_RATE,
  parseDoomDemo,
  type DoomProof,
} from "@daily-speedruns/shared";

/**
 * Grace allowed between the runner's stopwatch and the recording. The clock
 * starts a moment before the level does, so a claim can legitimately be a few
 * seconds longer than the demo. Eight seconds is generous and still rejects a
 * claim that the demo cannot back up.
 */
const CLAIM_OVER_DEMO_TICS = 8 * DOOM_TIC_RATE;

export interface ValidatedDoomRun {
  ok: true;
  demoBase64: string;
  demoSha256: string;
  demoTics: number;
  timeMs: number;
}

export interface DoomRunRejection {
  ok: false;
  error: string;
}

export type DoomRunValidation = ValidatedDoomRun | DoomRunRejection;

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into a plain ArrayBuffer-backed view so the digest call is typed
  // against BufferSource rather than a possibly shared buffer.
  const view = new Uint8Array(bytes.length);
  view.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", view);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function validateDoomRun(input: {
  timeMs: unknown;
  proof: unknown;
}): Promise<DoomRunValidation> {
  const { timeMs, proof } = input;

  if (
    typeof timeMs !== "number" ||
    !Number.isFinite(timeMs) ||
    timeMs < DOOM_MIN_RUN_MS ||
    timeMs > DOOM_MAX_RUN_MS
  ) {
    return { ok: false, error: "Implausible claimed level time" };
  }

  if (!proof || typeof proof !== "object" || Array.isArray(proof)) {
    return { ok: false, error: "Missing Doom proof" };
  }

  const candidate = proof as Partial<DoomProof>;

  if (candidate.kind !== "doom-demo") {
    return { ok: false, error: "Unsupported proof kind" };
  }
  if (typeof candidate.demoBase64 !== "string" || !candidate.demoBase64) {
    return { ok: false, error: "Missing demo recording" };
  }
  if (typeof candidate.demoSha256 !== "string") {
    return { ok: false, error: "Missing demo checksum" };
  }
  if (candidate.iwadSha256 !== DOOM_IWAD_SHA256) {
    return { ok: false, error: "Run was recorded on a different IWAD" };
  }
  if (candidate.engineBuild !== DOOM_ENGINE_BUILD) {
    return { ok: false, error: "Run was recorded on an unsupported engine build" };
  }
  if (candidate.skill !== DOOM_DEMO_SKILL_ULTRA_VIOLENCE) {
    return { ok: false, error: "Run was not recorded on Ultra-Violence" };
  }
  if (candidate.mapLabel !== DOOM_CHALLENGE_LABEL) {
    return { ok: false, error: `Run was not recorded on ${DOOM_CHALLENGE_LABEL}` };
  }

  let demo: Uint8Array;
  try {
    demo = decodeBase64(candidate.demoBase64);
  } catch {
    return { ok: false, error: "Demo recording is not valid base64" };
  }

  if (demo.length > DOOM_MAX_DEMO_BYTES) {
    return { ok: false, error: "Demo recording is too large" };
  }

  const actualHash = await sha256Hex(demo);
  if (actualHash !== candidate.demoSha256.toLowerCase()) {
    return { ok: false, error: "Demo checksum does not match its contents" };
  }

  const info = parseDoomDemo(demo);
  if (!info.valid) {
    return { ok: false, error: info.reason ?? "Demo recording is unreadable" };
  }
  if (info.header.skill !== DOOM_DEMO_SKILL_ULTRA_VIOLENCE) {
    return { ok: false, error: "Demo header is not Ultra-Violence" };
  }
  if (info.mapLabel !== DOOM_CHALLENGE_LABEL) {
    return {
      ok: false,
      error: `Demo header is ${info.mapLabel}, not ${DOOM_CHALLENGE_LABEL}`,
    };
  }

  // A demo keeps recording while the player sits in the quit menu, so it is
  // normally *longer* than the claim. It can never be materially shorter: that
  // would mean the clock was stopped before the run the demo proves.
  const claimedTics = Math.round((timeMs / 1000) * DOOM_TIC_RATE);
  if (info.tics + CLAIM_OVER_DEMO_TICS < claimedTics) {
    return {
      ok: false,
      error: "Claimed time is longer than the submitted demo supports",
    };
  }

  // Reject demos too short to be a real E1M1 completion.
  const minimumTics = Math.round((DOOM_MIN_RUN_MS / 1000) * DOOM_TIC_RATE);
  if (info.tics < minimumTics) {
    return {
      ok: false,
      error: `Demo is too short to be a completed run (${info.tics} tics)`,
    };
  }

  return {
    ok: true,
    demoBase64: candidate.demoBase64,
    demoSha256: actualHash,
    demoTics: info.tics,
    timeMs: Math.round(timeMs),
  };
}
