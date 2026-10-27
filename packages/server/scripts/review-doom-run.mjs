#!/usr/bin/env node
/**
 * Manual review tool for Doom runs.
 *
 * Doom submissions arrive as `pending` with a `.lmp` demo attached. Nothing
 * promotes them automatically: a human replays the demo, reads the level time
 * off the intermission screen, and approves with that time.
 *
 * Usage (run from the repo root — use `node` directly, because `npm run` would
 * consume flags like `--time` as its own options):
 *
 *   node packages/server/scripts/review-doom-run.mjs list
 *   node packages/server/scripts/review-doom-run.mjs export <runId> --out run.lmp
 *   node packages/server/scripts/review-doom-run.mjs approve <runId> --time 0:31.42
 *   node packages/server/scripts/review-doom-run.mjs reject <runId> --note "demo ends before exit"
 *
 * Add `--remote` to act on the deployed D1 database instead of the local one.
 *
 * Replay an exported demo with a desktop Chocolate Doom build:
 *   chocolate-doom -iwad DOOM1.WAD -playdemo run.lmp
 * The intermission screen shows the authoritative level time.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = resolve(HERE, "..");
const DB_NAME = "daily-speedruns-db";

const argv = process.argv.slice(2);
const command = argv[0];
const flags = new Map();
const positional = [];

for (let i = 1; i < argv.length; i += 1) {
  const token = argv[i];
  if (token.startsWith("--")) {
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      flags.set(key, next);
      i += 1;
    } else {
      flags.set(key, true);
    }
  } else {
    positional.push(token);
  }
}

const remote = flags.has("remote");
const runId = positional[0];

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function requireRunId() {
  if (!runId || !/^[0-9a-fA-F-]{36}$/.test(runId)) {
    console.error("A valid run id is required.");
    process.exit(1);
  }
  return runId;
}

/** Runs a statement through wrangler and returns the result rows. */
function query(sql) {
  // Spawn wrangler's real entry point through node instead of the `npx` shim so
  // SQL containing spaces and quotes is passed as a single argument on every
  // platform.
  const wranglerPkg = require.resolve("wrangler/package.json");
  const wranglerBin = join(dirname(wranglerPkg), "bin", "wrangler.js");
  const args = [
    wranglerBin,
    "d1",
    "execute",
    DB_NAME,
    remote ? "--remote" : "--local",
    "--json",
    "--command",
    sql,
  ];
  const output = execFileSync(process.execPath, args, {
    cwd: SERVER_DIR,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const start = output.indexOf("[");
  if (start === -1) throw new Error(`Unexpected wrangler output:\n${output}`);
  const parsed = JSON.parse(output.slice(start));
  return parsed.flatMap((entry) => entry.results ?? []);
}

/** Accepts `0:31.42`, `31.42`, or raw milliseconds. */
function parseTime(value) {
  if (!value) return null;
  const text = String(value).trim();
  const colon = /^(\d+):(\d{1,2})(?:\.(\d{1,3}))?$/.exec(text);
  if (colon) {
    const minutes = Number(colon[1]);
    const seconds = Number(colon[2]);
    const fraction = colon[3] ?? "0";
    const ms = Number(fraction.padEnd(3, "0"));
    return minutes * 60_000 + seconds * 1000 + ms;
  }
  const numeric = Number(text);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.round(numeric);
}

function formatTime(ms) {
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const hundredths = Math.floor((ms % 1000) / 10);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(
    hundredths
  ).padStart(2, "0")}`;
}

function list() {
  const rows = query(
    `SELECT id, date, time_ms, proof_tics, created_at, user_id
     FROM runs
     WHERE game_id = 'doom' AND review_status = 'pending'
     ORDER BY created_at ASC`
  );
  if (rows.length === 0) {
    console.log("No pending Doom runs.");
    return;
  }
  console.log(`${rows.length} pending Doom run(s):\n`);
  for (const row of rows) {
    console.log(`  ${row.id}`);
    console.log(`    date        ${row.date}`);
    console.log(`    claimed     ${formatTime(row.time_ms)}`);
    console.log(`    demo tics   ${row.proof_tics ?? "?"}`);
    console.log(
      `    submitted   ${new Date(Number(row.created_at)).toISOString()}`
    );
    console.log(`    runner      ${row.user_id}`);
    console.log("");
  }
}

function exportDemo() {
  const id = requireRunId();
  const rows = query(
    `SELECT proof_data, proof_sha256, time_ms, date
     FROM runs WHERE id = ${sqlLiteral(id)} AND game_id = 'doom'`
  );
  if (rows.length === 0) {
    console.error(`No Doom run with id ${id}.`);
    process.exit(1);
  }
  const row = rows[0];
  if (!row.proof_data) {
    console.error("This run has no stored demo.");
    process.exit(1);
  }
  const bytes = Buffer.from(row.proof_data, "base64");
  const actual = createHash("sha256").update(bytes).digest("hex");
  const out = flags.get("out") ?? `${id}.lmp`;
  writeFileSync(out, bytes);

  console.log(`Wrote ${out} (${bytes.length} bytes)`);
  console.log(`Stored hash  ${row.proof_sha256}`);
  console.log(`Actual hash  ${actual}`);
  console.log(
    actual === row.proof_sha256
      ? "Hash matches the stored proof."
      : "HASH MISMATCH - do not approve this run."
  );
  console.log(`Claimed time ${formatTime(row.time_ms)} on ${row.date}`);
  console.log("");
  console.log("Replay with:");
  console.log(`  chocolate-doom -iwad DOOM1.WAD -playdemo ${out}`);
}

function setStatus(nextStatus, verified) {
  const id = requireRunId();
  const note = flags.get("note");
  const timeMs = parseTime(flags.get("time"));
  const now = Date.now();

  if (nextStatus === "verified" && timeMs == null) {
    console.error(
      "Approve needs the official time from the demo: --time 0:31.42 (or --time <ms>)."
    );
    process.exit(1);
  }

  const assignments = [
    `verified = ${verified ? 1 : 0}`,
    `review_status = ${sqlLiteral(nextStatus)}`,
    `reviewed_at = ${now}`,
  ];
  if (verified && timeMs != null) assignments.push(`time_ms = ${timeMs}`);
  if (note) assignments.push(`review_note = ${sqlLiteral(note)}`);

  query(
    `UPDATE runs SET ${assignments.join(", ")}
     WHERE id = ${sqlLiteral(id)} AND game_id = 'doom'`
  );

  console.log(
    verified
      ? `Approved ${id} at ${formatTime(timeMs)}.`
      : `Rejected ${id}.`
  );
}

function help() {
  console.log(`Doom run review

  list                          show pending runs
  export <id> [--out f.lmp]     write the demo out for replay
  approve <id> --time 0:31.42   publish with the demo's official time
  reject <id> [--note text]     mark the run rejected

  --remote                      act on the deployed database
  --note <text>                 review comment stored with the run`);
}

switch (command) {
  case "list":
    list();
    break;
  case "export":
    exportDemo();
    break;
  case "approve":
    setStatus("verified", true);
    break;
  case "reject":
    setStatus("rejected", false);
    break;
  default:
    help();
    if (command) process.exitCode = 1;
}
