# ⚡ Daily Speedruns

Every day there is **ONE challenge** that is identical for every player worldwide. Players sprint to complete the objective as fast as possible and earn a spot on the daily leaderboard. The next day, a new deterministic challenge replaces it at 00:00 UTC.

---

## 🏗️ Architecture

- **`packages/shared`**: Pure TypeScript game engines, deterministic PRNG (Mulberry32), and anti-cheat replay verifiers. Reusable identically across client and server.
- **`packages/server`**: Cloudflare Workers + Hono + Cloudflare D1 (SQLite). Replays timestamped input streams against the canonical daily seed before verifying runs.
- **`packages/client`**: Vite + React + Vanilla CSS + HTML5 Canvas. Crisp 60fps rendering, live stopwatch HUD, touch & keyboard controls, and local anonymous runner profile.

---

## 🎮 Games

### 🤖 reCAPTCHA Sprint

Solve a real 3×3 reCAPTCHA image challenge as fast as possible. The daily seed
picks both the category and one of Google's two authentic Type-A variants:

- **Static** — select every matching image, then click **VERIFY**.
- **Dynamic** — each matching image is swapped for a fresh photo when clicked;
  verify once no matches are left ("Click verify once there are none left").

Prompt wording and categories mirror the real challenges: bicycles, bridges,
buses, cars, chimneys, crosswalks, fire hydrants, motorcycles, mountains or
hills, palm trees, and traffic lights. Prompts alternate between "Select all
images with…" and "Select all squares with…".

The tile images are real reCAPTCHA challenge images bundled from the public
[MIT-licensed `recaptcha-dataset`](https://github.com/hbcbh1999/recaptcha-dataset).
The images remain the property of their original owners and are included for
non-commercial, educational use — see
`packages/client/public/captcha/ATTRIBUTION.md`.

To re-download or refresh the tile pool:

```bash
npm run captcha:fetch -w packages/client
```

---

### 🎯 Doom (1993) — E1M1

A real, timed speedrun of shareware Doom. The event is locked to:

| Setting    | Value                                      |
| ---------- | ------------------------------------------ |
| Map        | `E1M1` "Hangar"                            |
| Difficulty | Ultra-Violence                             |
| Start      | Pistol start, no saves, no cheats, no mods |
| IWAD       | Pinned shareware `DOOM1.WAD`, unmodified   |
| Engine     | Pinned Chocolate Doom WebAssembly build    |
| Timing     | Doom `leveltime` (35 tics per second)      |
| Devices    | Desktop only — keyboard and mouse          |

Players can only change cosmetic and control preferences before a run: control
preset, mouse turning and sensitivity, sound-effects volume, brightness, screen
melt, and pixel scaling.

**Controls.** `WASD + mouse` (forward/back/strafe on WASD, turn with the mouse or
arrow keys, `Ctrl` fire, `Space` use, right `Shift` run) or `Arrows (classic)`.
Click the game once to capture the mouse — Chocolate Doom only turns with the
mouse while the pointer is locked, so without that click the mouse is inert.
If the browser refuses the capture (an unfocused window, or pointer lock blocked
by policy) the HUD says so and the arrow keys remain the way to turn.

**Layout.** The runtime is a three-column grid: timer rail, game, controls rail.
Doom is 4:3, so putting the bars on the sides lets the game use the full viewport
height. The canvas box is computed in JavaScript in _device_ pixels and snapped
to whole pixels, then re-measured whenever the stage, the window, or the device
pixel ratio changes — fractional CSS sizes at non-100% browser zoom are what make
nearest-neighbour scaling look shifted.

If the picture ever looks off, load the site with `?debug=1`. The right rail then
shows the live geometry (`stage … canvas … at … buffer … dpr … zoom … viewport`)
and the canvas gets an orange outline marking the exact box the game is drawn
into — if the picture does not fill that outline, the engine bitmap is offset
inside the canvas rather than the canvas being misplaced. <kbd>~</kbd> toggles
the engine log, which overlays the bottom of the picture and is therefore closed
by default.

**How a run works.** The engine boots inside `doom.html`, a separate document
loaded in a same-origin iframe, so its global keyboard handlers and animation
loop never touch the rest of the site and a restart is just a reload. The
engine records a vanilla `.lmp` demo for the whole attempt:

1. Press **Start run**. The runtime loads the IWAD, verifies its SHA-256, writes
   the locked config into the engine's virtual filesystem, and launches
   `-skill 4 -warp 1 1 -record /savegames/dsr-run`.
2. Play `E1M1`. Press <kbd>F10</kbd> the moment you cross the exit to stop the
   clock. In fullscreen the browser eats <kbd>Esc</kbd>, so use the **Doom
   menu** button to open the in-game menu.
3. Quit Doom (`Quit Game` → `Y`). Quitting is what flushes the demo to disk; the
   runtime then reads it, parses the header, and uploads it.

**Why runs are reviewed.** Doom has no seeded simulation, so the edge cannot
replay it the way it replays Snake or Wordle. A submission is validated
structurally — a well-formed vanilla demo, Ultra-Violence, the locked map, on the
pinned IWAD and engine build, long enough to be a real completion — and then
stored as **pending**. It only reaches the leaderboard once a reviewer replays
the demo and approves it with the time shown on the intermission screen.

See [Doom run review](#-doom-run-review) for the reviewer workflow.

**Assets.** Neither the engine binary nor the IWAD is committed. They are fetched
at build time and every file is verified against a pinned SHA-256:

```bash
npm run doom:fetch -w packages/client
```

This writes `chocolate-doom.js`, `chocolate-doom.wasm`, and `DOOM1.WAD` into
`packages/client/public/doom/`, together with a `NOTICE.md` covering licensing.
If the assets are missing the Doom event reports that its runtime data is not
installed instead of failing at boot.

Licensing: Chocolate Doom is GPL-2.0-or-later and is redistributed as an
unmodified prebuilt binary; corresponding source is available at the pinned
commit recorded in `packages/client/public/doom/NOTICE.md`. `DOOM1.WAD` is the
freely redistributable shareware episode, served unmodified. The site has no
paywall and nothing is charged for access to the game.

---

### 💣 Minesweeper Sprint

Clear a daily 9×9 board with 10 mines. The clock starts on the first click and
stops when the last of the 71 safe squares is revealed.

- The first click always opens an area: mines are placed only after it, and
  never under the clicked square or its eight neighbours.
- Every board is generated to be solvable by logic alone. A layout that would
  force a coin-flip guess is deterministically re-rolled from the same seed, so
  the daily board is identical for everyone and has no guess walls.
- Left-click (or tap) a covered square to reveal it. Right-click a covered
  square — or press and hold it on a touch screen — to toggle a flag; flags are
  optional markers, capped at 10, and never required to finish. A number counts
  the mines in the eight surrounding squares.
- Detonating a mine ends the run. A clean board is replayed against the seed by
  the server, with minimum-time and click-rate caps, before it reaches the
  leaderboard.

---

### � Frog Cross: River Run

Guide a glowing dark-green frog across five lanes of night traffic, ride the
river, and fill all five homes as fast as possible.

- **5 homes, 5 lives.** Each home fills with a frog and resets you to the
  start; fill all five to win. River deaths respawn at the median checkpoint;
  road deaths restart from the bottom.
- **Road:** five lanes of deterministic traffic — bikes, cars and trucks in
  both directions. Cross when the gaps align.
- **River:** logs, diving turtles and one alligator log. You must be on a
  platform; turtles sink on a fixed cycle, and the alligator's mouth is deadly.
- **Forgiving hit boxes:** both the frog and the vehicles are trimmed to their
  art, and platforms give the frog a little reach past their ends, so deaths
  only happen on real contact.
- **Controls:** arrows/WASD, swipe, or the D-pad. Hops are cooldown-limited, so
  timing matters more than spam.
- **Modern night-city canvas:** headlights, wet asphalt, animated water, dive
  warnings, eased hops and particles. No external assets.
- A clean run is replayed against the daily seed by the server.

---

## 🚀 Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Initialize the local D1 SQLite database

```bash
npm run db:init:local -w packages/server
```

If you already had a local database before the Doom event landed, apply the
migration that adds the demo-review columns instead (fresh installs get them from
`schema.sql`):

```bash
npm run db:migrate:local -w packages/server
```

### 3. Fetch the Doom runtime assets

```bash
npm run doom:fetch -w packages/client
```

Optional for everything except the Doom event; the rest of the site runs without
it.

### 4. Run unit tests

```bash
npm test
```

### 5. Start local development servers

In terminal 1 (Cloudflare Workers API on port 8787):

```bash
npm run dev -w packages/server
```

In terminal 2 (Vite Frontend on port 3000):

```bash
npm run dev -w packages/client
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🛡️ Anti-Cheat Mechanism

1. The client records user directional inputs with relative millisecond timestamps:
   `[{ t: 150, action: 'UP' }, { t: 420, action: 'LEFT' }, ...]`
2. When the win condition (Length 20) is met, the client submits the inputs and claimed time to `/api/runs`.
3. The server loads the shared deterministic engine (`SnakeGameEngine`) and feeds the exact inputs through a tick simulation using today's authoritative seed.
4. If the snake crashes, fails to reach the target, or claims a time outside realistic timing tolerances, the run is rejected (HTTP 422).
5. Only verified runs appear on the daily leaderboard.

Additional protections:

- Challenge dates are validated; future challenges are unavailable and runs are accepted only for the current UTC day.
- Game IDs are validated against the shared engine registry.
- Every write requires a per-runner capability token (`X-Runner-Token`). The server stores only its SHA-256 hash, so a runner cannot rename or submit as another identity.
- Request bodies and input counts are capped before replay.
- Replay verification proves a run is _valid_, not that a human produced it. Treat the leaderboard as replay-verified rather than bot-proof.

Doom is the exception: it uploads a vanilla `.lmp` demo instead of an input
stream, so it skips replay and enters manual review (see below).

---

## 📼 Doom run review

Every Doom submission is stored as `pending` with its demo attached. Pending runs
are hidden from the leaderboard and from other players; the runner sees the time
marked as awaiting review.

Reviewers need a desktop [Chocolate Doom](https://github.com/chocolate-doom/chocolate-doom)
build. Run the tools directly with `node` — the `npm run` shorthand swallows
flags like `--time` because npm parses them as its own options.

```bash
# 1. What is waiting?
node packages/server/scripts/review-doom-run.mjs list

# 2. Pull the demo out and confirm it was not tampered with
node packages/server/scripts/review-doom-run.mjs export <runId> --out run.lmp

# 3. Watch it. The intermission screen shows the authoritative level time.
chocolate-doom -iwad packages/client/public/doom/DOOM1.WAD -playdemo run.lmp

# 4. Publish with the time you actually saw
node packages/server/scripts/review-doom-run.mjs approve <runId> --time 0:31.42

#    ...or reject it, with a note stored alongside the run
node packages/server/scripts/review-doom-run.mjs reject <runId> --note "demo ends before the exit"
```

Add `--remote` to act on the deployed database. The approve step always requires
an explicit `--time`: the submitted number is the runner's own stopwatch and is
never promoted automatically.

What to check while reviewing:

- The demo ends with the level exit, not before it.
- The intermission screen reads `E1M1` on Ultra-Violence.
- The intermission time roughly matches the claimed time; use the intermission
  value, not the claim.
- Demo length is a sanity check, not a timer: recording continues while the
  player sits in the quit menu, so it is normally a little longer than the run.
