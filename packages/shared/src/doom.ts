/**
 * Doom (1993) event metadata and proof helpers.
 *
 * Doom is the first game on the site that cannot be replayed by the shared
 * deterministic engines: the run happens inside a real Chocolate Doom
 * WebAssembly build, and the only portable artifact it produces is a vanilla
 * `.lmp` demo recording.
 *
 * Because of that, Doom runs are submitted as *pending* and a reviewer replays
 * the demo before the time is promoted to the daily leaderboard. Everything in
 * this module is shared so the client and the server agree on how a demo is
 * read and how tics convert to milliseconds.
 */

/** Doom's fixed simulation rate. `leveltime` counts at exactly 35 Hz. */
export const DOOM_TIC_RATE = 35;

/** Vanilla Doom 1.9 demo header size, in bytes. */
export const DOOM_DEMO_HEADER_BYTES = 13;

/** Vanilla Doom demo stream version byte. */
export const DOOM_DEMO_VERSION = 109;

/**
 * Accepted demo stream versions.
 *
 * The pinned shareware IWAD is the 1.8 release, which Chocolate Doom runs in
 * 1.8 emulation mode and therefore records as version 108. Version 109 is what
 * a 1.9 IWAD produces. Both use the identical 13-byte header and 4-byte ticcmd
 * layout, so both are safe to accept.
 */
export const DOOM_ACCEPTED_DEMO_VERSIONS = [108, 109] as const;

/**
 * Skill numbers are not the same in both places.
 *
 * `-skill` on the command line is 1-based (1 = I'm Too Young To Die … 5 =
 * Nightmare). A demo header stores the same value 0-based, so Ultra-Violence is
 * 4 on the command line and 3 in the recording.
 */
export const DOOM_SKILL_ARG_ULTRA_VIOLENCE = 4;
export const DOOM_DEMO_SKILL_ULTRA_VIOLENCE = 3;

/** Fixed challenge for v1 of the event. */
export const DOOM_CHALLENGE_EPISODE = 1;
export const DOOM_CHALLENGE_MAP = 1;
export const DOOM_CHALLENGE_LABEL = "E1M1";

/**
 * SHA-256 of the shareware IWAD we serve. A run whose demo was recorded on a
 * different WAD cannot be compared fairly, so submissions carry this value and
 * the server rejects mismatches.
 */
export const DOOM_IWAD_SHA256 =
  "bb449c7480e9a02a62012d041406e8e43daa51caa0650646d1307d8650b8f837";

/** Identifies the engine build a demo came from. */
export const DOOM_ENGINE_BUILD = "chocolate-doom-3.1.1-wasm-64de092";

/** Largest demo we will accept. Vanilla demos are ~4 bytes per tic. */
export const DOOM_MAX_DEMO_BYTES = 128 * 1024;

/** Nobody finishes E1M1 faster than this; anything lower is malformed. */
export const DOOM_MIN_RUN_MS = 10_000;

/** Sanity ceiling so a paused/abandoned run cannot poison the board. */
export const DOOM_MAX_RUN_MS = 60 * 60 * 1000;

/**
 * What a Doom run uploads instead of a replayable input stream.
 *
 * The demo is the evidence; `timeMs` is the runner's own stopwatch and is only
 * promoted to an official time after review.
 */
export interface DoomProof {
  kind: "doom-demo";
  /** Base64 of the raw `.lmp` bytes. */
  demoBase64: string;
  /** SHA-256 of the decoded demo bytes, so storage can be verified later. */
  demoSha256: string;
  /** Header-derived map label the client believes it played. */
  mapLabel: string;
  skill: number;
  iwadSha256: string;
  engineBuild: string;
}

/**
 * What a Doom run uploads instead of a replayable input stream.
 *
 * The demo is the evidence; `timeMs` is the runner's own stopwatch and is only
 * promoted to an official time after review.
 */
export interface DoomProof {
  kind: "doom-demo";
  /** Base64 of the raw `.lmp` bytes. */
  demoBase64: string;
  /** SHA-256 of the decoded demo bytes, so storage can be verified later. */
  demoSha256: string;
  /** Header-derived map label the client believes it played. */
  mapLabel: string;
  skill: number;
  iwadSha256: string;
  engineBuild: string;
}

export interface DoomDemoHeader {
  version: number;
  skill: number;
  episode: number;
  map: number;
  deathmatch: number;
  respawn: number;
  fast: number;
  noMonsters: number;
  consolePlayer: number;
  playersInGame: number;
}

export interface DoomDemoInfo {
  header: DoomDemoHeader;
  /** Number of recorded ticcmds. Includes post-level frames (intermission). */
  tics: number;
  /** `E1M1` style label derived from the header. */
  mapLabel: string;
  valid: boolean;
  reason?: string;
}

export function doomTicsToMs(tics: number): number {
  return Math.round((tics * 1000) / DOOM_TIC_RATE);
}

export function msToDoomTics(ms: number): number {
  return Math.round((ms * DOOM_TIC_RATE) / 1000);
}

/** Formats `leveltime` as `M:SS.mmm`, the way Doom's intermission screen does. */
export function formatDoomTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const hundredths = Math.floor((total % 1000) / 10);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(
    hundredths
  ).padStart(2, "0")}`;
}

/**
 * Reads a vanilla `.lmp` demo header and counts its ticcmds.
 *
 * A vanilla 1.9 demo is:
 *   13-byte header, then N * 4-byte ticcmds, then a 0x80 terminator.
 */
export function parseDoomDemo(bytes: Uint8Array): DoomDemoInfo {
  const header: DoomDemoHeader = {
    version: -1,
    skill: -1,
    episode: -1,
    map: -1,
    deathmatch: -1,
    respawn: -1,
    fast: -1,
    noMonsters: -1,
    consolePlayer: -1,
    playersInGame: 0,
  };

  if (bytes.length <= DOOM_DEMO_HEADER_BYTES) {
    return {
      header,
      tics: 0,
      mapLabel: "?",
      valid: false,
      reason: "Demo is too short to contain a header",
    };
  }

  header.version = bytes[0];
  header.skill = bytes[1];
  header.episode = bytes[2];
  header.map = bytes[3];
  header.deathmatch = bytes[4];
  header.respawn = bytes[5];
  header.fast = bytes[6];
  header.noMonsters = bytes[7];
  header.consolePlayer = bytes[8];
  for (let i = 0; i < 4; i += 1) {
    if (bytes[9 + i] === 1) header.playersInGame += 1;
  }

  const mapLabel = `E${header.episode}M${header.map}`;
  const payload = bytes.subarray(DOOM_DEMO_HEADER_BYTES);
  const terminated = payload[payload.length - 1] === 0x80;
  const bodyLength = terminated ? payload.length - 1 : payload.length;
  const tics = Math.floor(bodyLength / 4);

  const base = { header, tics, mapLabel };

  if (!DOOM_ACCEPTED_DEMO_VERSIONS.includes(header.version as 108 | 109)) {
    return {
      ...base,
      valid: false,
      reason: `Unsupported demo version ${header.version}`,
    };
  }
  if (bodyLength % 4 !== 0) {
    return {
      ...base,
      valid: false,
      reason: "Demo tic stream is not a multiple of 4 bytes",
    };
  }
  if (!terminated) {
    return {
      ...base,
      valid: false,
      reason: "Demo is missing its end-of-demo marker (incomplete recording)",
    };
  }
  if (tics <= 0) {
    return { ...base, valid: false, reason: "Demo contains no tics" };
  }
  if (header.playersInGame !== 1 || header.deathmatch !== 0) {
    return {
      ...base,
      valid: false,
      reason: "Only single-player, non-deathmatch demos are accepted",
    };
  }

  return { ...base, valid: true };
}
