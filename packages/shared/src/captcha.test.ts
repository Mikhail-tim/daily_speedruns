import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CAPTCHA_CATEGORIES,
  CAPTCHA_GRID_SIZE,
  CaptchaAction,
  CaptchaEngine,
  CaptchaMode,
  generateCaptchaChallenge,
} from "./games/captcha.js";
import {
  CAPTCHA_CATEGORY_ASSETS,
  CAPTCHA_DISTRACTOR_ASSETS,
} from "./games/captcha-manifest.js";
import { TimestampedInput } from "./types.js";

function findSeed(mode: CaptchaMode): string {
  for (let i = 0; i < 1000; i++) {
    const seed = `mode-${mode}-${i}`;
    if (generateCaptchaChallenge(seed).mode === mode) return seed;
  }
  throw new Error(`Could not find a ${mode} seed`);
}

const STATIC_SEED = findSeed("static");
const DYNAMIC_SEED = findSeed("dynamic");

describe("reCAPTCHA Sprint — authentic challenge generation", () => {
  it("bundles real tiles for every authentic category", () => {
    assert.ok(CAPTCHA_CATEGORIES.length >= 10);
    for (const category of CAPTCHA_CATEGORIES) {
      const assets = CAPTCHA_CATEGORY_ASSETS[category.key];
      assert.ok(assets, `missing asset list for ${category.key}`);
      assert.ok(assets.length >= 4, `not enough tiles for ${category.key}`);
      for (const asset of assets) {
        assert.match(asset, new RegExp(`^${category.key}/\\d{3}\\.png$`));
      }
    }
    assert.ok(CAPTCHA_DISTRACTOR_ASSETS.length >= 8);
    assert.ok(CAPTCHA_DISTRACTOR_ASSETS.every((asset) => asset.startsWith("other/")));
  });

  it("produces a deterministic 3x3 challenge from the seed", () => {
    const c1 = generateCaptchaChallenge(STATIC_SEED);
    const c2 = generateCaptchaChallenge(STATIC_SEED);

    assert.equal(c1.gridSize, CAPTCHA_GRID_SIZE);
    assert.equal(c1.tiles.length, 9);
    assert.equal(c1.category, c2.category);
    assert.equal(c1.mode, c2.mode);
    assert.equal(c1.prompt, c2.prompt);
    assert.deepEqual(c1.targetIndices, c2.targetIndices);
    assert.deepEqual(c1.replacements, c2.replacements);

    for (let i = 0; i < 9; i++) {
      assert.equal(c1.tiles[i].id, c2.tiles[i].id);
      assert.equal(c1.tiles[i].imageSrc, c2.tiles[i].imageSrc);
      assert.equal(c1.tiles[i].isTarget, c2.tiles[i].isTarget);
    }
  });

  it("builds a valid, authentic grid", () => {
    for (const seed of [STATIC_SEED, DYNAMIC_SEED]) {
      const challenge = generateCaptchaChallenge(seed);
      const category = CAPTCHA_CATEGORIES.find((c) => c.key === challenge.category);

      assert.ok(category);
      assert.equal(challenge.categoryDisplayName, category.pluralName);
      assert.match(
        challenge.prompt,
        /^Select all (images|squares) with .+$/
      );
      assert.ok(challenge.prompt.endsWith(category.pluralName));
      assert.ok(challenge.targetIndices.length >= 2);
      assert.ok(challenge.targetIndices.length < 9);
      assert.equal(new Set(challenge.targetIndices).size, challenge.targetIndices.length);

      // Every target position really holds a target tile, and vice versa.
      challenge.tiles.forEach((tile, index) => {
        assert.equal(tile.isTarget, challenge.targetIndices.includes(index));
        assert.equal(tile.index, index);
        assert.ok(tile.imageSrc.startsWith("/captcha/"));
        assert.match(tile.alt, /^Captcha tile \d$/);
      });

      // The sample thumbnail is one of the matching images.
      assert.ok(
        challenge.tiles.some(
          (tile) => tile.isTarget && tile.imageSrc === challenge.sampleImageSrc
        )
      );

      // All nine cells are distinct real tiles.
      assert.equal(new Set(challenge.tiles.map((t) => t.asset)).size, 9);
    }
  });

  it("produces different challenges for different seeds", () => {
    const c1 = generateCaptchaChallenge("seed-alpha-1");
    const c2 = generateCaptchaChallenge("seed-beta-2");
    assert.notDeepEqual(
      {
        category: c1.category,
        targets: c1.targetIndices,
        tiles: c1.tiles.map((t) => t.asset),
      },
      {
        category: c2.category,
        targets: c2.targetIndices,
        tiles: c2.tiles.map((t) => t.asset),
      }
    );
  });
});

describe("reCAPTCHA Sprint — static variant", () => {
  const engine = new CaptchaEngine();
  const state = engine.init(STATIC_SEED);

  it("toggles selections and rejects an empty verify", () => {
    const target = state.challenge.targetIndices[0];

    const s1 = engine.step(state, { type: "TOGGLE", index: target }).state;
    assert.deepEqual(s1.selectedIndices, [target]);

    const s2 = engine.step(s1, { type: "TOGGLE", index: target }).state;
    assert.deepEqual(s2.selectedIndices, []);

    const verifyFail = engine.step(s2, { type: "VERIFY" });
    assert.equal(verifyFail.win, false);
    assert.equal(verifyFail.state.mistakes, 1);
  });

  it("rejects a selection that includes a distractor", () => {
    let current = engine.init(STATIC_SEED);
    for (const idx of current.challenge.targetIndices) {
      current = engine.step(current, { type: "TOGGLE", index: idx }).state;
    }
    const distractor = current.challenge.tiles.find((t) => !t.isTarget)!.index;
    current = engine.step(current, { type: "TOGGLE", index: distractor }).state;

    const result = engine.step(current, { type: "VERIFY" });
    assert.equal(result.win, false);
    assert.equal(result.state.mistakes, 1);
  });

  it("wins when every matching tile is selected", () => {
    let current = engine.init(STATIC_SEED);
    for (const idx of current.challenge.targetIndices) {
      current = engine.step(current, { type: "TOGGLE", index: idx }).state;
    }
    assert.deepEqual(current.selectedIndices, current.challenge.targetIndices);

    const result = engine.step(current, { type: "VERIFY" });
    assert.equal(result.win, true);
    assert.equal(result.correct, true);
    assert.equal(result.state.completed, true);
  });
});

describe("reCAPTCHA Sprint — dynamic variant", () => {
  const engine = new CaptchaEngine();

  it("refreshes a matched tile with a new non-target image", () => {
    const state = engine.init(DYNAMIC_SEED);
    assert.equal(state.challenge.mode, "dynamic");
    assert.equal(state.remainingTargets, state.challenge.targetIndices.length);
    assert.equal(
      state.challenge.replacements.length,
      state.challenge.targetIndices.length
    );

    const idx = state.challenge.targetIndices[0];
    const before = state.challenge.tiles[idx];

    const result = engine.step(state, { type: "TOGGLE", index: idx });
    const after = result.state.challenge.tiles[idx];

    assert.equal(after.isTarget, false);
    assert.equal(after.replaced, true);
    assert.notEqual(after.asset, before.asset);
    assert.equal(after.asset, state.challenge.replacements[0]);
    assert.deepEqual(result.state.selectedIndices, []);
    assert.deepEqual(result.state.solvedIndices, [idx]);
    assert.equal(result.state.remainingTargets, state.remainingTargets - 1);
  });

  it("selects distractor tiles like a real captcha", () => {
    const state = engine.init(DYNAMIC_SEED);
    const distractor = state.challenge.tiles.find((t) => !t.isTarget)!.index;
    const result = engine.step(state, { type: "TOGGLE", index: distractor });
    assert.deepEqual(result.state.selectedIndices, [distractor]);
  });

  it("wins after all matches have been refreshed", () => {
    let current = engine.init(DYNAMIC_SEED);
    for (const idx of current.challenge.targetIndices) {
      current = engine.step(current, { type: "TOGGLE", index: idx }).state;
    }
    assert.equal(current.remainingTargets, 0);

    const result = engine.step(current, { type: "VERIFY" });
    assert.equal(result.win, true);
    assert.equal(result.state.completed, true);
  });

  it("requires wrong selections to be cleared before verifying", () => {
    let current = engine.init(DYNAMIC_SEED);
    const distractor = current.challenge.tiles.find((t) => !t.isTarget)!.index;
    current = engine.step(current, { type: "TOGGLE", index: distractor }).state;

    for (const idx of current.challenge.targetIndices) {
      current = engine.step(current, { type: "TOGGLE", index: idx }).state;
    }

    const failed = engine.step(current, { type: "VERIFY" });
    assert.equal(failed.win, false);
    assert.equal(failed.state.mistakes, 1);

    const cleared = engine.step(failed.state, {
      type: "TOGGLE",
      index: distractor,
    }).state;
    const won = engine.step(cleared, { type: "VERIFY" });
    assert.equal(won.win, true);
  });
});

describe("reCAPTCHA Sprint — server-side replay verification", () => {
  const engine = new CaptchaEngine();

  function validInputs(
    seed: string,
    perClickMs = 250
  ): { inputs: TimestampedInput<CaptchaAction>[]; finish: number } {
    const challenge = generateCaptchaChallenge(seed);
    const inputs: TimestampedInput<CaptchaAction>[] = [];
    let t = 200;
    for (const idx of challenge.targetIndices) {
      t += perClickMs;
      inputs.push({ t, action: { type: "TOGGLE", index: idx } });
    }
    t += 300;
    inputs.push({ t, action: { type: "VERIFY" } });
    return { inputs, finish: t };
  }

  it("verifies a valid static run", () => {
    const { inputs, finish } = validInputs(STATIC_SEED);
    const result = engine.verify(STATIC_SEED, inputs, finish);
    assert.equal(result.valid, true);
    assert.equal(result.verifiedTimeMs, finish);
    assert.equal(result.summary?.mode, "static");
    assert.equal(result.summary?.gridSize, 3);
  });

  it("verifies a valid dynamic run", () => {
    const { inputs, finish } = validInputs(DYNAMIC_SEED);
    const result = engine.verify(DYNAMIC_SEED, inputs, finish);
    assert.equal(result.valid, true);
    assert.equal(result.verifiedTimeMs, finish);
    assert.equal(result.summary?.mode, "dynamic");
  });

  it("rejects a wrong selection", () => {
    const challenge = generateCaptchaChallenge(STATIC_SEED);
    const distractor = challenge.tiles.find((t) => !t.isTarget)!.index;
    const inputs: TimestampedInput<CaptchaAction>[] = [
      { t: 300, action: { type: "TOGGLE", index: distractor } },
      { t: 700, action: { type: "VERIFY" } },
    ];
    const result = engine.verify(STATIC_SEED, inputs, 700);
    assert.equal(result.valid, false);
    assert.match(result.reason || "", /not successfully verified/);
  });

  it("rejects bot speed (< 300ms)", () => {
    const challenge = generateCaptchaChallenge(STATIC_SEED);
    const inputs: TimestampedInput<CaptchaAction>[] = challenge.targetIndices.map(
      (idx, i) => ({
        t: 10 * (i + 1),
        action: { type: "TOGGLE", index: idx },
      })
    );
    inputs.push({ t: 100, action: { type: "VERIFY" } });

    const result = engine.verify(STATIC_SEED, inputs, 100);
    assert.equal(result.valid, false);
    assert.match(result.reason || "", /human cognitive speed limits/);
  });

  it("rejects out-of-order timestamps", () => {
    const challenge = generateCaptchaChallenge(STATIC_SEED);
    const inputs: TimestampedInput<CaptchaAction>[] = [
      { t: 900, action: { type: "TOGGLE", index: challenge.targetIndices[0] } },
      { t: 300, action: { type: "TOGGLE", index: challenge.targetIndices[1] } },
      { t: 1200, action: { type: "VERIFY" } },
    ];
    const result = engine.verify(STATIC_SEED, inputs, 1200);
    assert.equal(result.valid, false);
    assert.match(result.reason || "", /non-decreasing/);
  });

  it("rejects invalid tile indices", () => {
    const result = engine.verify(
      STATIC_SEED,
      [
        { t: 200, action: { type: "TOGGLE", index: 9 } },
        { t: 800, action: { type: "VERIFY" } },
      ],
      800
    );
    assert.equal(result.valid, false);
    assert.match(result.reason || "", /Invalid tile index/);
  });

  it("rejects a claimed time outside tolerance", () => {
    const { inputs, finish } = validInputs(STATIC_SEED);
    const result = engine.verify(STATIC_SEED, inputs, finish + 5000);
    assert.equal(result.valid, false);
    assert.match(result.reason || "", /drifts from verified finish time/);
  });
});
