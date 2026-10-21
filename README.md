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

## 🚀 Getting Started

### 1. Install dependencies
```bash
npm install
```

### 2. Initialize the local D1 SQLite database
```bash
npm run db:init:local -w packages/server
```

### 3. Run unit tests
```bash
npm test
```

### 4. Start local development servers
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
- Replay verification proves a run is *valid*, not that a human produced it. Treat the leaderboard as replay-verified rather than bot-proof.
