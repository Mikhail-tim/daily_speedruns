#!/usr/bin/env node
/**
 * Downloads a curated set of real reCAPTCHA image tiles and generates the
 * shared deterministic asset manifest used by the CaptchaEngine.
 *
 * Source: https://github.com/hbcbh1999/recaptcha-dataset
 * (11,774 labeled 120x120 tiles, MIT-licensed repository)
 *
 * Usage:
 *   node packages/client/scripts/fetch-captcha-dataset.mjs
 *   node packages/client/scripts/fetch-captcha-dataset.mjs --force
 *
 * The script is idempotent: existing files are skipped unless --force is given.
 */

import { mkdir, writeFile, stat, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(__dirname, "../../..");
const OUTPUT_DIR = path.join(CLIENT_DIR, "public", "captcha");
const MANIFEST_PATH = path.join(
  REPO_ROOT,
  "packages",
  "shared",
  "src",
  "games",
  "captcha-manifest.ts"
);

const REPO = "hbcbh1999/recaptcha-dataset";
const BRANCH = "master";
const API_TREE = `https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`;
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;

/** Real Google reCAPTCHA v2 target categories and how many tiles to bundle. */
const DATASET_CATEGORIES = [
  { key: "bicycle", folder: "Bicycle", count: 26 },
  { key: "bridge", folder: "Bridge", count: 26 },
  { key: "bus", folder: "Bus", count: 26 },
  { key: "car", folder: "Car", count: 26 },
  { key: "chimney", folder: "Chimney", count: 26 },
  { key: "crosswalk", folder: "Crosswalk", count: 26 },
  { key: "fire_hydrant", folder: "Hydrant", count: 26 },
  { key: "motorcycle", folder: "Motorcycle", count: 26 },
  { key: "mountain", folder: "Mountain", count: 13 },
  { key: "palm_tree", folder: "Palm", count: 26 },
  { key: "traffic_light", folder: "Traffic Light", count: 26 },
  // Negative images used to fill the remaining grid cells. These are tiles
  // that were NOT part of the target answer in their original challenge.
  { key: "other", folder: "Other", count: 120 },
];

const FORCE = process.argv.includes("--force");

function rawUrlFor(repoPath) {
  return RAW_BASE + repoPath.split("/").map(encodeURIComponent).join("/");
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "daily-speedruns-captcha-fetcher",
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} ${res.statusText} for ${url}`);
  }
  return res.json();
}

async function download(url, dest) {
  if (!FORCE) {
    try {
      const info = await stat(dest);
      if (info.size > 0) return false;
    } catch {
      // missing -> download
    }
  }

  const res = await fetch(url, {
    headers: { "User-Agent": "daily-speedruns-captcha-fetcher" },
  });
  if (!res.ok) {
    throw new Error(`Download failed (${res.status}) for ${url}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buffer);
  return true;
}

/** Pick `count` items spread evenly across the list (keeps variety). */
function sampleEvenly(items, count) {
  if (items.length <= count) return [...items];
  const picked = [];
  const step = items.length / count;
  for (let i = 0; i < count; i++) {
    picked.push(items[Math.floor(i * step)]);
  }
  return picked;
}

async function main() {
  console.log("→ Fetching repository tree …");
  const tree = await fetchJson(API_TREE);

  if (tree.truncated) {
    throw new Error("GitHub tree response was truncated; cannot sample reliably.");
  }

  const byFolder = new Map();
  for (const entry of tree.tree) {
    if (entry.type !== "blob") continue;
    if (!entry.path.startsWith("Large/")) continue;
    const parts = entry.path.split("/");
    if (parts.length !== 3) continue;
    const folder = parts[1];
    if (!byFolder.has(folder)) byFolder.set(folder, []);
    byFolder.get(folder).push(entry.path);
  }

  const manifest = {};
  let downloaded = 0;
  let skipped = 0;

  for (const category of DATASET_CATEGORIES) {
    const files = (byFolder.get(category.folder) ?? []).sort();
    if (files.length === 0) {
      throw new Error(`Dataset folder not found: ${category.folder}`);
    }

    const picked = sampleEvenly(files, category.count);
    const targetDir = path.join(OUTPUT_DIR, category.key);
    await mkdir(targetDir, { recursive: true });

    console.log(
      `→ ${category.key}: ${picked.length}/${files.length} tiles from "${category.folder}"`
    );

    const assets = [];
    for (let i = 0; i < picked.length; i++) {
      const fileName = `${String(i + 1).padStart(3, "0")}.png`;
      const dest = path.join(targetDir, fileName);
      const didDownload = await download(rawUrlFor(picked[i]), dest);
      if (didDownload) downloaded++;
      else skipped++;
      assets.push(`${category.key}/${fileName}`);
    }

    manifest[category.key] = assets;
  }

  // Remove the legacy synthetic tiles at the root of /captcha.
  for (const legacy of [
    "bicycle_1.jpg",
    "bicycle_2.jpg",
    "bus_1.jpg",
    "bus_2.jpg",
    "car_1.jpg",
    "crosswalk_1.jpg",
    "crosswalk_2.jpg",
    "hydrant_1.jpg",
    "hydrant_2.jpg",
    "hydrant_3.jpg",
    "traffic_1.jpg",
    "traffic_2.jpg",
  ]) {
    await rm(path.join(OUTPUT_DIR, legacy), { force: true });
  }

  const distractorKey = "other";
  const tsLines = [
    "/* AUTO-GENERATED FILE — do not edit by hand.",
    " * Regenerate with: npm run captcha:fetch -w packages/client",
    " *",
    " * Tiles come from https://github.com/hbcbh1999/recaptcha-dataset",
    " * (MIT-licensed repository of real reCAPTCHA images). The images",
    " * themselves remain the property of their original owners and are",
    " * bundled here for non-commercial, educational use.",
    " */",
    "",
    "export const CAPTCHA_ASSET_BASE = \"/captcha\";",
    "",
    "/** Target category -> list of 120x120 tile paths relative to CAPTCHA_ASSET_BASE. */",
    "export const CAPTCHA_CATEGORY_ASSETS: Record<string, string[]> = {",
  ];

  for (const [key, assets] of Object.entries(manifest)) {
    if (key === distractorKey) continue;
    tsLines.push(`  ${JSON.stringify(key)}: [`);
    for (const asset of assets) {
      tsLines.push(`    ${JSON.stringify(asset)},`);
    }
    tsLines.push("  ],");
  }
  tsLines.push("};");
  tsLines.push("");
  tsLines.push("/** Non-target tiles used to fill the rest of the grid. */");
  tsLines.push("export const CAPTCHA_DISTRACTOR_ASSETS: string[] = [");
  for (const asset of manifest[distractorKey] ?? []) {
    tsLines.push(`  ${JSON.stringify(asset)},`);
  }
  tsLines.push("];");
  tsLines.push("");

  await mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
  await writeFile(MANIFEST_PATH, tsLines.join("\n"), "utf8");

  const attribution = [
    "# reCAPTCHA image attribution",
    "",
    "The tile images in this folder are real Google reCAPTCHA challenge images,",
    "downloaded from the public dataset:",
    "",
    "- https://github.com/hbcbh1999/recaptcha-dataset (11,774 labeled 120×120 tiles)",
    "- Original collection: https://deathlyf.com/2020/06/06/recaptcha-dataset/",
    "",
    "The dataset repository is MIT-licensed. The individual images are challenge",
    "images produced by Google reCAPTCHA and remain subject to their respective",
    "rights. They are bundled solely for non-commercial, educational use in this",
    "game. Replace this folder with your own imagery for any commercial deployment.",
    "",
    `Downloaded: ${new Date().toISOString()}`,
    "",
  ].join("\n");
  await writeFile(path.join(OUTPUT_DIR, "ATTRIBUTION.md"), attribution, "utf8");

  console.log(
    `\n✔ Done. ${downloaded} downloaded, ${skipped} already present.`
  );
  console.log(`  Tiles:    ${OUTPUT_DIR}`);
  console.log(`  Manifest: ${MANIFEST_PATH}`);
}

main().catch((error) => {
  console.error("✖", error.message);
  process.exitCode = 1;
});
