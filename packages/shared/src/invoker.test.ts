import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  InvokerGameEngine,
  generateInvokerCombo,
  getSpellFromOrbs,
  ALL_SPELLS,
  InvokerAction,
} from "./games/invoker.js";
import { TimestampedInput } from "./types.js";

describe("Invoker Combo Sprint Engine & Verification", () => {
  const engine = new InvokerGameEngine();
  const seed = "2026-10-27:invoker:v1";

  it("identifies all 10 spells accurately regardless of orb input order", () => {
    assert.equal(getSpellFromOrbs(["Q", "Q", "Q"])?.id, "cold-snap");
    assert.equal(getSpellFromOrbs(["Q", "Q", "W"])?.id, "ghost-walk");
    assert.equal(getSpellFromOrbs(["W", "Q", "Q"])?.id, "ghost-walk");
    assert.equal(getSpellFromOrbs(["Q", "W", "Q"])?.id, "ghost-walk");

    assert.equal(getSpellFromOrbs(["Q", "Q", "E"])?.id, "ice-wall");
    assert.equal(getSpellFromOrbs(["E", "Q", "Q"])?.id, "ice-wall");

    assert.equal(getSpellFromOrbs(["W", "W", "W"])?.id, "emp");

    assert.equal(getSpellFromOrbs(["Q", "W", "W"])?.id, "tornado");
    assert.equal(getSpellFromOrbs(["W", "Q", "W"])?.id, "tornado");
    assert.equal(getSpellFromOrbs(["W", "W", "Q"])?.id, "tornado");

    assert.equal(getSpellFromOrbs(["W", "W", "E"])?.id, "alacrity");
    assert.equal(getSpellFromOrbs(["E", "W", "W"])?.id, "alacrity");

    assert.equal(getSpellFromOrbs(["E", "E", "E"])?.id, "sun-strike");

    assert.equal(getSpellFromOrbs(["Q", "E", "E"])?.id, "forge-spirit");
    assert.equal(getSpellFromOrbs(["E", "Q", "E"])?.id, "forge-spirit");

    assert.equal(getSpellFromOrbs(["W", "E", "E"])?.id, "chaos-meteor");
    assert.equal(getSpellFromOrbs(["E", "W", "E"])?.id, "chaos-meteor");

    assert.equal(getSpellFromOrbs(["Q", "W", "E"])?.id, "deafening-blast");
    assert.equal(getSpellFromOrbs(["E", "W", "Q"])?.id, "deafening-blast");
    assert.equal(getSpellFromOrbs(["W", "E", "Q"])?.id, "deafening-blast");
  });

  it("produces deterministic combo sequence from seed", () => {
    const c1 = generateInvokerCombo(seed);
    const c2 = generateInvokerCombo(seed);

    assert.equal(c1.comboName, c2.comboName);
    assert.equal(c1.spells.length, 10);
    assert.equal(c2.spells.length, 10);

    for (let i = 0; i < 10; i++) {
      assert.equal(c1.spells[i].id, c2.spells[i].id);
    }
  });

  it("manages orbs queue and Dota 2 D/F spell slots properly", () => {
    let state = engine.init(seed);

    // Press Q, Q, Q
    state = engine.step(state, { type: "ORB", orb: "Q" }).state;
    state = engine.step(state, { type: "ORB", orb: "Q" }).state;
    state = engine.step(state, { type: "ORB", orb: "Q" }).state;
    assert.deepEqual(state.orbs, ["Q", "Q", "Q"]);

    // Invoke Cold Snap
    const invokeRes = engine.step(state, { type: "INVOKE" });
    state = invokeRes.state;
    assert.equal(state.slotD?.id, "cold-snap");
    assert.equal(state.slotF, null);

    // Press E, E, E and invoke Sun Strike
    state = engine.step(state, { type: "ORB", orb: "E" }).state;
    state = engine.step(state, { type: "ORB", orb: "E" }).state;
    state = engine.step(state, { type: "ORB", orb: "E" }).state;
    assert.deepEqual(state.orbs, ["E", "E", "E"]);

    state = engine.step(state, { type: "INVOKE" }).state;
    assert.equal(state.slotD?.id, "sun-strike");
    assert.equal(state.slotF?.id, "cold-snap", "Previous slot D shifts to slot F");

    // Re-invoke Cold Snap (Q, Q, Q) -> should swap slots
    state = engine.step(state, { type: "ORB", orb: "Q" }).state;
    state = engine.step(state, { type: "ORB", orb: "Q" }).state;
    state = engine.step(state, { type: "ORB", orb: "Q" }).state;
    state = engine.step(state, { type: "INVOKE" }).state;
    assert.equal(state.slotD?.id, "cold-snap", "Cold snap moved back to D");
    assert.equal(state.slotF?.id, "sun-strike", "Sun strike moved to F");
  });

  it("starts with an empty orb bar and needs three orbs to invoke", () => {
    let state = engine.init(seed);
    assert.deepEqual(state.orbs, [], "Invoker starts with no orbs up");

    const early = engine.step(state, { type: "INVOKE" });
    assert.equal(early.state.slotD, null);
    assert.equal(early.invokedSpell, undefined);

    state = engine.step(state, { type: "ORB", orb: "Q" }).state;
    state = engine.step(state, { type: "ORB", orb: "Q" }).state;
    assert.deepEqual(state.orbs, ["Q", "Q"]);

    const stillEarly = engine.step(state, { type: "INVOKE" });
    assert.equal(stillEarly.state.slotD, null);

    state = engine.step(state, { type: "ORB", orb: "Q" }).state;
    const coldSnap = engine.step(state, { type: "INVOKE" });
    assert.equal(coldSnap.state.slotD?.id, "cold-snap");
  });

  it("rejects malformed actions instead of silently ignoring them", () => {
    const badOrb = engine.verify(
      seed,
      [{ t: 100, action: { type: "ORB", orb: "X" } as unknown as InvokerAction }],
      5000
    );
    assert.equal(badOrb.valid, false);
    assert.match(badOrb.reason || "", /Unknown orb type/);

    const badSlot = engine.verify(
      seed,
      [{ t: 100, action: { type: "CAST", slot: "Z" } as unknown as InvokerAction }],
      5000
    );
    assert.equal(badSlot.valid, false);
    assert.match(badSlot.reason || "", /Unknown spell slot/);

    const badType = engine.verify(
      seed,
      [{ t: 100, action: { type: "TELEPORT" } as unknown as InvokerAction }],
      5000
    );
    assert.equal(badType.valid, false);
    assert.match(badType.reason || "", /Unknown action type/);
  });

  it("advances target when correctly cast and increments mistakes on wrong cast", () => {
    let state = engine.init(seed);
    const target0 = state.sequence[0];

    // Empty slot cast
    let res = engine.step(state, { type: "CAST", slot: "D" });
    assert.equal(res.castSuccess, false);
    assert.equal(res.state.mistakes, 1);
    assert.equal(res.state.targetIndex, 0);

    // Prepare target 0 recipe
    state = res.state;
    for (const orb of target0.recipe) {
      state = engine.step(state, { type: "ORB", orb }).state;
    }
    state = engine.step(state, { type: "INVOKE" }).state;
    assert.equal(state.slotD?.id, target0.id);

    // Cast slot D
    res = engine.step(state, { type: "CAST", slot: "D" });
    assert.equal(res.castSuccess, true);
    assert.equal(res.state.targetIndex, 1);
  });

  it("verifies a valid winning run", () => {
    const { spells } = generateInvokerCombo(seed);
    const inputs: TimestampedInput<InvokerAction>[] = [];
    let t = 200;

    for (let i = 0; i < spells.length; i++) {
      const spell = spells[i];
      // Input orbs
      for (const orb of spell.recipe) {
        inputs.push({ t, action: { type: "ORB", orb } });
        t += 60;
      }
      // Invoke
      inputs.push({ t, action: { type: "INVOKE" } });
      t += 70;
      // Cast
      inputs.push({ t, action: { type: "CAST", slot: "D" } });
      t += 90;
    }

    const claimedTimeMs = t - 90; // time of last cast
    const result = engine.verify(seed, inputs, claimedTimeMs);

    assert.equal(result.valid, true);
    assert.equal(result.verifiedTimeMs, claimedTimeMs);
    assert.equal(result.summary?.spellsCount, 10);
    assert.equal(result.summary?.mistakes, 0);
    assert.equal(result.summary?.accuracyPercent, 100);
  });

  it("rejects run that does not complete all spells", () => {
    const { spells } = generateInvokerCombo(seed);
    const inputs: TimestampedInput<InvokerAction>[] = [];
    let t = 200;

    // Only cast first 3 spells
    for (let i = 0; i < 3; i++) {
      const spell = spells[i];
      for (const orb of spell.recipe) {
        inputs.push({ t, action: { type: "ORB", orb } });
        t += 80;
      }
      inputs.push({ t, action: { type: "INVOKE" } });
      t += 80;
      inputs.push({ t, action: { type: "CAST", slot: "D" } });
      t += 100;
    }

    const result = engine.verify(seed, inputs, t);
    assert.equal(result.valid, false);
    assert.match(result.reason || "", /Completed only 3/);
  });

  it("rejects inhumanly fast bot run (< 1.0s)", () => {
    const { spells } = generateInvokerCombo(seed);
    const inputs: TimestampedInput<InvokerAction>[] = [];
    let t = 10;

    for (let i = 0; i < spells.length; i++) {
      const spell = spells[i];
      for (const orb of spell.recipe) {
        inputs.push({ t, action: { type: "ORB", orb } });
        t += 10;
      }
      inputs.push({ t, action: { type: "INVOKE" } });
      t += 10;
      inputs.push({ t, action: { type: "CAST", slot: "D" } });
      t += 10;
    }

    const claimedTimeMs = t - 10; // ~500ms
    const result = engine.verify(seed, inputs, claimedTimeMs);
    assert.equal(result.valid, false);
    assert.match(result.reason || "", /exceeds human physical speed/);
  });

  it("rejects excessively drifting claimed time", () => {
    const { spells } = generateInvokerCombo(seed);
    const inputs: TimestampedInput<InvokerAction>[] = [];
    let t = 200;

    for (let i = 0; i < spells.length; i++) {
      const spell = spells[i];
      for (const orb of spell.recipe) {
        inputs.push({ t, action: { type: "ORB", orb } });
        t += 60;
      }
      inputs.push({ t, action: { type: "INVOKE" } });
      t += 70;
      inputs.push({ t, action: { type: "CAST", slot: "D" } });
      t += 90;
    }

    const realTimeMs = t - 90;
    const fakeClaimedTimeMs = realTimeMs - 2000; // 2 seconds drift
    const result = engine.verify(seed, inputs, fakeClaimedTimeMs);

    assert.equal(result.valid, false);
    assert.match(result.reason || "", /drifts from verified time/);
  });
});
