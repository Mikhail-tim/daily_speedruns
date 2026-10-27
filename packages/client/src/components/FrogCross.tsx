import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import confetti from "canvas-confetti";
import {
  FROG_CONFIG,
  FrogDirection,
  FrogGameEngine,
  FrogState,
  TimestampedInput,
  getTurtlePhase,
} from "@daily-speedruns/shared";
import { formatTimeMs } from "../lib/storage.js";
import { isGameInputLocked } from "../lib/keyboard.js";
import { useGameSession } from "../hooks/useGameSession.js";
import { GameShell } from "./GameShell.js";
import { GameHud } from "./GameHud.js";
import { ResultOverlay } from "./ResultOverlay.js";

interface FrogCrossProps {
  seed: string;
  isFocusMode: boolean;
  onToggleFocus: () => void;
  onRunFinished: (
    claimedTimeMs: number,
    inputs: TimestampedInput<FrogDirection>[]
  ) => Promise<{
    verified: boolean;
    rank?: number | null;
    error?: string;
  }>;
}

interface HudState {
  lives: number;
  homes: number;
  deaths: number;
  row: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  kind: "feather" | "splash" | "spark";
}

const CANVAS_SIZE = 676;
const CELL = CANVAS_SIZE / FROG_CONFIG.COLS;
const SUB = FROG_CONFIG.SUB;

const PALETTE = {
  ink: "#070b10",
  road: "#11151b",
  roadLine: "rgba(242, 239, 232, 0.16)",
  river: "#071a22",
  riverDeep: "#041016",
  grass: "#0e1812",
  median: "#15241a",
  signal: "#ff4d00",
  ok: "#7ce3a5",
  cream: "#f2efe8",
  dim: "#5f6a67",
  car: ["#d9d4c8", "#a9c6d8", "#e3b06a", "#d46d5f", "#7ccfb0", "#b9a5e6"],
};

function rowY(row: number): number {
  return (FROG_CONFIG.ROWS - 1 - row) * CELL;
}

function subX(x: number): number {
  return (x / SUB) * CELL;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function interpolateX(
  previous: number | undefined,
  current: number,
  laneLength: number,
  alpha: number
): number {
  if (previous === undefined) return current;
  if (Math.abs(current - previous) > laneLength / 2) return current;
  return lerp(previous, current, alpha);
}

function drawRounded(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  state: FrogState,
  time: number
) {
  const { COLS } = FROG_CONFIG;

  ctx.fillStyle = PALETTE.ink;
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  // Start bank (bottom row).
  ctx.fillStyle = PALETTE.grass;
  ctx.fillRect(0, rowY(0), CANVAS_SIZE, CELL);
  ctx.strokeStyle = "rgba(124, 227, 165, 0.3)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, rowY(0) + 2);
  ctx.lineTo(CANVAS_SIZE, rowY(0) + 2);
  ctx.stroke();

  // Road.
  for (let row = 1; row <= 5; row++) {
    const y = rowY(row);
    const gradient = ctx.createLinearGradient(0, y, 0, y + CELL);
    gradient.addColorStop(0, "#151a21");
    gradient.addColorStop(0.5, PALETTE.road);
    gradient.addColorStop(1, "#0c1015");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, y, CANVAS_SIZE, CELL);

    ctx.strokeStyle = PALETTE.roadLine;
    ctx.lineWidth = 2;
    ctx.setLineDash([CELL * 0.45, CELL * 0.4]);
    ctx.beginPath();
    ctx.moveTo(0, y + CELL / 2);
    ctx.lineTo(CANVAS_SIZE, y + CELL / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Wet reflection streaks.
    ctx.fillStyle = "rgba(255, 255, 255, 0.018)";
    ctx.fillRect(0, y + CELL * 0.15, CANVAS_SIZE, CELL * 0.06);
  }

  // Median.
  ctx.fillStyle = PALETTE.median;
  ctx.fillRect(0, rowY(6), CANVAS_SIZE, CELL);
  ctx.strokeStyle = "rgba(230, 190, 90, 0.55)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, rowY(6) + CELL * 0.28);
  ctx.lineTo(CANVAS_SIZE, rowY(6) + CELL * 0.28);
  ctx.moveTo(0, rowY(6) + CELL * 0.72);
  ctx.lineTo(CANVAS_SIZE, rowY(6) + CELL * 0.72);
  ctx.stroke();

  // River.
  for (let row = 7; row <= 11; row++) {
    const y = rowY(row);
    const gradient = ctx.createLinearGradient(0, y, 0, y + CELL);
    gradient.addColorStop(0, PALETTE.river);
    gradient.addColorStop(1, PALETTE.riverDeep);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, y, CANVAS_SIZE, CELL);

    ctx.strokeStyle = "rgba(90, 220, 230, 0.1)";
    ctx.lineWidth = 2;
    for (let line = 0; line < 2; line++) {
      ctx.beginPath();
      for (let x = 0; x <= CANVAS_SIZE; x += 12) {
        const wave =
          Math.sin(x / 46 + time / 700 + row * 0.9 + line * 1.7) *
          CELL *
          0.08;
        const yy = y + CELL * (0.35 + line * 0.3) + wave;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
  }

  // Home bank / hedges.
  ctx.fillStyle = "#0a1410";
  ctx.fillRect(0, rowY(12), CANVAS_SIZE, CELL);
  ctx.fillStyle = "#0e2a1b";
  for (let col = 0; col < COLS; col++) {
    if (
      FROG_CONFIG.HOME_COLS.some((homeCol) => homeCol === col)
    ) {
      continue;
    }
    ctx.fillRect(col * CELL + 2, rowY(12) + 2, CELL - 4, CELL - 4);
  }

  // Homes.
  FROG_CONFIG.HOME_COLS.forEach((col, index) => {
    const x = col * CELL + CELL / 2;
    const y = rowY(12) + CELL / 2;
    const filled = state.homes[index];
    const pulse = 0.65 + Math.sin(time / 700 + index) * 0.15;

    ctx.save();
    ctx.shadowColor = filled ? "rgba(124, 227, 165, 0.9)" : "rgba(90, 220, 230, 0.45)";
    ctx.shadowBlur = filled ? 20 : 12;
    ctx.fillStyle = filled
      ? "rgba(124, 227, 165, 0.22)"
      : `rgba(90, 220, 230, ${pulse * 0.16})`;
    ctx.beginPath();
    ctx.arc(x, y, CELL * 0.38, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = filled ? PALETTE.ok : "rgba(90, 220, 230, 0.65)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, CELL * 0.34, 0, Math.PI * 2);
    ctx.stroke();

    if (filled) {
      drawFrog(ctx, x - CELL * 0.16, y - CELL * 0.14, CELL * 0.32, "UP", 0, false);
    } else {
      ctx.fillStyle = "rgba(90, 220, 230, 0.55)";
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function drawVehicles(
  ctx: CanvasRenderingContext2D,
  state: FrogState,
  previous: Record<number, number>,
  alpha: number
) {
  for (const lane of state.roadLanes) {
    const y = rowY(lane.row);
    const laneTop = y + CELL * 0.18;
    const height = CELL * 0.64;

    for (const vehicle of lane.vehicles) {
      const x = interpolateX(
        previous[vehicle.id],
        vehicle.x,
        lane.laneLength,
        alpha
      );
      const width = vehicle.length * CELL * 0.9;

      for (const offset of [-lane.laneLength, 0, lane.laneLength]) {
        const drawX = subX(x + offset) + CELL * 0.05;
        if (drawX > CANVAS_SIZE || drawX + width < 0) continue;

        ctx.save();
        ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
        drawRounded(ctx, drawX + 3, laneTop + 5, width, height, height * 0.35);
        ctx.fill();

        const color =
          PALETTE.car[
            Math.abs(vehicle.id * 7 + lane.row) % PALETTE.car.length
          ];

        if (vehicle.kind === "bike") {
          ctx.fillStyle = "#1b232b";
          drawRounded(ctx, drawX + width * 0.2, laneTop + height * 0.15, width * 0.6, height * 0.5, height * 0.2);
          ctx.fill();
          ctx.fillStyle = PALETTE.signal;
          drawRounded(ctx, drawX + width * 0.35, laneTop + height * 0.05, width * 0.3, height * 0.4, height * 0.2);
          ctx.fill();
          ctx.fillStyle = "#0b0e12";
          ctx.beginPath();
          ctx.arc(drawX + width * 0.3, laneTop + height * 0.88, height * 0.16, 0, Math.PI * 2);
          ctx.arc(drawX + width * 0.7, laneTop + height * 0.88, height * 0.16, 0, Math.PI * 2);
          ctx.fill();
        } else {
          const gradient = ctx.createLinearGradient(0, laneTop, 0, laneTop + height);
          gradient.addColorStop(0, color);
          gradient.addColorStop(0.55, color);
          gradient.addColorStop(1, "rgba(0, 0, 0, 0.45)");
          ctx.fillStyle = gradient;
          drawRounded(ctx, drawX, laneTop, width, height, height * 0.28);
          ctx.fill();

          // Roof / windows.
          ctx.fillStyle = "rgba(20, 30, 38, 0.78)";
          if (vehicle.kind === "truck") {
            drawRounded(ctx, drawX + width * 0.1, laneTop + height * 0.12, width * 0.24, height * 0.76, 3);
            ctx.fill();
            ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
            for (let i = 1; i <= 3; i++) {
              ctx.fillRect(drawX + width * (0.24 + i * 0.14), laneTop + height * 0.18, 1.5, height * 0.64);
            }
          } else {
            drawRounded(ctx, drawX + width * 0.2, laneTop + height * 0.14, width * 0.6, height * 0.34, 3);
            ctx.fill();
          }

          // Headlight / taillight.
          const frontX =
            lane.direction === 1 ? drawX + width - 2 : drawX + 1;
          const backX =
            lane.direction === 1 ? drawX + 1 : drawX + width - 2;
          const lightY = laneTop + height * 0.6;

          const glow = ctx.createRadialGradient(frontX, lightY, 0, frontX, lightY, CELL * 0.7);
          glow.addColorStop(0, "rgba(255, 245, 190, 0.55)");
          glow.addColorStop(1, "rgba(255, 245, 190, 0)");
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(frontX, lightY, CELL * 0.7, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = "#ffe9a6";
          ctx.fillRect(frontX - 1.5, lightY - 2, 3, 4);
          ctx.fillStyle = "rgba(255, 77, 0, 0.85)";
          ctx.fillRect(backX - 1.5, lightY - 2, 3, 4);
        }

        ctx.restore();
      }
    }
  }
}

function drawPlatforms(
  ctx: CanvasRenderingContext2D,
  state: FrogState,
  previous: Record<number, number>,
  alpha: number,
  time: number
) {
  for (const lane of state.riverLanes) {
    const y = rowY(lane.row);
    const top = y + CELL * 0.22;
    const height = CELL * 0.56;

    for (const platform of lane.platforms) {
      const x = interpolateX(
        previous[platform.id],
        platform.x,
        lane.laneLength,
        alpha
      );
      const width = platform.length * CELL * 0.94;
      const phase = getTurtlePhase(platform, state.tickCount);

      for (const offset of [-lane.laneLength, 0, lane.laneLength]) {
        const drawX = subX(x + offset) + CELL * 0.03;
        if (drawX > CANVAS_SIZE || drawX + width < 0) continue;

        if (platform.kind === "turtle") {
          const blink =
            phase === "warning"
              ? 0.4 + Math.abs(Math.sin(time / 110)) * 0.6
              : phase === "down"
                ? 0.22
                : 1;

          for (let i = 0; i < platform.length; i++) {
            const cx = drawX + i * CELL + CELL / 2;
            const cy = top + height / 2;
            ctx.save();
            ctx.globalAlpha = blink;
            ctx.shadowColor = "rgba(90, 220, 190, 0.35)";
            ctx.shadowBlur = phase === "up" ? 8 : 2;
            ctx.fillStyle = phase === "down" ? "#173b36" : "#2f7c63";
            ctx.beginPath();
            ctx.ellipse(cx, cy, CELL * 0.26, CELL * 0.2, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "rgba(170, 240, 210, 0.35)";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(cx, cy, CELL * 0.13, 0, Math.PI * 2);
            ctx.stroke();
            ctx.fillStyle = "#2f7c63";
            ctx.beginPath();
            ctx.ellipse(cx - CELL * 0.26, cy, CELL * 0.09, CELL * 0.06, -0.4, 0, Math.PI * 2);
            ctx.ellipse(cx + CELL * 0.26, cy, CELL * 0.09, CELL * 0.06, 0.4, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }

          if (phase === "down") {
            ctx.fillStyle = "rgba(160, 240, 230, 0.35)";
            for (let i = 0; i < 3; i++) {
              ctx.beginPath();
              ctx.arc(
                drawX + width * (0.2 + i * 0.25),
                top + height * 0.4 - ((time / 30 + i * 20) % 14),
                1.8,
                0,
                Math.PI * 2
              );
              ctx.fill();
            }
          }
        } else {
          // Log (or alligator log).
          const gradient = ctx.createLinearGradient(0, top, 0, top + height);
          gradient.addColorStop(0, "#6b4a2f");
          gradient.addColorStop(0.5, "#4a3220");
          gradient.addColorStop(1, "#2e1f14");
          ctx.save();
          ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
          drawRounded(ctx, drawX + 2, top + 4, width, height, height * 0.45);
          ctx.fill();
          ctx.fillStyle = gradient;
          drawRounded(ctx, drawX, top, width, height, height * 0.45);
          ctx.fill();

          ctx.strokeStyle = "rgba(220, 180, 120, 0.2)";
          ctx.lineWidth = 1;
          for (let i = 1; i < platform.length * 2; i++) {
            const lx = drawX + (width / (platform.length * 2)) * i;
            ctx.beginPath();
            ctx.moveTo(lx, top + 3);
            ctx.lineTo(lx, top + height - 3);
            ctx.stroke();
          }

          ctx.fillStyle = "rgba(220, 240, 235, 0.5)";
          drawRounded(ctx, drawX, top + height * 0.8, width, height * 0.14, 3);
          ctx.fill();

          if (platform.kind === "alligator" && platform.mouthCell >= 0) {
            const mouthX = drawX + platform.mouthCell * CELL;
            const mouthY = top + height * 0.35;
            ctx.fillStyle = "#4e8a57";
            drawRounded(ctx, mouthX, mouthY, CELL * 0.85, height * 0.55, 6);
            ctx.fill();
            ctx.fillStyle = "#170b0b";
            drawRounded(ctx, mouthX + CELL * 0.18, mouthY + height * 0.16, CELL * 0.5, height * 0.22, 3);
            ctx.fill();
            ctx.fillStyle = "#fff4dc";
            for (let i = 0; i < 4; i++) {
              ctx.fillRect(mouthX + CELL * (0.14 + i * 0.16), mouthY + height * 0.34, 3, 5);
            }
            ctx.fillStyle = "#ffdd66";
            ctx.beginPath();
            ctx.arc(mouthX + CELL * 0.6, mouthY + height * 0.14, 2.4, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        }
      }
    }
  }
}

function drawFrog(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  facing: FrogDirection,
  /** Pixels of lift above the cell (already eased). */
  lift: number,
  dying: boolean
) {
  const squash = dying ? 0.5 : 1;
  const stretch = dying ? 1.25 : 1;
  const dir = facing === "LEFT" ? -1 : 1;

  ctx.save();
  ctx.translate(x + size / 2, y + size * 0.94);

  // Ground shadow shrinks as the frog lifts off.
  if (!dying) {
    const shrink = 1 - Math.min(0.45, lift / (CELL * 0.9));
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    ctx.beginPath();
    ctx.ellipse(0, 2, size * 0.36 * shrink, size * 0.11 * shrink, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Neon backlight halo.
  const halo = ctx.createRadialGradient(0, -size * 0.45, 0, 0, -size * 0.45, size * 0.75);
  halo.addColorStop(0, "rgba(110, 255, 170, 0.28)");
  halo.addColorStop(1, "rgba(110, 255, 170, 0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, -size * 0.45, size * 0.75, 0, Math.PI * 2);
  ctx.fill();

  ctx.translate(0, -lift);
  ctx.scale(1 / stretch, squash);

  // Hind legs.
  ctx.fillStyle = "#17552f";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(
      side * size * 0.3,
      -size * 0.14,
      size * 0.16,
      size * 0.12,
      side * 0.5,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }

  // Body: dark green with a neon rim.
  const body = ctx.createLinearGradient(0, -size * 0.9, 0, 0);
  body.addColorStop(0, "#338a4e");
  body.addColorStop(0.55, "#1f6b3a");
  body.addColorStop(1, "#10381f");
  ctx.save();
  ctx.shadowColor = "rgba(120, 255, 175, 0.9)";
  ctx.shadowBlur = 14;
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(0, -size * 0.42, size * 0.37, size * 0.33, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = "rgba(126, 255, 172, 0.85)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.ellipse(0, -size * 0.42, size * 0.37, size * 0.33, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Lighter belly glow.
  ctx.fillStyle = "rgba(160, 255, 195, 0.18)";
  ctx.beginPath();
  ctx.ellipse(0, -size * 0.3, size * 0.19, size * 0.15, 0, 0, Math.PI * 2);
  ctx.fill();

  // Eye bulbs.
  for (const side of [-1, 1]) {
    const ex = side * size * 0.17 + dir * size * 0.03;
    const ey = -size * 0.73;
    ctx.fillStyle = "#2b7d46";
    ctx.beginPath();
    ctx.arc(ex, ey, size * 0.145, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(126, 255, 172, 0.55)";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.fillStyle = dying ? "#ff5577" : "#05130c";
    ctx.beginPath();
    ctx.arc(ex, ey, size * 0.085, 0, Math.PI * 2);
    ctx.fill();

    if (!dying) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
      ctx.beginPath();
      ctx.arc(ex - size * 0.03, ey - size * 0.03, size * 0.03, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Mouth.
  ctx.strokeStyle = "rgba(9, 40, 24, 0.9)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(dir * size * 0.02, -size * 0.4, size * 0.16, 0.35, Math.PI - 0.35);
  ctx.stroke();

  if (dying) {
    ctx.strokeStyle = "#ff5577";
    ctx.lineWidth = 2;
    for (const side of [-1, 1]) {
      const ex = side * size * 0.17;
      const ey = -size * 0.73;
      ctx.beginPath();
      ctx.moveTo(ex - 4, ey - 4);
      ctx.lineTo(ex + 4, ey + 4);
      ctx.moveTo(ex + 4, ey - 4);
      ctx.lineTo(ex - 4, ey + 4);
      ctx.stroke();
    }
  }

  ctx.restore();
}

export const FrogCross: React.FC<FrogCrossProps> = ({
  seed,
  isFocusMode,
  onToggleFocus,
  onRunFinished,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef(new FrogGameEngine());
  const [initialState] = useState<FrogState>(() =>
    engineRef.current.init(seed)
  );
  const stateRef = useRef<FrogState>(initialState);
  const previousRef = useRef<{
    player: { x: number; y: number };
    vehicles: Record<number, number>;
    platforms: Record<number, number>;
  }>({
    player: { x: initialState.player.x, y: initialState.player.y },
    vehicles: {},
    platforms: {},
  });
  const lastTickAtRef = useRef<number>(performance.now());
  const inputQueueRef = useRef<FrogDirection[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const shakeAtRef = useRef<number>(0);
  const swipeRef = useRef<{ x: number; y: number } | null>(null);
  /** Active hop animation, in sub-cell space. */
  const hopRef = useRef<{
    at: number;
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
  } | null>(null);
  /** Smoothed draw position so carry drift and landings never snap. */
  const drawnRef = useRef<{ x: number; y: number } | null>(null);

  const [hud, setHud] = useState<HudState>({
    lives: initialState.lives,
    homes: 0,
    deaths: 0,
    row: 0,
  });

  const {
    status,
    statusRef,
    elapsedMs,
    resultMessage,
    rank,
    begin,
    now,
    record,
    submit,
    fail,
    reset: resetSession,
  } = useGameSession<FrogDirection>({
    onRunFinished,
    winMessage: "All five homes filled!",
    onWin: () => {
      confetti({
        particleCount: 90,
        spread: 80,
        origin: { y: 0.55 },
        colors: ["#ff4d00", "#7ce3a5", "#f2efe8"],
      });
    },
  });

  const snapshotPrevious = useCallback((state: FrogState) => {
    const vehicles: Record<number, number> = {};
    for (const lane of state.roadLanes) {
      for (const vehicle of lane.vehicles) vehicles[vehicle.id] = vehicle.x;
    }
    const platforms: Record<number, number> = {};
    for (const lane of state.riverLanes) {
      for (const platform of lane.platforms) {
        platforms[platform.id] = platform.x;
      }
    }
    previousRef.current = {
      player: { x: state.player.x, y: state.player.y },
      vehicles,
      platforms,
    };
  }, []);

  const resetGame = useCallback(() => {
    const fresh = engineRef.current.init(seed);
    stateRef.current = fresh;
    inputQueueRef.current = [];
    particlesRef.current = [];
    hopRef.current = null;
    drawnRef.current = null;
    lastTickAtRef.current = performance.now();
    snapshotPrevious(fresh);
    setHud({
      lives: fresh.lives,
      homes: 0,
      deaths: 0,
      row: 0,
    });
    resetSession();
  }, [seed, resetSession, snapshotPrevious]);

  useEffect(() => {
    resetGame();
  }, [resetGame]);

  const spawnParticles = useCallback(
    (state: FrogState, kind: "death" | "home") => {
      const x = subX(state.player.x) + CELL / 2;
      const y = rowY(state.player.y) + CELL / 2;
      const colors =
        kind === "home"
          ? ["#7ce3a5", "#f2efe8", "#ffd166"]
          : ["#f2efe8", "#d8cfb9", "#ff4d00"];

      for (let i = 0; i < (kind === "home" ? 22 : 16); i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1 + Math.random() * 3;
        particlesRef.current.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1.6,
          life: 0,
          maxLife: 30 + Math.random() * 26,
          size: 2 + Math.random() * 3,
          color: colors[Math.floor(Math.random() * colors.length)],
          kind:
            kind === "home"
              ? "spark"
              : state.player.y >= 7
                ? "splash"
                : "feather",
        });
      }
      if (kind === "death") {
        shakeAtRef.current = performance.now();
      }
    },
    []
  );

  const handleDirection = useCallback(
    (direction: FrogDirection) => {
      const currentStatus = statusRef.current;
      if (
        currentStatus === "WON" ||
        currentStatus === "LOST" ||
        currentStatus === "SUBMITTING"
      ) {
        return;
      }

      if (currentStatus === "IDLE") {
        begin();
        lastTickAtRef.current = performance.now();
      }

      if (inputQueueRef.current.length < 2) {
        inputQueueRef.current.push(direction);
      }
    },
    [begin, statusRef]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isGameInputLocked()) return;

      if (
        ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
          event.code
        )
      ) {
        event.preventDefault();
      }

      if (
        statusRef.current === "WON" ||
        statusRef.current === "LOST"
      ) {
        if (
          event.code === "Space" ||
          event.code === "Enter" ||
          event.code === "KeyR"
        ) {
          resetGame();
          return;
        }
      }

      if (
        statusRef.current === "IDLE" &&
        (event.code === "Space" || event.code === "Enter")
      ) {
        handleDirection("UP");
        return;
      }

      if (
        event.code === "KeyF" &&
        !(event.target instanceof HTMLInputElement)
      ) {
        event.preventDefault();
        onToggleFocus();
        return;
      }

      switch (event.code) {
        case "ArrowUp":
        case "KeyW":
          handleDirection("UP");
          break;
        case "ArrowDown":
        case "KeyS":
          handleDirection("DOWN");
          break;
        case "ArrowLeft":
        case "KeyA":
          handleDirection("LEFT");
          break;
        case "ArrowRight":
        case "KeyD":
          handleDirection("RIGHT");
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleDirection, resetGame, onToggleFocus, statusRef]);

  // Fixed deterministic tick.
  useEffect(() => {
    if (status !== "PLAYING") return;

    const tick = () => {
      if (statusRef.current !== "PLAYING") return;
      const current = stateRef.current;
      snapshotPrevious(current);

      let action: FrogDirection | undefined;
      if (
        current.respawnTicks === 0 &&
        current.player.cooldown === 0 &&
        inputQueueRef.current.length > 0
      ) {
        action = inputQueueRef.current.shift();
        if (action) {
          record(action, now(), current.tickCount);
        }
      }

      const result = engineRef.current.step(current, action);
      const next = result.state;
      stateRef.current = next;
      lastTickAtRef.current = performance.now();

      // A real hop moves the frog one cell: animate the whole jump instead of
      // snapping. Platform carry is a separate, continuous motion.
      if (result.moved && result.event === "none") {
        hopRef.current = {
          at: lastTickAtRef.current,
          fromX: current.player.x,
          fromY: current.player.y,
          toX: next.player.x,
          toY: next.player.y,
        };
      }

      setHud((previous) => {
        if (
          previous.lives === next.lives &&
          previous.homes === next.homesFilled &&
          previous.deaths === next.deaths &&
          previous.row === next.player.y
        ) {
          return previous;
        }
        return {
          lives: next.lives,
          homes: next.homesFilled,
          deaths: next.deaths,
          row: next.player.y,
        };
      });

      if (result.event === "home") {
        inputQueueRef.current = [];
        hopRef.current = null;
        spawnParticles(next, "home");
        previousRef.current.player = {
          x: next.player.x,
          y: next.player.y,
        };
      } else if (
        result.event === "roadkill" ||
        result.event === "drown" ||
        result.event === "edge" ||
        result.event === "turtle" ||
        result.event === "gator"
      ) {
        inputQueueRef.current = [];
        hopRef.current = null;
        spawnParticles(next, "death");
        if (result.gameOver) {
          fail("Out of lives. The frog didn't make it.");
          return;
        }
      } else if (
        result.event === "timeout" ||
        result.gameOver
      ) {
        fail("Time's up. The frog is still on the road.");
        return;
      }

      if (
        current.respawnTicks > 0 &&
        next.respawnTicks === 0 &&
        next.player.y === FROG_CONFIG.MEDIAN_ROW
      ) {
        hopRef.current = null;
        previousRef.current.player = {
          x: next.player.x,
          y: next.player.y,
        };
      }

      if (result.win) {
        submit(next.tickCount * next.tickMs);
      }
    };

    const interval = window.setInterval(tick, FROG_CONFIG.TICK_MS);
    return () => window.clearInterval(interval);
  }, [
    status,
    now,
    record,
    submit,
    fail,
    statusRef,
    snapshotPrevious,
    spawnParticles,
  ]);

  // 60fps renderer with tick interpolation.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame = 0;
    let lastFrameAt = performance.now();

    const render = () => {
      const nowMs = performance.now();
      const dt = Math.min(40, nowMs - lastFrameAt) / 16.67;
      lastFrameAt = nowMs;

      const state = stateRef.current;
      const alpha =
        statusRef.current === "PLAYING"
          ? clamp(
              (nowMs - lastTickAtRef.current) / state.tickMs,
              0,
              1
            )
          : 1;

      ctx.save();
      ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      const shakeAge = nowMs - shakeAtRef.current;
      if (shakeAge < 320) {
        const strength = (1 - shakeAge / 320) * 5;
        ctx.translate(
          (Math.random() - 0.5) * strength,
          (Math.random() - 0.5) * strength
        );
      }

      drawBackground(ctx, state, nowMs);
      drawPlatforms(
        ctx,
        state,
        previousRef.current.platforms,
        alpha,
        nowMs
      );
      drawVehicles(
        ctx,
        state,
        previousRef.current.vehicles,
        alpha
      );

      // --- Frog position -------------------------------------------------
      // Hops are animated from the cell the frog left to the cell it landed
      // in; everything else (being carried on a log) is a continuous drift.
      const previous = previousRef.current.player;
      const playing = statusRef.current === "PLAYING";
      const dying = state.respawnTicks > 0;

      let targetX: number;
      let targetY: number;
      let lift = 0;

      const hop = hopRef.current;
      if (hop && playing && !dying) {
        const progress = clamp(
          (nowMs - hop.at) / (FROG_CONFIG.HOP_TICKS * FROG_CONFIG.TICK_MS),
          0,
          1
        );
        // Ease in and out horizontally, arc vertically.
        const eased =
          progress < 0.5
            ? 2 * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        targetX = subX(lerp(hop.fromX, hop.toX, eased));
        targetY = rowY(lerp(hop.fromY, hop.toY, eased));
        lift = Math.sin(Math.PI * progress) * CELL * 0.34;
        if (progress >= 1) hopRef.current = null;
      } else {
        hopRef.current = null;
        const teleported =
          Math.abs(state.player.x - previous.x) > SUB * 2 ||
          Math.abs(state.player.y - previous.y) > 1;
        targetX = teleported
          ? subX(state.player.x)
          : subX(lerp(previous.x, state.player.x, alpha));
        targetY = teleported
          ? rowY(state.player.y)
          : rowY(lerp(previous.y, state.player.y, alpha));
      }

      // A light position filter removes the last sub-pixel jumps when a hop
      // finishes on a moving log.
      const drawn = drawnRef.current;
      if (
        !drawn ||
        Math.abs(targetX - drawn.x) > CELL * 2 ||
        Math.abs(targetY - drawn.y) > CELL * 2
      ) {
        drawnRef.current = { x: targetX, y: targetY };
      } else {
        drawn.x += (targetX - drawn.x) * 0.45;
        drawn.y += (targetY - drawn.y) * 0.45;
      }

      const bob = playing ? 0 : Math.sin(nowMs / 260) * CELL * 0.02;
      const drawPoint = drawnRef.current ?? { x: targetX, y: targetY };

      drawFrog(
        ctx,
        drawPoint.x,
        drawPoint.y + bob,
        CELL * 0.8,
        state.player.facing,
        lift,
        dying
      );

      // Particles.
      particlesRef.current = particlesRef.current.filter((particle) => {
        particle.life += dt;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vy += 0.06 * dt;

        if (particle.life >= particle.maxLife) return false;

        const opacity = 1 - particle.life / particle.maxLife;
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.fillStyle = particle.color;
        if (particle.kind === "splash") {
          ctx.beginPath();
          ctx.arc(particle.x, particle.y, particle.size * 1.4, 0, Math.PI * 2);
          ctx.fill();
        } else if (particle.kind === "feather") {
          ctx.translate(particle.x, particle.y);
          ctx.rotate(particle.life * 0.2);
          ctx.beginPath();
          ctx.ellipse(0, 0, particle.size * 1.6, particle.size * 0.7, 0, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        return true;
      });

      // Vignette.
      const vignette = ctx.createRadialGradient(
        CANVAS_SIZE / 2,
        CANVAS_SIZE / 2,
        CANVAS_SIZE * 0.35,
        CANVAS_SIZE / 2,
        CANVAS_SIZE / 2,
        CANVAS_SIZE * 0.75
      );
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(1, "rgba(0,0,0,0.45)");
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

      ctx.restore();
      frame = requestAnimationFrame(render);
    };

    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [statusRef]);

  const handlePointerDown = (event: React.PointerEvent) => {
    if (statusRef.current === "WON" || statusRef.current === "LOST") return;
    if (event.pointerType === "mouse") return;
    swipeRef.current = { x: event.clientX, y: event.clientY };
  };

  const handlePointerUp = (event: React.PointerEvent) => {
    if (!swipeRef.current) return;
    const start = swipeRef.current;
    swipeRef.current = null;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.hypot(dx, dy) < 24) return;

    if (Math.abs(dx) > Math.abs(dy)) {
      handleDirection(dx > 0 ? "RIGHT" : "LEFT");
    } else {
      handleDirection(dy > 0 ? "DOWN" : "UP");
    }
  };

  return (
    <GameShell className="frog-card">
      <GameHud
        stats={[
          {
            label: "Lives",
            value: `${hud.lives}`,
            tone: hud.lives <= 2 ? "danger" : "default",
          },
          {
            label: "Homes",
            value: `${hud.homes} / ${FROG_CONFIG.HOME_COLS.length}`,
            align: "center",
            tone: "highlight",
          },
          {
            label: "Stopwatch",
            value: formatTimeMs(elapsedMs),
            align: "right",
            tone: "timer",
          },
        ]}
      />

      <div
        className="frog-board-wrapper"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onContextMenu={(event) => event.preventDefault()}
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          className="frog-canvas"
          aria-label="Frog Cross river board"
        />

        {status === "IDLE" && (
          <div className="canvas-overlay">
            <h3 className="overlay-title">Ready?</h3>
            <p className="overlay-subtitle">
              Cross the road, ride the river, fill all five homes.
            </p>
            <button
              className="btn-primary"
              onClick={() => handleDirection("UP")}
            >
              Start crossing{" "}
              <kbd className="keycap overlay-keycap">Space</kbd>
            </button>
          </div>
        )}

        {status === "SUBMITTING" && (
          <ResultOverlay
            variant="submitting"
            title="Home safe!"
            message="Verifying the crossing with the server engine..."
          />
        )}

        {status === "WON" && (
          <ResultOverlay
            variant="win"
            title="All Homes Filled!"
            timeMs={elapsedMs}
            stats={[
              {
                label: "Homes",
                value: `${FROG_CONFIG.HOME_COLS.length} / ${FROG_CONFIG.HOME_COLS.length}`,
                tone: "success",
              },
              {
                label: "Deaths",
                value: hud.deaths,
                tone: hud.deaths === 0 ? "success" : "warning",
              },
              {
                label: "Lives left",
                value: hud.lives,
              },
            ]}
            rank={rank}
            message={resultMessage}
            onRetry={resetGame}
          />
        )}

        {status === "LOST" && (
          <ResultOverlay
            variant="lost"
            title="Run Over"
            message={resultMessage}
            onRetry={resetGame}
            retryLabel="Try Again"
          />
        )}
      </div>

      <div className="controls-bar">
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span className="keycap">Arrows</span>
          <span>/</span>
          <span className="keycap">WASD</span>
          <span>·</span>
          <span className="keycap">Swipe</span>
        </div>

        <button
          type="button"
          className={`action-pill-btn ${isFocusMode ? "active" : ""}`}
          onClick={onToggleFocus}
          title="Focus / Pop-up mode"
        >
          <span>{isFocusMode ? "Exit Focus" : "Focus Mode"}</span>
          <span className="keycap" style={{ fontSize: "10px" }}>
            F
          </span>
        </button>
      </div>

      <div className="mobile-controls" aria-label="Directional controls">
        <button
          className="ctrl-btn up"
          onClick={() => handleDirection("UP")}
          aria-label="Up"
        >
          ▲
        </button>
        <button
          className="ctrl-btn left"
          onClick={() => handleDirection("LEFT")}
          aria-label="Left"
        >
          ◀
        </button>
        <button
          className="ctrl-btn down"
          onClick={() => handleDirection("DOWN")}
          aria-label="Down"
        >
          ▼
        </button>
        <button
          className="ctrl-btn right"
          onClick={() => handleDirection("RIGHT")}
          aria-label="Right"
        >
          ▶
        </button>
      </div>
    </GameShell>
  );
};
