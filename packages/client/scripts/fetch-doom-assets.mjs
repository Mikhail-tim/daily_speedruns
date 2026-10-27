#!/usr/bin/env node
/**
 * Fetches the pinned Doom runtime assets into `public/doom/`.
 *
 * Two things are downloaded:
 *
 *  1. A prebuilt Chocolate Doom WebAssembly bundle (GPL-2.0-or-later).
 *     Source: https://github.com/gabrielbotandev/doom-wasm at the pinned commit.
 *     Corresponding source for the engine is the `engine/vendor/chocolate-doom`
 *     directory at that commit; see `public/doom/NOTICE.md`.
 *
 *  2. The freely distributable DOOM shareware IWAD (`DOOM1.WAD`).
 *     id Software released the shareware episode for unrestricted copying and
 *     distribution; the IWAD is redistributed here unmodified.
 *
 * Every file is verified against a pinned SHA-256 before it is written, so a
 * changed upstream file fails the build instead of silently shipping.
 *
 * Usage:
 *   node scripts/fetch-doom-assets.mjs            # download anything missing
 *   node scripts/fetch-doom-assets.mjs --force    # re-download everything
 *   node scripts/fetch-doom-assets.mjs --check    # verify only, never write
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "public", "doom");

const ENGINE_COMMIT = "64de0924591dec59a7d49a7d10467e125b50ea99";
const ENGINE_BASE = `https://raw.githubusercontent.com/gabrielbotandev/doom-wasm/${ENGINE_COMMIT}/web/public/engine`;

/** IWAD is served gzipped by the idgames archive and inflated on download. */
const WAD_URL =
  "https://www.gamers.org/pub/idgames/idstuff/doom/doom-1.8.wad.gz";

const ASSETS = [
  {
    name: "chocolate-doom.js",
    url: `${ENGINE_BASE}/chocolate-doom.js`,
    bytes: 187718,
    sha256: "c5ed72bfc6875566aff22244083907cc5111aa87e33f4007e420368102faf51b",
  },
  {
    name: "chocolate-doom.wasm",
    url: `${ENGINE_BASE}/chocolate-doom.wasm`,
    bytes: 1673014,
    sha256: "6922e97650ff306d0fef584eb515d52fd1e09bb77bc7e8287b658e09977b54f7",
  },
  {
    name: "DOOM1.WAD",
    url: WAD_URL,
    gzip: true,
    bytes: 4196020,
    sha256: "bb449c7480e9a02a62012d041406e8e43daa51caa0650646d1307d8650b8f837",
    magic: "IWAD",
  },
];

const args = new Set(process.argv.slice(2));
const force = args.has("--force");
const checkOnly = args.has("--check");

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readIfValid(path, asset) {
  if (!(await exists(path))) return null;
  const buffer = await readFile(path);
  if (buffer.length !== asset.bytes) return null;
  if (sha256(buffer) !== asset.sha256) return null;
  return buffer;
}

async function download(asset) {
  const response = await fetch(asset.url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`${asset.url} -> HTTP ${response.status}`);
  }
  let buffer = Buffer.from(await response.arrayBuffer());
  if (asset.gzip) buffer = gunzipSync(buffer);

  if (buffer.length !== asset.bytes) {
    throw new Error(
      `${asset.name}: expected ${asset.bytes} bytes, got ${buffer.length}`
    );
  }
  const actual = sha256(buffer);
  if (actual !== asset.sha256) {
    throw new Error(
      `${asset.name}: SHA-256 mismatch\n  expected ${asset.sha256}\n  actual   ${actual}\n` +
        `If upstream changed on purpose, update ASSETS in ${import.meta.filename}.`
    );
  }
  if (asset.magic) {
    const magic = buffer.subarray(0, asset.magic.length).toString("latin1");
    if (magic !== asset.magic) {
      throw new Error(
        `${asset.name}: expected "${asset.magic}" magic, found "${magic}"`
      );
    }
  }
  return buffer;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  let failures = 0;
  for (const asset of ASSETS) {
    const target = join(OUT_DIR, asset.name);
    const label = `${asset.name} (${(asset.bytes / 1024 / 1024).toFixed(2)} MB)`;

    if (!force) {
      const cached = await readIfValid(target, asset);
      if (cached) {
        console.log(`  cached   ${label}`);
        continue;
      }
      if (await exists(target)) {
        console.warn(`  stale    ${label} - hash mismatch, refetching`);
      }
    }

    if (checkOnly) {
      console.error(`  missing  ${label}`);
      failures += 1;
      continue;
    }

    process.stdout.write(`  fetch    ${label} ... `);
    try {
      const buffer = await download(asset);
      await writeFile(target, buffer);
      console.log("ok");
    } catch (error) {
      console.log("failed");
      console.error(`           ${error.message}`);
      failures += 1;
    }
  }

  await writeFile(join(OUT_DIR, "NOTICE.md"), NOTICE, "utf8");

  if (failures > 0) {
    console.error(
      `\n${failures} Doom asset(s) unavailable. The site still builds; the Doom event will report that runtime data is missing.`
    );
    process.exitCode = 1;
  } else {
    console.log(`\nDoom assets ready in ${OUT_DIR}`);
  }
}

const NOTICE = `# Doom runtime assets

These files are fetched by \`packages/client/scripts/fetch-doom-assets.mjs\` and are
**not** part of the Daily Speedruns source.

## chocolate-doom.js / chocolate-doom.wasm

Prebuilt [Chocolate Doom](https://github.com/chocolate-doom/chocolate-doom)
WebAssembly bundle from
[\`gabrielbotandev/doom-wasm\`](https://github.com/gabrielbotandev/doom-wasm)
at commit \`${ENGINE_COMMIT}\`.

- Engine license: GNU General Public License, version 2 or later (GPL-2.0-or-later)
- Engine copyright: Simon Howard and the Chocolate Doom contributors
- Doom copyright: id Software

The engine is distributed as an unmodified prebuilt binary. The complete
corresponding source is available at the pinned commit above and from
<https://github.com/chocolate-doom/chocolate-doom>.

Daily Speedruns links the engine through its public JavaScript loader; the
engine itself is not modified.

## DOOM1.WAD

DOOM shareware Episode 1, redistributed unmodified.

- Copyright id Software
- Distributed under id Software's shareware terms, which permit copying and
  redistribution of the shareware release
- SHA-256: \`bb449c7480e9a02a62012d041406e8e43daa51caa0650646d1307d8650b8f837\`
- Size: 4,196,020 bytes
- MD5 checksum embedded in the IWAD header is unchanged

The WAD is served as-is. Daily Speedruns does not modify it and does not charge
for access to it.

## Source offer

The GPL requires that we offer the corresponding source of the engine we ship.
Because we redistribute an unmodified upstream build, pointing at the pinned
commit is sufficient; if you need a copy bundled with a release, run
\`fetch-doom-assets.mjs\` and archive the referenced commit alongside it.
`;

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
