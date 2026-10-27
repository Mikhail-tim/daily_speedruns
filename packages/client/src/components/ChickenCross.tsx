import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import confetti from "canvas-confetti";
import {
  CHICKEN_CONFIG,
  ChickenDirection,
  ChickenGameEngine,
  ChickenState,
  TimestampedInput,
  getTurtlePhase,
} from "@daily-speedruns/shared";
import { formatTimeMs } from "../lib/storage.js";
import { isGameInputLocked } from "../lib/keyboard.js";
import { useGameSession } from "../hooks/useGameSession.js";
import { GameShell } from "./GameShell.js";
import { GameHud } from "./GameHud.js";
import { ResultOverlay } from "./ResultOverlay.js";

interface ChickenCrossProps {
  seed: string;
  isFocusMode: boolean;
  onToggleFocus: () => void;
  onRunFinished: (
    claimedTimeMs: number,
    inputs: TimestampedInput<ChickenDirection>[]
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
const CELL = CANVAS_SIZE / CHICKEN_CONFIG.COLS;
const SUB = CHICKEN_CONFIG.SUB;

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
  return (CHICKEN_CONFIG.ROWS - 1 - row) * CELL;
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
  state: ChickenState,
  time: number
) {
  const { COLS } = CHICKEN_CONFIG;

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
      CHICKEN_CONFIG.HOME_COLS.some((homeCol) => homeCol === col)
    ) {
      continue;
    }
    ctx.fillRect(col * CELL + 2, rowY(12) + 2, CELL - 4, CELL - 4);
  }

  // Homes.
  CHICKEN_CONFIG.HOME_COLS.forEach((col, index) => {
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
      drawChicken(ctx, x - CELL * 0.16, y - CELL * 0.14, CELL * 0.32, "UP", 0, false);
    } else {
      ctx.fillStyle = "rgba(90, 220, 230, 0.55)";
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function drawLilyPads(ctx: CanvasRenderingContext2D, time: number) {
  CHICKEN_CONFIG.LILY_PADS.forEach((pad, index) => {
    const x = pad.col * CELL + CELL / 2;
    const y = rowY(pad.row) + CELL / 2;
    const bob = Math.sin(time / 900 + index * 1.7) * 1.4;

    ctx.save();
    ctx.translate(x, y + bob);
    ctx.shadowColor = "rgba(124, 227, 165, 0.55)";
    ctx.shadowBlur = 14;
    ctx.fillStyle = "rgba(44, 122, 74, 0.92)";
    ctx.beginPath();
    ctx.ellipse(0, 0, CELL * 0.3, CELL * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = "rgba(124, 227, 165, 0.5)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(x, y + bob, CELL * 0.3, CELL * 0.22, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "rgba(255, 190, 220, 0.85)";
    ctx.beginPath();
    ctx.arc(x + 2, y + bob - 2, 2.5, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawVehicles(
  ctx: CanvasRenderingContext2D,
  state: ChickenState,
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
  state: ChickenState,
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

function drawChicken(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  facing: ChickenDirection,
  hop: number,
  dying: boolean
) {
  const lift = dying ? 0 : -hop;
  const squash = dying ? 0.55 : 1;
  const stretch = dying ? 1.2 : 1;

  ctx.save();
  ctx.translate(x + size / 2, y + size + lift);

  // Shadow.
  if (!dying) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    ctx.beginPath();
    ctx.ellipse(0, 2, size * 0.42, size * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.scale(1 / stretch, squash);
  ctx.rotate(
    facing === "LEFT" ? -0.08 : facing === "RIGHT" ? 0.08 : 0
  );

  // Body.
  const body = ctx.createLinearGradient(0, -size, 0, 0);
  body.addColorStop(0, "#fff8e7");
  body.addColorStop(1, "#d8cfb9");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(0, -size * 0.48, size * 0.4, size * 0.44, 0, 0, Math.PI * 2);
  ctx.fill();

  // Wing.
  ctx.fillStyle = "rgba(180, 160, 130, 0.55)";
  ctx.beginPath();
  ctx.ellipse(
    facing === "LEFT" ? -size * 0.08 : size * 0.08,
    -size * 0.42,
    size * 0.2,
    size * 0.28,
    0.3,
    0,
    Math.PI * 2
  );
  ctx.fill();

  // Comb.
  ctx.fillStyle = "#ff4d00";
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(
      (i - 1) * size * 0.13,
      -size * 0.93,
      size * 0.1,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }

  // Beak.
  const dir = facing === "LEFT" ? -1 : 1;
  ctx.fillStyle = "#f4a53c";
  ctx.beginPath();
  ctx.moveTo(dir * size * 0.16, -size * 0.52);
  ctx.lineTo(dir * size * 0.34, -size * 0.44);
  ctx.lineTo(dir * size * 0.16, -size * 0.34);
  ctx.closePath();
  ctx.fill();

  // Eyes.
  const eyeY = -size * 0.58;
  ctx.fillStyle = dying ? "#e11d48" : "#0b0e10";
  const eyeOffset = facing === "LEFT" ? -size * 0.12 : size * 0.12;
  ctx.beginPath();
  ctx.arc(eyeOffset - size * 0.06, eyeY, size * 0.045, 0, Math.PI * 2);
  ctx.arc(eyeOffset + size * 0.06, eyeY, size * 0.045, 0, Math.PI * 2);
  ctx.fill();

  if (dying) {
    ctx.strokeStyle = "#e11d48";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-6, eyeY - 6);
    ctx.lineTo(6, eyeY + 6);
    ctx.moveTo(6, eyeY - 6);
    ctx.lineTo(-6, eyeY + 6);
    ctx.stroke();
  }

  ctx.restore();
}

export const ChickenCross: React.FC<ChickenCrossProps> = ({
  seed,
  isFocusMode,
  onToggleFocus,
  onRunFinished,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef(new ChickenGameEngine());
  const [initialState] = useState<ChickenState>(() =>
    engineRef.current.init(seed)
  );
  const stateRef = useRef<ChickenState>(initialState);
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
  const inputQueueRef = useRef<ChickenDirection[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const shakeAtRef = useRef<number>(0);
  const swipeRef = useRef<{ x: number; y: number } | null>(null);

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
  } = useGameSession<ChickenDirection>({
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

  const snapshotPrevious = useCallback((state: ChickenState) => {
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
    (state: ChickenState, kind: "death" | "home") => {
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
    (direction: ChickenDirection) => {
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

      let action: ChickenDirection | undefined;
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
        spawnParticles(next, "death");
        if (result.gameOver) {
          fail("Out of lives. The chicken didn't make it.");
          return;
        }
      } else if (
        result.event === "timeout" ||
        result.gameOver
      ) {
        fail("Time's up. The chicken is still on the road.");
        return;
      }

      if (
        current.respawnTicks > 0 &&
        next.respawnTicks === 0 &&
        next.player.y === CHICKEN_CONFIG.MEDIAN_ROW
      ) {
        previousRef.current.player = {
          x: next.player.x,
          y: next.player.y,
        };
      }

      if (result.win) {
        submit(next.tickCount * next.tickMs);
      }
    };

    const interval = window.setInterval(tick, CHICKEN_CONFIG.TICK_MS);
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
      drawLilyPads(ctx, nowMs);
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

      const previous = previousRef.current.player;
      const teleported =
        Math.abs(state.player.x - previous.x) > SUB * 2 ||
        Math.abs(state.player.y - previous.y) > 1;
      const px = teleported
        ? subX(state.player.x)
        : subX(lerp(previous.x, state.player.x, alpha));
      const py = teleported
        ? rowY(state.player.y)
        : rowY(lerp(previous.y, state.player.y, alpha));

      const hopping =
        state.player.x !== previous.x ||
        state.player.y !== previous.y;
      const hop =
        hopping && statusRef.current === "PLAYING"
          ? Math.sin(alpha * Math.PI) * CELL * 0.28
          : 0;
      const bob =
        statusRef.current !== "PLAYING"
          ? Math.sin(nowMs / 260) * CELL * 0.015
          : 0;
      const dying = state.respawnTicks > 0;

      drawChicken(
        ctx,
        px,
        py + bob,
        CELL * 0.8,
        state.player.facing,
        hop,
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
    <GameShell className="chicken-card">
      <GameHud
        stats={[
          {
            label: "Lives",
            value: `${hud.lives}`,
            tone: hud.lives <= 2 ? "danger" : "default",
          },
          {
            label: "Homes",
            value: `${hud.homes} / ${CHICKEN_CONFIG.HOME_COLS.length}`,
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
        className="chicken-board-wrapper"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onContextMenu={(event) => event.preventDefault()}
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          className="chicken-canvas"
          aria-label="Chicken Cross river board"
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
                value: `${CHICKEN_CONFIG.HOME_COLS.length} / ${CHICKEN_CONFIG.HOME_COLS.length}`,
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
