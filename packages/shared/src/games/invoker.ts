import {
  GameEngine,
  TimestampedInput,
  VerificationResult,
} from "../types.js";
import { createPRNG, randomInt } from "../prng.js";

export type OrbType = "Q" | "W" | "E";

export type SpellId =
  | "cold-snap"
  | "ghost-walk"
  | "ice-wall"
  | "emp"
  | "tornado"
  | "alacrity"
  | "sun-strike"
  | "forge-spirit"
  | "chaos-meteor"
  | "deafening-blast";

export interface SpellDef {
  id: SpellId;
  name: string;
  recipe: [OrbType, OrbType, OrbType];
  quas: number;
  wex: number;
  exort: number;
  description: string;
  legacyKey: string;
}

export const ALL_SPELLS: Record<SpellId, SpellDef> = {
  "cold-snap": {
    id: "cold-snap",
    name: "Cold Snap",
    recipe: ["Q", "Q", "Q"],
    quas: 3,
    wex: 0,
    exort: 0,
    description: "Freezes target on hit repeatedly, dealing bonus damage.",
    legacyKey: "Y",
  },
  "ghost-walk": {
    id: "ghost-walk",
    name: "Ghost Walk",
    recipe: ["Q", "Q", "W"],
    quas: 2,
    wex: 1,
    exort: 0,
    description: "Enters invisibility, slowing nearby enemy units.",
    legacyKey: "V",
  },
  "ice-wall": {
    id: "ice-wall",
    name: "Ice Wall",
    recipe: ["Q", "Q", "E"],
    quas: 2,
    wex: 0,
    exort: 1,
    description: "Generates an impassable wall of ice that severely slows and damages.",
    legacyKey: "G",
  },
  emp: {
    id: "emp",
    name: "E.M.P.",
    recipe: ["W", "W", "W"],
    quas: 0,
    wex: 3,
    exort: 0,
    description: "Detonates electromagnetic charge, burning mana and dealing damage.",
    legacyKey: "C",
  },
  tornado: {
    id: "tornado",
    name: "Tornado",
    recipe: ["Q", "W", "W"],
    quas: 1,
    wex: 2,
    exort: 0,
    description: "Fires a vortex that sweeps enemies into the air and dispels buffs.",
    legacyKey: "X",
  },
  alacrity: {
    id: "alacrity",
    name: "Alacrity",
    recipe: ["W", "W", "E"],
    quas: 0,
    wex: 2,
    exort: 1,
    description: "Infuses an ally or self with blinding attack speed and bonus damage.",
    legacyKey: "Z",
  },
  "sun-strike": {
    id: "sun-strike",
    name: "Sun Strike",
    recipe: ["E", "E", "E"],
    quas: 0,
    wex: 0,
    exort: 3,
    description: "Calls down a catastrophic solar flare at any location on the map.",
    legacyKey: "T",
  },
  "forge-spirit": {
    id: "forge-spirit",
    name: "Forge Spirit",
    recipe: ["Q", "E", "E"],
    quas: 1,
    wex: 0,
    exort: 2,
    description: "Manifests a scorching elemental spirit that reduces armor.",
    legacyKey: "F",
  },
  "chaos-meteor": {
    id: "chaos-meteor",
    name: "Chaos Meteor",
    recipe: ["W", "E", "E"],
    quas: 0,
    wex: 1,
    exort: 2,
    description: "Summons a flaming meteor that rolls forward, incinerating foes.",
    legacyKey: "D",
  },
  "deafening-blast": {
    id: "deafening-blast",
    name: "Deafening Blast",
    recipe: ["Q", "W", "E"],
    quas: 1,
    wex: 1,
    exort: 1,
    description: "Releases a crushing sonic blast that pushes back and disarms enemies.",
    legacyKey: "B",
  },
};

export const SPELL_LIST: SpellDef[] = Object.values(ALL_SPELLS);

/**
 * Maps orb counts to corresponding spell
 */
export function getSpellFromOrbs(orbs: OrbType[]): SpellDef | null {
  if (orbs.length !== 3) return null;
  let q = 0;
  let w = 0;
  let e = 0;
  for (const orb of orbs) {
    if (orb === "Q") q++;
    else if (orb === "W") w++;
    else if (orb === "E") e++;
  }

  if (q === 3) return ALL_SPELLS["cold-snap"];
  if (q === 2 && w === 1) return ALL_SPELLS["ghost-walk"];
  if (q === 2 && e === 1) return ALL_SPELLS["ice-wall"];
  if (w === 3) return ALL_SPELLS["emp"];
  if (q === 1 && w === 2) return ALL_SPELLS["tornado"];
  if (w === 2 && e === 1) return ALL_SPELLS["alacrity"];
  if (e === 3) return ALL_SPELLS["sun-strike"];
  if (q === 1 && e === 2) return ALL_SPELLS["forge-spirit"];
  if (w === 1 && e === 2) return ALL_SPELLS["chaos-meteor"];
  if (q === 1 && w === 1 && e === 1) return ALL_SPELLS["deafening-blast"];
  return null;
}

/**
 * Competitive combo archetypes for Invoker daily sprint.
 */
export const CURATED_COMBOS: Array<{ name: string; spells: SpellId[] }> = [
  {
    name: "Cataclysmic Teamfight",
    spells: [
      "tornado",
      "emp",
      "chaos-meteor",
      "deafening-blast",
      "sun-strike",
      "ice-wall",
      "cold-snap",
      "alacrity",
      "forge-spirit",
      "ghost-walk",
    ],
  },
  {
    name: "Eul's One-Shot Burst",
    spells: [
      "tornado",
      "sun-strike",
      "chaos-meteor",
      "deafening-blast",
      "cold-snap",
      "alacrity",
      "emp",
      "ice-wall",
      "forge-spirit",
      "ghost-walk",
    ],
  },
  {
    name: "Control & Mana Burn",
    spells: [
      "tornado",
      "emp",
      "cold-snap",
      "ice-wall",
      "alacrity",
      "chaos-meteor",
      "deafening-blast",
      "sun-strike",
      "forge-spirit",
      "ghost-walk",
    ],
  },
  {
    name: "Armor Melt Execution",
    spells: [
      "cold-snap",
      "forge-spirit",
      "alacrity",
      "sun-strike",
      "chaos-meteor",
      "deafening-blast",
      "tornado",
      "emp",
      "ice-wall",
      "ghost-walk",
    ],
  },
  {
    name: "The Grand Magus Trial",
    spells: [
      "tornado",
      "chaos-meteor",
      "deafening-blast",
      "sun-strike",
      "emp",
      "cold-snap",
      "ice-wall",
      "alacrity",
      "forge-spirit",
      "ghost-walk",
    ],
  },
];

/**
 * Generates the deterministic competitive combo sequence for a given seed.
 */
export function generateInvokerCombo(seed: string): {
  comboName: string;
  spells: SpellDef[];
} {
  const rng = createPRNG(seed);
  const archetypeIdx = randomInt(rng, 0, CURATED_COMBOS.length - 1);
  const archetype = CURATED_COMBOS[archetypeIdx];

  // We take the 10 spells and optionally perform deterministic subtle swaps
  // while preserving competitive flow
  const spellIds = [...archetype.spells];

  // Deterministically shuffle middle segments to create distinct daily combinations
  // but keep classic openers intact
  for (let i = 2; i < spellIds.length - 1; i++) {
    const swapTarget = randomInt(rng, 2, spellIds.length - 2);
    const temp = spellIds[i];
    spellIds[i] = spellIds[swapTarget];
    spellIds[swapTarget] = temp;
  }

  const spells = spellIds.map((id) => ALL_SPELLS[id]);
  return {
    comboName: archetype.name,
    spells,
  };
}

export type InvokerAction =
  | { type: "ORB"; orb: OrbType }
  | { type: "INVOKE" }
  | { type: "CAST"; slot: "D" | "F" };

export interface InvokerState {
  comboName: string;
  sequence: SpellDef[];
  targetIndex: number;
  orbs: OrbType[];
  slotD: SpellDef | null;
  slotF: SpellDef | null;
  mistakes: number;
  totalKeypresses: number;
  completed: boolean;
}

export interface InvokerSummary {
  comboName: string;
  spellsCount: number;
  totalKeypresses: number;
  mistakes: number;
  accuracyPercent: number;
}

export class InvokerGameEngine
  implements GameEngine<InvokerAction, InvokerState, InvokerSummary>
{
  readonly gameId = "invoker";
  readonly name = "Invoker Combo Sprint";
  readonly description =
    "Execute high-level competitive Dota 2 Invoker combos against the clock.";
  readonly targetDescription = "Cast all 10 combo spells in succession";

  init(seed: string): InvokerState {
    const { comboName, spells } = generateInvokerCombo(seed);
    return {
      comboName,
      sequence: spells,
      targetIndex: 0,
      orbs: ["Q", "W", "E"],
      slotD: null,
      slotF: null,
      mistakes: 0,
      totalKeypresses: 0,
      completed: false,
    };
  }

  step(
    state: InvokerState,
    action?: InvokerAction
  ): {
    state: InvokerState;
    win: boolean;
    gameOver: boolean;
    castSuccess?: boolean;
    castSpell?: SpellDef;
    invokedSpell?: SpellDef;
  } {
    if (!action || state.completed) {
      return { state, win: state.completed, gameOver: false };
    }

    const nextState: InvokerState = {
      ...state,
      orbs: [...state.orbs],
      totalKeypresses: state.totalKeypresses + 1,
    };

    if (action.type === "ORB") {
      nextState.orbs = [...nextState.orbs, action.orb].slice(-3);
      return { state: nextState, win: false, gameOver: false };
    }

    if (action.type === "INVOKE") {
      const spell = getSpellFromOrbs(nextState.orbs);
      if (!spell) {
        return { state: nextState, win: false, gameOver: false };
      }

      // If spell is already in slot D, keep it
      if (nextState.slotD?.id === spell.id) {
        return {
          state: nextState,
          win: false,
          gameOver: false,
          invokedSpell: spell,
        };
      }

      // If spell is in slot F, swap slots D and F
      if (nextState.slotF?.id === spell.id) {
        nextState.slotF = nextState.slotD;
        nextState.slotD = spell;
        return {
          state: nextState,
          win: false,
          gameOver: false,
          invokedSpell: spell,
        };
      }

      // Otherwise slot D becomes new spell, slot F becomes old slot D
      nextState.slotF = nextState.slotD;
      nextState.slotD = spell;
      return {
        state: nextState,
        win: false,
        gameOver: false,
        invokedSpell: spell,
      };
    }

    if (action.type === "CAST") {
      const castSpell = action.slot === "D" ? nextState.slotD : nextState.slotF;
      const expectedSpell = nextState.sequence[nextState.targetIndex];

      if (castSpell && expectedSpell && castSpell.id === expectedSpell.id) {
        nextState.targetIndex++;
        const win = nextState.targetIndex >= nextState.sequence.length;
        nextState.completed = win;
        return {
          state: nextState,
          win,
          gameOver: false,
          castSuccess: true,
          castSpell,
        };
      } else {
        nextState.mistakes++;
        return {
          state: nextState,
          win: false,
          gameOver: false,
          castSuccess: false,
          castSpell: castSpell ?? undefined,
        };
      }
    }

    return { state: nextState, win: false, gameOver: false };
  }

  verify(
    seed: string,
    inputs: TimestampedInput<InvokerAction>[],
    claimedTimeMs: number
  ): VerificationResult<InvokerSummary> {
    if (!Array.isArray(inputs) || inputs.length === 0) {
      return { valid: false, reason: "No inputs submitted" };
    }

    if (inputs.length > 1000) {
      return { valid: false, reason: "Too many inputs submitted" };
    }

    if (
      typeof claimedTimeMs !== "number" ||
      !Number.isFinite(claimedTimeMs) ||
      claimedTimeMs <= 0
    ) {
      return { valid: false, reason: "Invalid claimed time" };
    }

    let state = this.init(seed);
    let previousTime = -1;
    let lastCorrectTimeMs = 0;

    for (let i = 0; i < inputs.length; i++) {
      const entry = inputs[i];
      if (!entry) {
        return { valid: false, reason: "Invalid input entry" };
      }

      const { t, action } = entry;
      if (typeof t !== "number" || !Number.isFinite(t) || t < 0) {
        return { valid: false, reason: "Invalid input timestamp" };
      }

      if (t < previousTime) {
        return { valid: false, reason: "Timestamps must be non-decreasing" };
      }
      previousTime = t;

      if (!action || typeof action !== "object" || !("type" in action)) {
        return { valid: false, reason: "Missing or malformed input action" };
      }

      const prevTarget = state.targetIndex;
      const stepRes = this.step(state, action);
      state = stepRes.state;

      if (state.targetIndex > prevTarget) {
        lastCorrectTimeMs = t;
      }

      if (state.completed) {
        break;
      }
    }

    if (!state.completed || state.targetIndex < state.sequence.length) {
      return {
        valid: false,
        reason: `Completed only ${state.targetIndex} of ${state.sequence.length} combo spells`,
      };
    }

    // Physical human speed sanity check: Minimum 1.0 seconds total for 10 combo spells (invoking + casting)
    if (lastCorrectTimeMs < 1000) {
      return {
        valid: false,
        reason: "Time exceeds human physical speed limits (< 1.0s total)",
      };
    }

    const tolerance = 600; // 600ms network & browser submission drift tolerance
    if (Math.abs(claimedTimeMs - lastCorrectTimeMs) > tolerance) {
      return {
        valid: false,
        reason: `Claimed time (${claimedTimeMs}ms) drifts from verified time (${lastCorrectTimeMs}ms)`,
      };
    }

    const totalKeypresses = state.totalKeypresses;
    const accuracyPercent = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          ((totalKeypresses - state.mistakes) / Math.max(1, totalKeypresses)) *
            100
        )
      )
    );

    return {
      valid: true,
      verifiedTimeMs: lastCorrectTimeMs,
      summary: {
        comboName: state.comboName,
        spellsCount: state.sequence.length,
        totalKeypresses,
        mistakes: state.mistakes,
        accuracyPercent,
      },
    };
  }
}
