# ⚡ Daily Speedruns

Every day there is **ONE challenge** that is identical for every player worldwide. Players sprint to complete the objective as fast as possible and earn a spot on the daily leaderboard. The next day, a new deterministic challenge replaces it at 00:00 UTC.

---

## 🏗️ Architecture

- **`packages/shared`**: Pure TypeScript game engines, deterministic PRNG (Mulberry32), and anti-cheat replay verifiers. Reusable identically across client and server.
- **`packages/server`**: Cloudflare Workers + Hono + Cloudflare D1 (SQLite). Replays timestamped input streams against the canonical daily seed before verifying runs.
- **`packages/client`**: Vite + React + Vanilla CSS + HTML5 Canvas. Crisp 60fps rendering, live stopwatch HUD, touch & keyboard controls, and local anonymous runner profile.

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
