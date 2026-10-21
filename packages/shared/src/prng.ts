/**
 * Deterministic PRNG utilities for Daily Speedruns.
 * Mulberry32 is lightweight, fast, and produces identical sequences
 * across all modern JavaScript engines.
 */

/**
 * 32-bit FNV-1a hash to convert any string seed (e.g. "2026-10-19:snake")
 * into a 32-bit unsigned integer seed.
 */
export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Pure step function for Mulberry32.
 * Given an integer state, returns the next pseudo-random float in [0, 1)
 * and the next 32-bit integer state.
 */
export function nextPRNG(state: number): { value: number; nextState: number } {
  let s = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, nextState: s };
}

/**
 * Pure helper to get an integer in [min, max] inclusive and the updated state.
 */
export function nextRandomInt(
  state: number,
  min: number,
  max: number
): { value: number; nextState: number } {
  const { value, nextState } = nextPRNG(state);
  const intVal = min + Math.floor(value * (max - min + 1));
  return { value: intVal, nextState };
}

/**
 * Stateful wrapper for Mulberry32 for convenience where state mutation is acceptable.
 */
export function createPRNG(seed: string | number): () => number {
  let s = typeof seed === "string" ? hashString(seed) : seed >>> 0;

  return function next(): number {
    const res = nextPRNG(s);
    s = res.nextState;
    return res.value;
  };
}

/**
 * Helper to get a random integer in [min, max] inclusive using a PRNG function.
 */
export function randomInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

