import { GameEngine, TimestampedInput, VerificationResult } from "../types.js";
import {
  DOOM_CHALLENGE_LABEL,
  DOOM_DEMO_SKILL_ULTRA_VIOLENCE,
  DOOM_ENGINE_BUILD,
  DOOM_IWAD_SHA256,
  DOOM_SKILL_ARG_ULTRA_VIOLENCE,
} from "../doom.js";

/**
 * Doom is registered so that the generic challenge/leaderboard plumbing can
 * resolve its display metadata, but it deliberately does **not** implement the
 * deterministic `init`/`step`/`verify` contract.
 *
 * A Doom run is an opaque `.lmp` demo recorded by a real Chocolate Doom
 * WebAssembly build. There is no seed and no replayable input stream we can
 * simulate on the edge, so submissions take a separate route through
 * `POST /api/runs` and wait for manual demo review.
 */
export class DoomEvent implements GameEngine<never, never, Record<string, unknown>> {
  readonly gameId = "doom";
  readonly name = "Doom (1993)";
  readonly description =
    `Shareware Doom, ${DOOM_CHALLENGE_LABEL} "Hangar". Ultra-Violence, pistol start, no saves.`;
  readonly targetDescription = `Fastest ${DOOM_CHALLENGE_LABEL} level time`;

  /** Locked competitive settings for the event. */
  readonly mapLabel = DOOM_CHALLENGE_LABEL;
  /** `-skill` argument used to launch the engine. */
  readonly skill = DOOM_SKILL_ARG_ULTRA_VIOLENCE;
  /** What a demo recorded on this challenge carries in its header. */
  readonly demoSkill = DOOM_DEMO_SKILL_ULTRA_VIOLENCE;
  readonly iwadSha256 = DOOM_IWAD_SHA256;
  readonly engineBuild = DOOM_ENGINE_BUILD;
  readonly verificationMode = "demo-review" as const;

  init(): never {
    throw new Error(
      "Doom has no seeded simulation; runs are recorded demos, not input replays"
    );
  }

  step(): never {
    throw new Error(
      "Doom has no seeded simulation; runs are recorded demos, not input replays"
    );
  }

  verify(
    _seed: string,
    _inputs: TimestampedInput<never>[],
    _claimedTimeMs: number
  ): VerificationResult {
    return {
      valid: false,
      reason:
        "Doom runs are verified from their demo recording, not by input replay",
    };
  }
}

export const doomEvent = new DoomEvent();
