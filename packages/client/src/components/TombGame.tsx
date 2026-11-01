import React, { useCallback, useEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";
import {
  TOMB_CONFIG,
  TombAction,
  TombGameEngine,
  TombLevel,
  TombState,
  TimestampedInput,
  colOf,
  rowOf,
} from "@daily-speedruns/shared";
import { formatTimeMs } from "../lib/storage.js";
import { isGameInputLocked } from "../lib/keyboard.js";
import { useGameSession } from "../hooks/useGameSession.js";
import { GameShell } from "./GameShell.js";
import { GameHud } from "./GameHud.js";
import { ResultOverlay } from "./ResultOverlay.js";

interface TombGameProps {
  seed: string;
  isFocusMode: boolean;
  onToggleFocus: () => void;
  onRunFinished: (
    claimedTimeMs: number,
    inputs: TimestampedInput<TombAction>[]
  ) => Promise<{
    verified: boolean;
    rank?: number | null;
    error?: string;
  }>;
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
}

interface SlideAnimation {
  /** Cells the mask travels through, starting with the cell it slid from. */
  cells: number[];
  startAt: number;
  duration: number;
}

const CELL = 62;
const MARGIN = 10;
const CANVAS_WIDTH = CELL * TOMB_CONFIG.COLS + MARGIN * 2;
const CANVAS_HEIGHT = CELL * TOMB_CONFIG.ROWS + MARGIN * 2;
const ANIM_MS_PER_CELL = 54;
const SWIPE_THRESHOLD = 26;

const DELTA: Record<TombAction, { dx: number; dy: number }> = {
  UP: { dx: 0, dy: -1 },
  DOWN: { dx: 0, dy: 1 },
  LEFT: { dx: -1, dy: 0 },
  RIGHT: { dx: 1, dy: 0 },
};

const STONE = "#42454e";
const STONE_DARK = "#1e2026";
const CREAM = "#f4ead6";
const GOLD = "#f2c14e";
const IRON = "#a8a294";
const SIGNAL = "#ff4d00";

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Cheap deterministic per-cell noise so tiles never look copy-pasted. */
function cellNoise(cell: number): number {
  const n = Math.sin(cell * 12.9898) * 43758.5453;
  return n - Math.floor(n);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function cellX(col: number): number {
  return MARGIN + col * CELL;
}

function cellY(row: number): number {
  return MARGIN + row * CELL;
}

function drawBackdrop(ctx: CanvasRenderingContext2D) {
  const gradient = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  gradient.addColorStop(0, "#0a0c0f");
  gradient.addColorStop(0.5, "#0c0e11");
  gradient.addColorStop(1, "#07080a");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // The tomb sits in a recessed stone frame.
  ctx.strokeStyle = "rgba(242, 239, 232, 0.06)";
  ctx.lineWidth = 1;
  ctx.strokeRect(MARGIN - 4.5, MARGIN - 4.5, CELL * TOMB_CONFIG.COLS + 9, CELL * TOMB_CONFIG.ROWS + 9);
}

function drawFloor(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number) {
  const shade = cellNoise(cell);
  ctx.fillStyle = shade > 0.72 ? "#0e0f14" : "#0a0b0e";
  ctx.fillRect(x, y, CELL, CELL);

  ctx.strokeStyle = "rgba(242, 239, 232, 0.06)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);

  // A few floor scratches.
  if (shade > 0.55) {
    ctx.strokeStyle = "rgba(242, 239, 232, 0.035)";
    ctx.beginPath();
    ctx.moveTo(x + 12 + shade * 10, y + 16);
    ctx.lineTo(x + 30 + shade * 12, y + 24 + shade * 8);
    ctx.stroke();
  }
}

function drawWall(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number) {
  const shade = cellNoise(cell);
  const gradient = ctx.createLinearGradient(x, y, x + CELL, y + CELL);
  gradient.addColorStop(0, shade > 0.5 ? "#4a4d56" : STONE);
  gradient.addColorStop(1, STONE_DARK);

  ctx.fillStyle = gradient;
  ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);

  // Bevel: light on top-left, deep shadow bottom-right.
  ctx.strokeStyle = "rgba(242, 239, 232, 0.22)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 1.5, y + CELL - 1.5);
  ctx.lineTo(x + 1.5, y + 1.5);
  ctx.lineTo(x + CELL - 1.5, y + 1.5);
  ctx.stroke();

  ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
  ctx.beginPath();
  ctx.moveTo(x + CELL - 1.5, y + 2);
  ctx.lineTo(x + CELL - 1.5, y + CELL - 1.5);
  ctx.lineTo(x + 2, y + CELL - 1.5);
  ctx.stroke();

  // Mortar line so rubble reads as stacked blocks.
  if (shade > 0.35) {
    ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
    ctx.beginPath();
    ctx.moveTo(x + 4, y + CELL * 0.42);
    ctx.lineTo(x + CELL - 4, y + CELL * 0.42);
    ctx.stroke();
  }
}

function drawExit(ctx: CanvasRenderingContext2D, x: number, y: number, time: number) {
  const cx = x + CELL / 2;
  const cy = y + CELL / 2;
  const pulse = 0.5 + 0.5 * Math.sin(time / 420);

  const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, CELL * 0.75);
  glow.addColorStop(0, `rgba(255, 77, 0, ${0.42 + pulse * 0.2})`);
  glow.addColorStop(0.55, "rgba(255, 77, 0, 0.12)");
  glow.addColorStop(1, "rgba(255, 77, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(x - CELL * 0.25, y - CELL * 0.25, CELL * 1.5, CELL * 1.5);

  ctx.strokeStyle = `rgba(255, 77, 0, ${0.55 + pulse * 0.35})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 16 + pulse * 1.5, 0, Math.PI * 2);
  ctx.stroke();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI / 4);
  const inner = 9 + pulse * 1.2;
  ctx.fillStyle = CREAM;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(-inner / 2, -inner / 2, inner, inner);
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawKey(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const cx = x + CELL / 2;
  const cy = y + CELL / 2;

  const glow = ctx.createRadialGradient(cx, cy, 1, cx, cy, CELL * 0.5);
  glow.addColorStop(0, "rgba(242, 193, 78, 0.28)");
  glow.addColorStop(1, "rgba(242, 193, 78, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(x, y, CELL, CELL);

  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 3.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Bow.
  ctx.beginPath();
  ctx.arc(cx, cy - 11, 7.5, 0, Math.PI * 2);
  ctx.stroke();

  // Shaft.
  ctx.beginPath();
  ctx.moveTo(cx, cy - 3);
  ctx.lineTo(cx, cy + 14);
  ctx.stroke();

  // Teeth.
  ctx.beginPath();
  ctx.moveTo(cx, cy + 7);
  ctx.lineTo(cx + 8, cy + 7);
  ctx.moveTo(cx, cy + 13);
  ctx.lineTo(cx + 6, cy + 13);
  ctx.stroke();

  // Highlight.
  ctx.strokeStyle = "rgba(255, 245, 214, 0.55)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(cx - 2, cy - 13, 3.5, Math.PI * 0.9, Math.PI * 1.7);
  ctx.stroke();
  ctx.lineCap = "butt";
}

function drawDoor(ctx: CanvasRenderingContext2D, x: number, y: number, open: boolean) {
  const inset = 9;
  const dx = x + inset;
  const dy = y + inset;
  const size = CELL - inset * 2;

  // Doorway recess.
  ctx.fillStyle = open ? "rgba(10, 11, 13, 0.85)" : "#1b1a17";
  roundRect(ctx, dx, dy, size, size, 3);
  ctx.fill();

  ctx.strokeStyle = open ? "rgba(242, 239, 232, 0.16)" : "#6d6558";
  ctx.lineWidth = 2;
  ctx.stroke();

  if (open) {
    // Hinges only, door folded away into the wall.
    ctx.fillStyle = "rgba(109, 101, 88, 0.5)";
    ctx.fillRect(dx - 1, dy + size / 2 - 5, 4, 10);
    ctx.fillRect(dx + size - 3, dy + size / 2 - 5, 4, 10);
    ctx.strokeStyle = "rgba(255, 77, 0, 0.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(dx + 2.5, dy + 2.5, size - 5, size - 5);
    return;
  }

  // Bars.
  ctx.strokeStyle = "#b9a67c";
  ctx.lineWidth = 3;
  const gap = size / 4;
  for (let i = 1; i <= 3; i++) {
    const bx = dx + gap * i;
    ctx.beginPath();
    ctx.moveTo(bx, dy + 3);
    ctx.lineTo(bx, dy + size - 3);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(255, 245, 214, 0.5)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(dx + 2, dy + size * 0.32);
  ctx.lineTo(dx + size - 2, dy + size * 0.32);
  ctx.stroke();
}

function drawGate(ctx: CanvasRenderingContext2D, x: number, y: number, open: boolean) {
  const dx = x + 4;
  const size = CELL - 8;
  const top = open ? y + 8 : y + 3;

  ctx.strokeStyle = open ? "rgba(168, 162, 148, 0.32)" : IRON;
  ctx.lineWidth = 3.5;
  const gap = size / 5;
  for (let i = 1; i <= 4; i++) {
    const bx = dx + gap * i;
    ctx.beginPath();
    ctx.moveTo(bx, top);
    ctx.lineTo(bx, open ? y + 12 : y + CELL - 5);
    ctx.stroke();
  }

  // Cross brace.
  ctx.strokeStyle = open
    ? "rgba(168, 162, 148, 0.26)"
    : "rgba(168, 162, 148, 0.9)";
  ctx.lineWidth = 2;
  const braceY = open ? y + 10 : y + CELL * 0.55;
  ctx.beginPath();
  ctx.moveTo(dx + 2, braceY);
  ctx.lineTo(dx + size - 2, braceY);
  ctx.stroke();
}

function drawSwitch(ctx: CanvasRenderingContext2D, x: number, y: number, pressed: boolean) {
  const inset = 13;
  const dx = x + inset;
  const dy = y + inset;
  const size = CELL - inset * 2;

  if (pressed) {
    const glow = ctx.createRadialGradient(
      x + CELL / 2,
      y + CELL / 2,
      2,
      x + CELL / 2,
      y + CELL / 2,
      CELL * 0.55
    );
    glow.addColorStop(0, "rgba(255, 77, 0, 0.3)");
    glow.addColorStop(1, "rgba(255, 77, 0, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(x, y, CELL, CELL);
  }

  // Plate.
  ctx.fillStyle = pressed ? "rgba(255, 77, 0, 0.16)" : "#1e2025";
  roundRect(ctx, dx, dy, size, size, 3);
  ctx.fill();
  ctx.strokeStyle = pressed ? SIGNAL : "#8b8578";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Stud.
  const stud = size * 0.44;
  ctx.fillStyle = pressed ? SIGNAL : "#55524a";
  roundRect(
    ctx,
    dx + (size - stud) / 2,
    dy + (size - stud) / 2 + (pressed ? 1 : 0),
    stud,
    stud,
    2
  );
  ctx.fill();

  if (!pressed) {
    ctx.strokeStyle = "rgba(242, 239, 232, 0.38)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function drawTrail(
  ctx: CanvasRenderingContext2D,
  level: TombLevel,
  cells: number[],
  headProgress: number
) {
  ctx.save();
  for (let i = 0; i < cells.length; i++) {
    const t = cells.length > 1 ? i / (cells.length - 1) : 1;
    if (t > headProgress) break;
    const cx = cellX(colOf(level.cols, cells[i])) + CELL / 2;
    const cy = cellY(rowOf(level.cols, cells[i])) + CELL / 2;
    const fade = clamp(1 - (headProgress - t) * 1.4, 0, 1);
    ctx.globalAlpha = 0.16 * fade;
    ctx.fillStyle = SIGNAL;
    ctx.beginPath();
    ctx.arc(cx, cy, 9 * fade + 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawMask(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  facing: TombAction,
  hasKey: boolean,
  time: number
) {
  const w = 36;
  const h = 41;
  const bob = Math.sin(time / 260) * 1.1;

  ctx.save();
  ctx.translate(px, py + bob);

  // Aura.
  const aura = ctx.createRadialGradient(0, 0, 2, 0, 0, 30);
  aura.addColorStop(0, "rgba(255, 77, 0, 0.28)");
  aura.addColorStop(1, "rgba(255, 77, 0, 0)");
  ctx.fillStyle = aura;
  ctx.fillRect(-32, -32, 64, 64);

  // Mask body.
  const body = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
  body.addColorStop(0, "#fffaf0");
  body.addColorStop(1, "#d9cfb8");
  ctx.fillStyle = body;
  roundRect(ctx, -w / 2, -h / 2, w, h, 9);
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 77, 0, 0.75)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Eye holes shift very slightly toward the slide direction.
  const shiftX = facing === "LEFT" ? -2 : facing === "RIGHT" ? 2 : 0;
  const shiftY = facing === "UP" ? -1.5 : facing === "DOWN" ? 1.5 : 0;

  ctx.fillStyle = "#12110e";
  for (const dx of [-8, 8]) {
    ctx.beginPath();
    ctx.ellipse(dx + shiftX, -4 + shiftY, 4.4, 6.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Ember glint inside the eye holes.
  ctx.fillStyle = "rgba(255, 77, 0, 0.85)";
  for (const dx of [-8, 8]) {
    ctx.beginPath();
    ctx.arc(dx + shiftX - 0.6, -5.5 + shiftY, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Cheek marks.
  ctx.strokeStyle = "rgba(255, 77, 0, 0.5)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-10, 11);
  ctx.lineTo(-4, 11);
  ctx.moveTo(4, 11);
  ctx.lineTo(10, 11);
  ctx.stroke();

  if (hasKey) {
    ctx.fillStyle = GOLD;
    ctx.beginPath();
    ctx.arc(w / 2 - 3, -h / 2 + 3, 3.6, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

export const TombGame: React.FC<TombGameProps> = ({
  seed,
  isFocusMode,
  onToggleFocus,
  onRunFinished,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef(new TombGameEngine());

  const [state, setState] = useState<TombState>(() =>
    engineRef.current.init(seed)
  );
  const stateRef = useRef<TombState>(state);

  const particlesRef = useRef<Particle[]>([]);
  const animRef = useRef<SlideAnimation | null>(null);
  const shakeAtRef = useRef(0);
  const flashAtRef = useRef(0);
  /** Latest queued slide, applied by the first tick that is not animating. */
  const pendingRef = useRef<TombAction | undefined>(undefined);
  const swipeRef = useRef<{ x: number; y: number } | null>(null);

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
  } = useGameSession<TombAction>({
    onRunFinished,
    winMessage: "Tomb escaped!",
    onWin: () => {
      confetti({
        particleCount: 120,
        spread: 90,
        origin: { y: 0.6 },
        colors: ["#ff4d00", "#f2efe8", "#f2c14e"],
      });
    },
  });

  const resetGame = useCallback(() => {
    const fresh = engineRef.current.init(seed);
    stateRef.current = fresh;
    animRef.current = null;
    pendingRef.current = undefined;
    particlesRef.current = [];
    swipeRef.current = null;
    setState(fresh);
    resetSession();
  }, [seed, resetSession]);

  useEffect(() => {
    resetGame();
  }, [resetGame]);

  const pushAction = useCallback(
    (action: TombAction) => {
      const current = statusRef.current;
      if (current === "WON" || current === "LOST" || current === "SUBMITTING") {
        return;
      }
      begin();
      pendingRef.current = action;
    },
    [begin, statusRef]
  );

  const spawnSparks = useCallback(
    (x: number, y: number, color: string, count: number) => {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.6 + Math.random() * 2.2;
        particlesRef.current.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 0.5,
          life: 0,
          maxLife: 16 + Math.random() * 18,
          size: 1.4 + Math.random() * 2.2,
          color,
        });
      }
    },
    []
  );

  // Fixed simulation tick.
  useEffect(() => {
    if (status !== "PLAYING") return;

    const tick = () => {
      if (statusRef.current !== "PLAYING") return;
      const current = stateRef.current;

      const animation = animRef.current;
      const animating =
        animation !== null &&
        performance.now() - animation.startAt < animation.duration;

      // One recorded input per applied tick. While the mask is sliding the
      // input stays queued, so the replay always matches what was simulated.
      const action = animating ? undefined : pendingRef.current;
      if (!animating) pendingRef.current = undefined;

      if (action !== undefined) {
        record(action, now(), current.tickCount);
      }

      const result = engineRef.current.step(current, action);
      const next = result.state;
      stateRef.current = next;
      setState(next);

      if (action !== undefined && next.path.length > 0) {
        const first = next.path[0];
        const { dx, dy } = DELTA[action];
        const origin =
          (rowOf(next.level.cols, first) - dy) * next.level.cols +
          (colOf(next.level.cols, first) - dx);
        animRef.current = {
          cells: [origin, ...next.path],
          startAt: performance.now(),
          duration: next.path.length * ANIM_MS_PER_CELL,
        };
      }

      if (result.event === "blocked") {
        shakeAtRef.current = performance.now();
      }

      switch (result.event) {
        case "key":
          spawnSparks(
            cellX(colOf(next.level.cols, next.player)) + CELL / 2,
            cellY(rowOf(next.level.cols, next.player)) + CELL / 2,
            GOLD,
            14
          );
          break;
        case "door":
          spawnSparks(
            cellX(colOf(next.level.cols, next.player)) + CELL / 2,
            cellY(rowOf(next.level.cols, next.player)) + CELL / 2,
            "#fff5d6",
            16
          );
          break;
        case "switch":
          spawnSparks(
            cellX(colOf(next.level.cols, next.player)) + CELL / 2,
            cellY(rowOf(next.level.cols, next.player)) + CELL / 2,
            SIGNAL,
            12
          );
          break;
        case "exit":
          flashAtRef.current = performance.now();
          animRef.current = null;
          break;
        default:
          break;
      }

      if (result.win) {
        submit(next.tickCount * next.tickMs);
        return;
      }

      if (result.gameOver) {
        fail("The tomb sealed itself. Too slow.");
      }
    };

    const interval = window.setInterval(tick, TOMB_CONFIG.TICK_MS);
    return () => window.clearInterval(interval);
  }, [status, fail, now, record, spawnSparks, statusRef, submit]);

  // Renderer.
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

      const current = stateRef.current;
      const level = current.level;

      ctx.save();
      ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      const shakeAge = nowMs - shakeAtRef.current;
      if (shakeAge < 160) {
        const strength = (1 - shakeAge / 160) * 5;
        ctx.translate(
          (Math.random() - 0.5) * strength,
          (Math.random() - 0.5) * strength
        );
      }

      drawBackdrop(ctx);

      for (let cell = 0; cell < level.walls.length; cell++) {
        const x = cellX(colOf(level.cols, cell));
        const y = cellY(rowOf(level.cols, cell));
        if (level.walls[cell]) {
          drawWall(ctx, x, y, cell);
        } else {
          drawFloor(ctx, x, y, cell);
        }
      }

      // Specials sit on the floor, under the mask.
      const specials: Array<[number, (cx: number, cy: number) => void]> = [];
      if (level.switchAt >= 0) {
        specials.push([
          level.switchAt,
          (cx, cy) => drawSwitch(ctx, cx, cy, current.gateOpen),
        ]);
      }
      if (level.gateAt >= 0) {
        specials.push([
          level.gateAt,
          (cx, cy) => drawGate(ctx, cx, cy, current.gateOpen),
        ]);
      }
      if (level.keyAt >= 0) {
        specials.push([level.keyAt, (cx, cy) => drawKey(ctx, cx, cy)]);
      }
      if (level.doorAt >= 0) {
        specials.push([
          level.doorAt,
          (cx, cy) => drawDoor(ctx, cx, cy, current.doorOpen),
        ]);
      }
      specials.push([level.exit, (cx, cy) => drawExit(ctx, cx, cy, nowMs)]);

      for (const [cell, draw] of specials) {
        draw(
          cellX(colOf(level.cols, cell)),
          cellY(rowOf(level.cols, cell))
        );
      }

      // Mask position: interpolated along the slide path.
      const animation = animRef.current;
      const progress = animation
        ? clamp((nowMs - animation.startAt) / animation.duration, 0, 1)
        : 1;

      let maskX = cellX(colOf(level.cols, current.player)) + CELL / 2;
      let maskY = cellY(rowOf(level.cols, current.player)) + CELL / 2;

      if (animation && progress < 1) {
        const segments = animation.cells.length - 1;
        const t = progress * segments;
        const index = Math.min(segments - 1, Math.floor(t));
        const frac = t - index;
        const from = animation.cells[index];
        const to = animation.cells[Math.min(index + 1, segments)];
        const fx = cellX(colOf(level.cols, from)) + CELL / 2;
        const fy = cellY(rowOf(level.cols, from)) + CELL / 2;
        const tx = cellX(colOf(level.cols, to)) + CELL / 2;
        const ty = cellY(rowOf(level.cols, to)) + CELL / 2;
        maskX = fx + (tx - fx) * frac;
        maskY = fy + (ty - fy) * frac;

        drawTrail(ctx, level, animation.cells.slice(0, index + 1), progress);
      }

      drawMask(ctx, maskX, maskY, current.facing, current.hasKey, nowMs);

      // Exit flash.
      const flashAge = nowMs - flashAtRef.current;
      if (flashAge < 320) {
        ctx.fillStyle = `rgba(255, 77, 0, ${0.22 * (1 - flashAge / 320)})`;
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      }

      // Sparks.
      particlesRef.current = particlesRef.current.filter((particle) => {
        particle.life += dt;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vy += 0.08 * dt;
        if (particle.life >= particle.maxLife) return false;
        ctx.globalAlpha = 1 - particle.life / particle.maxLife;
        ctx.fillStyle = particle.color;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        return true;
      });

      ctx.restore();
      frame = requestAnimationFrame(render);
    };

    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [statusRef]);

  // Keyboard.
  useEffect(() => {
    const moveKeys: Record<string, TombAction> = {
      ArrowUp: "UP",
      ArrowDown: "DOWN",
      ArrowLeft: "LEFT",
      ArrowRight: "RIGHT",
      KeyW: "UP",
      KeyS: "DOWN",
      KeyA: "LEFT",
      KeyD: "RIGHT",
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isGameInputLocked()) return;

      const finished =
        statusRef.current === "WON" || statusRef.current === "LOST";
      if (finished) {
        if (
          event.code === "Space" ||
          event.code === "Enter" ||
          event.code === "KeyR"
        ) {
          event.preventDefault();
          resetGame();
        }
        return;
      }

      if (statusRef.current === "IDLE") {
        if (event.code === "Space" || event.code === "Enter") {
          event.preventDefault();
          begin();
          return;
        }
      }

      const dir = moveKeys[event.code];
      if (dir) {
        event.preventDefault();
        pushAction(dir);
        return;
      }

      if (
        event.code === "KeyF" &&
        !(event.target instanceof HTMLInputElement)
      ) {
        event.preventDefault();
        onToggleFocus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [begin, onToggleFocus, pushAction, resetGame, statusRef]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (statusRef.current === "WON" || statusRef.current === "LOST") return;
    if (statusRef.current === "IDLE") begin();
    swipeRef.current = { x: event.clientX, y: event.clientY };
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) {
      return;
    }
    pushAction(
      Math.abs(dx) > Math.abs(dy)
        ? dx > 0
          ? "RIGHT"
          : "LEFT"
        : dy > 0
          ? "DOWN"
          : "UP"
    );
  };

  const hint = state.doorOpen
    ? "Door open — reach the exit"
    : state.hasKey
      ? "Key in hand — break the door"
      : state.gateOpen
        ? "Grab the key behind the gate"
        : "Step on the switch to open the gate";

  const overPar = state.moves - state.parTotal;

  return (
    <GameShell className="tomb-card">
      <GameHud
        stats={[
          {
            label: "Floor",
            value: `${state.floor + 1}/${state.floors}`,
            tone: "highlight",
          },
          {
            label: "Slides",
            value: `${state.moves} / ${state.parTotal}`,
            align: "center",
            tone: overPar > 4 ? "danger" : "default",
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
        className="tomb-board-wrapper"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          swipeRef.current = null;
        }}
        onContextMenu={(event) => event.preventDefault()}
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="tomb-canvas"
          aria-label="Tomb escape maze"
        />

        {status === "IDLE" && (
          <div className="canvas-overlay tomb-overlay">
            <h3 className="overlay-title">Ready?</h3>
            <p className="overlay-subtitle">
              You slide until you hit something.
              <br />
              Press the switch, take the key, open the door — then escape.
            </p>
            <button
              className="btn-primary"
              onClick={() => {
                begin();
              }}
            >
              Start run <kbd className="keycap overlay-keycap">Space</kbd>
            </button>
          </div>
        )}

        {status === "SUBMITTING" && (
          <ResultOverlay
            variant="submitting"
            title="Tomb escaped!"
            message="Replaying every slide on the server engine..."
          />
        )}

        {status === "WON" && (
          <ResultOverlay
            variant="win"
            title="Tomb Escaped"
            timeMs={elapsedMs}
            stats={[
              { label: "Floors", value: `${state.floors}` },
              { label: "Slides", value: `${state.moves}` },
              {
                label: "Over par",
                value: overPar > 0 ? `+${overPar}` : `${overPar}`,
                tone: overPar > 0 ? "warning" : "success",
              },
            ]}
            rank={rank}
            message={resultMessage}
            onRetry={resetGame}
            retryLabel="Delve again"
          />
        )}

        {status === "LOST" && (
          <ResultOverlay
            variant="lost"
            title="Buried Alive"
            message={resultMessage}
            onRetry={resetGame}
            retryLabel="Try Again"
          />
        )}
      </div>

      <div className="controls-bar tomb-controls">
        <div className="tomb-controls-keys">
          <span className="keycap">↑</span>
          <span className="keycap">↓</span>
          <span className="keycap">←</span>
          <span className="keycap">→</span>
          <span>or</span>
          <span className="keycap">W</span>
          <span className="keycap">A</span>
          <span className="keycap">S</span>
          <span className="keycap">D</span>
          <span>slide · swipe on touch</span>
        </div>

        <div className="tomb-controls-actions">
          <span className="tomb-hint">{hint}</span>
          <button
            type="button"
            className={`action-pill-btn${isFocusMode ? " active" : ""}`}
            onClick={onToggleFocus}
            title="Focus / pop-up mode"
          >
            <span>{isFocusMode ? "Exit Focus" : "Focus Mode"}</span>
            <span className="keycap" style={{ fontSize: 10 }}>
              F
            </span>
          </button>
        </div>
      </div>
    </GameShell>
  );
};
