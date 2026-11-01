import React, { useCallback, useEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  BREAKOUT_CONFIG,
  BreakoutAction,
  BreakoutGameEngine,
  BreakoutState,
  TimestampedInput,
} from "@daily-speedruns/shared";
import { formatTimeMs } from "../lib/storage.js";
import { isGameInputLocked } from "../lib/keyboard.js";
import { useGameSession } from "../hooks/useGameSession.js";
import { GameShell } from "./GameShell.js";
import { GameHud } from "./GameHud.js";
import { ResultOverlay } from "./ResultOverlay.js";

interface BreakoutGameProps {
  seed: string;
  isFocusMode: boolean;
  onToggleFocus: () => void;
  onRunFinished: (
    claimedTimeMs: number,
    inputs: TimestampedInput<BreakoutAction>[]
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

const CELL = 50;
const CANVAS_WIDTH = (BOARD_WIDTH / BREAKOUT_CONFIG.SUB) * CELL;
const CANVAS_HEIGHT = (BOARD_HEIGHT / BREAKOUT_CONFIG.SUB) * CELL;
const UNIT = CELL / BREAKOUT_CONFIG.SUB;

const BRICK_FILL: Record<number, [string, string]> = {
  1: ["#f4ead6", "#c9bda4"],
  2: ["#ff7a3d", "#c2410c"],
  3: ["#7ce3a5", "#2f8a5f"],
};

function px(units: number): number {
  return units * UNIT;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function sameAction(
  a: BreakoutAction | undefined,
  b: BreakoutAction | undefined
): boolean {
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === "MOVE" && b.type === "MOVE") return a.dir === b.dir;
  if (a.type === "AIM" && b.type === "AIM") return a.x === b.x;
  return false;
}

function drawBackground(ctx: CanvasRenderingContext2D) {
  const gradient = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
  gradient.addColorStop(0, "#0a0d10");
  gradient.addColorStop(0.55, "#0c1116");
  gradient.addColorStop(1, "#080b0e");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Faint vertical guide lines keep the wall readable.
  ctx.strokeStyle = "rgba(242, 239, 232, 0.035)";
  ctx.lineWidth = 1;
  for (let col = 1; col < BREAKOUT_CONFIG.COLS; col++) {
    const x = col * CELL;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, CANVAS_HEIGHT);
    ctx.stroke();
  }

  // Paddle deck.
  const deckY = px(BREAKOUT_CONFIG.PADDLE_TOP) - 6;
  ctx.strokeStyle = "rgba(255, 77, 0, 0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, deckY);
  ctx.lineTo(CANVAS_WIDTH, deckY);
  ctx.stroke();
}

function drawBricks(
  ctx: CanvasRenderingContext2D,
  state: BreakoutState,
  time: number
) {
  const { COLS, BRICK_ROWS, SUB, BRICK_HEIGHT, BRICK_TOP, BRICK_PITCH } =
    BREAKOUT_CONFIG;

  for (let row = 0; row < BRICK_ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const hp = state.bricks[row * COLS + col];
      if (hp <= 0) continue;

      const x = px(col * SUB) + 3;
      const y = px(BRICK_TOP + row * BRICK_PITCH) + 3;
      const w = px(SUB) - 6;
      const h = px(BRICK_HEIGHT) - 6;
      const [light, dark] = BRICK_FILL[hp] ?? BRICK_FILL[3];

      const fill = ctx.createLinearGradient(0, y, 0, y + h);
      fill.addColorStop(0, light);
      fill.addColorStop(1, dark);
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 4);
      ctx.fill();

      // Top highlight + bottom shade read as a bevel at this size.
      ctx.fillStyle = "rgba(255, 255, 255, 0.28)";
      ctx.fillRect(x + 2, y + 2, w - 4, 2);
      ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
      ctx.fillRect(x + 2, y + h - 3, w - 4, 2);

      if (hp > 1) {
        // Damaged bricks show a crack so the extra hit point is readable.
        ctx.strokeStyle = "rgba(20, 12, 8, 0.55)";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x + w * 0.3, y + 3);
        ctx.lineTo(x + w * 0.45, y + h * 0.5);
        ctx.lineTo(x + w * 0.34, y + h - 3);
        ctx.moveTo(x + w * 0.62, y + h * 0.2);
        ctx.lineTo(x + w * 0.5, y + h * 0.62);
        ctx.stroke();
      }
    }
  }

  // A slow sheen across the wall keeps it from looking static.
  const sheenX = ((time / 42) % (CANVAS_WIDTH + 260)) - 130;
  const sheen = ctx.createLinearGradient(sheenX - 90, 0, sheenX + 90, 0);
  sheen.addColorStop(0, "rgba(255, 255, 255, 0)");
  sheen.addColorStop(0.5, "rgba(255, 255, 255, 0.05)");
  sheen.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, px(BREAKOUT_CONFIG.BRICK_TOP), CANVAS_WIDTH, px(2400));
  ctx.clip();
  ctx.fillStyle = sheen;
  ctx.fillRect(0, px(BREAKOUT_CONFIG.BRICK_TOP), CANVAS_WIDTH, px(2400));
  ctx.restore();
}

function drawPaddle(ctx: CanvasRenderingContext2D, state: BreakoutState) {
  const x = px(state.paddleX);
  const y = px(BREAKOUT_CONFIG.PADDLE_TOP);
  const w = px(BREAKOUT_CONFIG.PADDLE_WIDTH);
  const h = px(BREAKOUT_CONFIG.PADDLE_HEIGHT);

  ctx.save();
  ctx.shadowColor = "rgba(255, 77, 0, 0.55)";
  ctx.shadowBlur = 16;
  const fill = ctx.createLinearGradient(0, y, 0, y + h);
  fill.addColorStop(0, "#ffb27a");
  fill.addColorStop(0.45, "#ff6a2b");
  fill.addColorStop(1, "#a82d00");
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 6);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
  ctx.fillRect(x + 4, y + 3, w - 8, 2);

  // Side caps double as a "this is the hit box" cue.
  ctx.fillStyle = "rgba(9, 12, 15, 0.5)";
  ctx.beginPath();
  ctx.roundRect(x, y, 5, h, 3);
  ctx.roundRect(x + w - 5, y, 5, h, 3);
  ctx.fill();
}

function drawBall(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  live: boolean
) {
  const r = px(radius);
  ctx.save();
  if (live) {
    const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 3.2);
    halo.addColorStop(0, "rgba(255, 240, 210, 0.55)");
    halo.addColorStop(1, "rgba(255, 240, 210, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, r * 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowColor = "rgba(255, 236, 196, 0.9)";
  ctx.shadowBlur = 14;
  ctx.fillStyle = live ? "#fff8ec" : "#8b8578";
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export const BreakoutGame: React.FC<BreakoutGameProps> = ({
  seed,
  isFocusMode,
  onToggleFocus,
  onRunFinished,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef(new BreakoutGameEngine());

  const [state, setState] = useState<BreakoutState>(() =>
    engineRef.current.init(seed)
  );
  const stateRef = useRef<BreakoutState>(state);
  const previousRef = useRef<BreakoutState>(state);

  const particlesRef = useRef<Particle[]>([]);
  const shakeAtRef = useRef(0);
  /** Latest intent from the keyboard or pointer, consumed by the next tick. */
  const pendingRef = useRef<BreakoutAction | undefined>(undefined);
  /** The intent the current tick actually ran with. */
  const appliedRef = useRef<BreakoutAction | undefined>(undefined);
  const lastAimRef = useRef<number>(-1);
  const lastTickAtRef = useRef<number>(performance.now());

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
  } = useGameSession<BreakoutAction>({
    onRunFinished,
    winMessage: "Wall cleared!",
    onWin: () => {
      confetti({
        particleCount: 100,
        spread: 80,
        origin: { y: 0.6 },
        colors: ["#ff4d00", "#f2efe8", "#7ce3a5"],
      });
    },
  });

  const resetGame = useCallback(() => {
    const fresh = engineRef.current.init(seed);
    stateRef.current = fresh;
    previousRef.current = fresh;
    pendingRef.current = undefined;
    appliedRef.current = undefined;
    lastAimRef.current = -1;
    particlesRef.current = [];
    setState(fresh);
    resetSession();
  }, [seed, resetSession]);

  useEffect(() => {
    resetGame();
  }, [resetGame]);

  /** Queues an input; the next simulation tick records and applies it. */
  const pushAction = useCallback(
    (action: BreakoutAction) => {
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
        const speed = 0.8 + Math.random() * 2.6;
        particlesRef.current.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 0.8,
          life: 0,
          maxLife: 18 + Math.random() * 20,
          size: 1.6 + Math.random() * 2.4,
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
      previousRef.current = current;

      // One recorded input per tick, always exactly what the tick simulates,
      // so the server replay sees the same stream the browser saw.
      const pending = pendingRef.current;
      if (pending !== undefined && !sameAction(pending, appliedRef.current)) {
        appliedRef.current = pending;
        pendingRef.current = undefined;
        record(pending, now(), current.tickCount);
      }

      const result = engineRef.current.step(current, appliedRef.current);
      const next = result.state;
      stateRef.current = next;
      lastTickAtRef.current = performance.now();
      setState(next);

      if (result.event === "brick") {
        const bx = px(next.ball.x);
        const by = px(next.ball.y);
        spawnSparks(bx, by, "#ffb27a", 10);
      } else if (result.event === "paddle") {
        spawnSparks(px(next.ball.x), px(BREAKOUT_CONFIG.PADDLE_TOP), "#ffd8a8", 5);
      } else if (result.event === "lifeLost") {
        shakeAtRef.current = performance.now();
        spawnSparks(px(next.ball.x), CANVAS_HEIGHT - 20, "#ff4d00", 18);
        if (result.gameOver) {
          fail("Out of lives. The wall held.");
          return;
        }
      } else if (result.event === "timeout" || result.gameOver) {
        fail("Time's up. The wall is still standing.");
        return;
      }

      if (result.win) {
        submit(next.tickCount * next.tickMs);
      }
    };

    const interval = window.setInterval(tick, BREAKOUT_CONFIG.TICK_MS);
    return () => window.clearInterval(interval);
  }, [status, fail, spawnSparks, statusRef, submit]);

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

      const current = stateRef.current;
      const previous = previousRef.current;
      const playing = statusRef.current === "PLAYING";
      const alpha = playing
        ? clamp(
            (nowMs - lastTickAtRef.current) / BREAKOUT_CONFIG.TICK_MS,
            0,
            1
          )
        : 1;

      ctx.save();
      ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      const shakeAge = nowMs - shakeAtRef.current;
      if (shakeAge < 280) {
        const strength = (1 - shakeAge / 280) * 6;
        ctx.translate(
          (Math.random() - 0.5) * strength,
          (Math.random() - 0.5) * strength
        );
      }

      drawBackground(ctx);
      drawBricks(ctx, current, nowMs);

      // Ball: hold on the paddle while serving, otherwise interpolate.
      const serving = current.serveTicks > 0;
      const ballX = serving
        ? px(current.paddleX + BREAKOUT_CONFIG.PADDLE_WIDTH / 2)
        : px(previous.ball.x + (current.ball.x - previous.ball.x) * alpha);
      const ballY = serving
        ? px(BREAKOUT_CONFIG.PADDLE_TOP - BREAKOUT_CONFIG.BALL_RADIUS - 4)
        : px(previous.ball.y + (current.ball.y - previous.ball.y) * alpha);

      drawPaddle(ctx, current);
      drawBall(
        ctx,
        ballX,
        ballY,
        BREAKOUT_CONFIG.BALL_RADIUS * (serving ? 0.9 : 1),
        current.lives > 0 && current.status !== "LOST"
      );

      // Sparks.
      particlesRef.current = particlesRef.current.filter((particle) => {
        particle.life += dt;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vy += 0.09 * dt;
        if (particle.life >= particle.maxLife) return false;
        const opacity = 1 - particle.life / particle.maxLife;
        ctx.globalAlpha = opacity;
        ctx.fillStyle = particle.color;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        return true;
      });

      // Serve hint.
      if (serving && playing) {
        ctx.fillStyle = "rgba(242, 239, 232, 0.45)";
        ctx.font = "600 11px 'IBM Plex Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillText(
          `SERVE IN ${(current.serveTicks * BREAKOUT_CONFIG.TICK_MS) / 1000 < 0.1 ? 0 : Math.ceil((current.serveTicks * BREAKOUT_CONFIG.TICK_MS) / 1000)}`,
          CANVAS_WIDTH / 2,
          px(BREAKOUT_CONFIG.PADDLE_TOP) - 26
        );
        ctx.textAlign = "left";
      }

      ctx.restore();
      frame = requestAnimationFrame(render);
    };

    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [statusRef]);

  // Keyboard.
  useEffect(() => {
    const held = { left: false, right: false };

    const syncMove = () => {
      if (held.left === held.right) {
        pushAction({ type: "MOVE", dir: "STOP" });
      } else {
        pushAction({ type: "MOVE", dir: held.left ? "LEFT" : "RIGHT" });
      }
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
          pushAction({ type: "MOVE", dir: "STOP" });
          return;
        }
      }

      if (event.code === "ArrowLeft" || event.code === "KeyA") {
        event.preventDefault();
        if (!held.left) {
          held.left = true;
          syncMove();
        }
      } else if (event.code === "ArrowRight" || event.code === "KeyD") {
        event.preventDefault();
        if (!held.right) {
          held.right = true;
          syncMove();
        }
      } else if (event.code === "KeyF" && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault();
        onToggleFocus();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "ArrowLeft" || event.code === "KeyA") {
        if (held.left) {
          held.left = false;
          syncMove();
        }
      } else if (event.code === "ArrowRight" || event.code === "KeyD") {
        if (held.right) {
          held.right = false;
          syncMove();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [begin, onToggleFocus, pushAction, resetGame, statusRef]);

  const aimAt = useCallback(
    (clientX: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const boardX = Math.round(((clientX - rect.left) / rect.width) * BOARD_WIDTH);
      if (Math.abs(boardX - lastAimRef.current) < 60) return;
      lastAimRef.current = boardX;
      pushAction({ type: "AIM", x: clamp(boardX, 0, BOARD_WIDTH) });
    },
    [pushAction]
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (statusRef.current === "WON" || statusRef.current === "LOST") return;
    if (statusRef.current === "IDLE") begin();
    aimAt(event.clientX);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.buttons === 0) return;
    aimAt(event.clientX);
  };

  const serving = state.serveTicks > 0;

  return (
    <GameShell className="breakout-card">
      <GameHud
        stats={[
          {
            label: "Bricks",
            value: `${state.bricksLeft}`,
            tone: "highlight",
          },
          {
            label: "Lives",
            value: `${state.lives}`,
            align: "center",
            tone: state.lives <= 1 ? "danger" : "default",
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
        className="breakout-board-wrapper"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onContextMenu={(event) => event.preventDefault()}
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="breakout-canvas"
          aria-label="Breakout brick wall"
        />

        {status === "IDLE" && (
          <div className="canvas-overlay breakout-overlay">
            <h3 className="overlay-title">Ready?</h3>
            <p className="overlay-subtitle">
              Clear all {state.bricksLeft} bricks with three lives.
              <br />
              Move with <kbd className="keycap">←</kbd>{" "}
              <kbd className="keycap">→</kbd>, drag the paddle, or use the
              pointer.
            </p>
            <button
              className="btn-primary"
              onClick={() => {
                begin();
                pushAction({ type: "MOVE", dir: "STOP" });
              }}
            >
              Start run{" "}
              <kbd className="keycap overlay-keycap">Space</kbd>
            </button>
          </div>
        )}

        {status === "SUBMITTING" && (
          <ResultOverlay
            variant="submitting"
            title="Wall cleared!"
            message="Verifying the paddle stream with the server engine..."
          />
        )}

        {status === "WON" && (
          <ResultOverlay
            variant="win"
            title="Wall Cleared"
            timeMs={elapsedMs}
            stats={[
              {
                label: "Bricks",
                value: `${state.bricksBroken}`,
              },
              {
                label: "Lives left",
                value: `${state.lives}`,
                tone: state.lives === BREAKOUT_CONFIG.LIVES ? "success" : "warning",
              },
              {
                label: "Paddle hits",
                value: `${state.paddleHits}`,
              },
            ]}
            rank={rank}
            message={resultMessage}
            onRetry={resetGame}
            retryLabel="Run it again"
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

      <div className="controls-bar breakout-controls">
        <div className="breakout-controls-keys">
          <span className="keycap">←</span>
          <span className="keycap">→</span>
          <span>or</span>
          <span className="keycap">A</span>
          <span className="keycap">D</span>
          <span>move</span>
          <span>·</span>
          <span>drag to aim</span>
        </div>

        <div className="breakout-controls-actions">
          <span className="breakout-serve-state">
            {serving ? "Serve on the way" : "Ball live"}
          </span>
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
