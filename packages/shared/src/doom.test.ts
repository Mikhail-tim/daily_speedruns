import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOOM_DEMO_VERSION,
  doomTicsToMs,
  formatDoomTime,
  msToDoomTics,
  parseDoomDemo,
} from "./doom.js";

function makeDemo(options: {
  tics: number;
  version?: number;
  skill?: number;
  episode?: number;
  map?: number;
  deathmatch?: number;
  terminator?: boolean;
  trailingBytes?: number;
}): Uint8Array {
  const {
    tics,
    version = DOOM_DEMO_VERSION,
    skill = 4,
    episode = 1,
    map = 1,
    deathmatch = 0,
    terminator = true,
    trailingBytes = 0,
  } = options;

  const header = 13;
  const length = header + tics * 4 + (terminator ? 1 : 0) + trailingBytes;
  const bytes = new Uint8Array(length);
  bytes[0] = version;
  bytes[1] = skill;
  bytes[2] = episode;
  bytes[3] = map;
  bytes[4] = deathmatch;
  bytes[8] = 0; // consoleplayer
  bytes[9] = 1; // playeringame[0]
  if (terminator) bytes[length - 1 - trailingBytes] = 0x80;
  return bytes;
}

test("parses a well formed shareware demo", () => {
  const info = parseDoomDemo(makeDemo({ tics: 700 }));
  assert.equal(info.valid, true, info.reason ?? "");
  assert.equal(info.tics, 700);
  assert.equal(info.header.version, DOOM_DEMO_VERSION);
  assert.equal(info.header.skill, 4);
  assert.equal(info.mapLabel, "E1M1");
  assert.equal(info.header.playersInGame, 1);
});

test("rejects demos recorded on the wrong skill", () => {
  const info = parseDoomDemo(makeDemo({ tics: 100, skill: 2 }));
  assert.equal(info.valid, true, "parseDoomDemo only reads structure");
  assert.equal(info.header.skill, 2);
});

test("rejects an unknown demo version", () => {
  const info = parseDoomDemo(makeDemo({ tics: 100, version: 200 }));
  assert.equal(info.valid, false);
  assert.match(info.reason ?? "", /Unsupported demo version/);
});

test("accepts the Doom 1.8 demo format the pinned IWAD produces", () => {
  const info = parseDoomDemo(makeDemo({ tics: 210, version: 108 }));
  assert.equal(info.valid, true, info.reason ?? "");
  assert.equal(info.header.version, 108);
  assert.equal(info.tics, 210);
});

test("rejects a demo without an end marker", () => {
  const info = parseDoomDemo(makeDemo({ tics: 100, terminator: false }));
  assert.equal(info.valid, false);
  assert.match(info.reason ?? "", /end-of-demo marker/);
});

test("rejects a truncated tic stream", () => {
  const info = parseDoomDemo(makeDemo({ tics: 100, trailingBytes: 1 }));
  assert.equal(info.valid, false);
  assert.match(info.reason ?? "", /multiple of 4 bytes/);
});

test("rejects deathmatch demos", () => {
  const info = parseDoomDemo(makeDemo({ tics: 100, deathmatch: 1 }));
  assert.equal(info.valid, false);
  assert.match(info.reason ?? "", /single-player/);
});

test("rejects a demo shorter than the header", () => {
  const info = parseDoomDemo(new Uint8Array(8));
  assert.equal(info.valid, false);
  assert.match(info.reason ?? "", /too short/);
});

test("converts tics and milliseconds both ways at 35 Hz", () => {
  assert.equal(doomTicsToMs(35), 1000);
  assert.equal(doomTicsToMs(700), 20000);
  assert.equal(msToDoomTics(20000), 700);
  assert.equal(msToDoomTics(doomTicsToMs(1234)), 1234);
});

test("formats leveltime like the intermission screen", () => {
  assert.equal(formatDoomTime(0), "0:00.00");
  assert.equal(formatDoomTime(31_450), "0:31.45");
  assert.equal(formatDoomTime(65_000), "1:05.00");
});
