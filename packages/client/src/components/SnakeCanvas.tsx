import React, { useRef, useEffect, useState, useCallback } from "react";
import confetti from "canvas-confetti";
import {
  SnakeGameEngine,
  SnakeState,
  SnakeDirection,
  TimestampedInput,
  OPPOSITE_DIRECTIONS,
  Point,
} from "@daily-speedruns/shared";
import { formatTimeMs } from "../lib/storage.js";
import { isGameInputLocked } from "../lib/keyboard.js";
import { useGameSession } from "../hooks/useGameSession.js";
import { GameShell } from "./GameShell.js";
import { GameHud } from "./GameHud.js";
import { ResultOverlay } from "./ResultOverlay.js";

interface SnakeCanvasProps {
  seed: string;
  isFocusMode: boolean;
  onToggleFocus: () => void;
  onRunFinished: (
    claimedTimeMs: number,
    inputs: TimestampedInput<SnakeDirection>[]
  ) => Promise<{
    verified: boolean;
    rank?: number | null;
    error?: string;
  }>;
}

export const SnakeCanvas: React.FC<SnakeCanvasProps> = ({
  seed,
  isFocusMode,
  onToggleFocus,
  onRunFinished,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef(new SnakeGameEngine());

  const [initialState] = useState<SnakeState>(() =>
    engineRef.current.init(seed)
  );
  const stateRef = useRef<SnakeState>(initialState);
  const prevBodyRef = useRef<Point[]>([...initialState.body]);
  const lastTickTimeRef = useRef<number>(performance.now());
  const inputQueueRef = useRef<SnakeDirection[]>([]);

  const [currentLength, setCurrentLength] = useState<number>(
    initialState.body.length
  );
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

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
  } = useGameSession<SnakeDirection>({
    onRunFinished,
    winMessage: "Run Verified!",
    onWin: () => {
      confetti({
        particleCount: 75,
        spread: 60,
        origin: { y: 0.55 },
        colors: ["#059669", "#0284c7", "#f59e0b"],
      });
    },
  });

  const resetGame = useCallback(() => {
    const freshState = engineRef.current.init(seed);
    stateRef.current = freshState;
    prevBodyRef.current = [...freshState.body];
    lastTickTimeRef.current = performance.now();
    inputQueueRef.current = [];
    setCurrentLength(freshState.body.length);
    resetSession();
  }, [seed, resetSession]);

  useEffect(() => {
    resetGame();
  }, [resetGame]);

  const handleDirection = useCallback(
    (newDir: SnakeDirection) => {
      const currentStatus = statusRef.current;

      if (currentStatus === "IDLE") {
        begin();
        lastTickTimeRef.current = performance.now();
      } else if (currentStatus !== "PLAYING") {
        return;
      }

      const lastDir =
        inputQueueRef.current.length > 0
          ? inputQueueRef.current[inputQueueRef.current.length - 1]
          : stateRef.current.direction;

      if (newDir !== OPPOSITE_DIRECTIONS[lastDir] && newDir !== lastDir) {
        if (inputQueueRef.current.length < 2) {
          inputQueueRef.current.push(newDir);
          stateRef.current = {
            ...stateRef.current,
            nextDirection: inputQueueRef.current[0],
          };
        }
      }
    },
    [begin, statusRef]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isGameInputLocked()) return;

      if (
        ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
          e.code
        )
      ) {
        e.preventDefault();
      }

      if (
        statusRef.current === "CRASHED" ||
        statusRef.current === "WON" ||
        statusRef.current === "LOST" ||
        e.code === "KeyR"
      ) {
        if (
          e.code === "Space" ||
          e.code === "Enter" ||
          e.code === "KeyR"
        ) {
          resetGame();
          return;
        }
      }

      if (statusRef.current === "IDLE") {
        if (e.code === "Space" || e.code === "Enter") {
          handleDirection("RIGHT");
          return;
        }
      }

      if (e.code === "KeyF" && !(e.target instanceof HTMLInputElement)) {
        onToggleFocus();
        return;
      }

      if (e.code === "Escape") {
        if (isFocusMode) {
          onToggleFocus();
        }
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
        return;
      }

      switch (e.code) {
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
  }, [
    handleDirection,
    resetGame,
    onToggleFocus,
    isFocusMode,
    statusRef,
  ]);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        if (containerRef.current) {
          await containerRef.current.requestFullscreen();
          setIsFullscreen(true);
        }
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch {
      onToggleFocus();
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // Fixed deterministic tick loop.
  useEffect(() => {
    if (status !== "PLAYING") return;

    const tickInterval = setInterval(() => {
      if (statusRef.current !== "PLAYING") return;

      const currentState = stateRef.current;
      prevBodyRef.current = currentState.body.map((p) => ({ ...p }));
      lastTickTimeRef.current = performance.now();

      let turnAction: SnakeDirection | undefined;
      if (inputQueueRef.current.length > 0) {
        turnAction = inputQueueRef.current.shift()!;
        record(turnAction, now(), currentState.tickCount);
      }

      const stepRes = engineRef.current.step(currentState, turnAction);
      stateRef.current = stepRes.state;
      setCurrentLength(stepRes.state.body.length);

      if (stepRes.gameOver) {
        fail("Snake crashed into a wall or itself!", "CRASHED");
        return;
      }

      if (stepRes.win) {
        submit(Math.max(1, now()));
      }
    }, stateRef.current.tickMs);

    return () => clearInterval(tickInterval);
  }, [status, now, record, submit, fail, statusRef]);

  // High-FPS canvas rendering with sub-tick interpolation.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;

    const render = () => {
      const state = stateRef.current;
      const width = canvas.width;
      const height = canvas.height;
      const cellSize = width / state.gridSize;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = "#f1f5f9";
      ctx.lineWidth = 1;
      for (let x = 0; x <= width; x += cellSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y <= height; y += cellSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      const nowMs = performance.now();
      const progress =
        statusRef.current === "PLAYING"
          ? Math.min(
              1,
              Math.max(
                0,
                (nowMs - lastTickTimeRef.current) / state.tickMs
              )
            )
          : 1;

      const pulse = 1 + Math.sin(nowMs / 180) * 0.06;
      const foodRadius = (cellSize / 2.3) * pulse;
      const foodCenterX = state.food.x * cellSize + cellSize / 2;
      const foodCenterY = state.food.y * cellSize + cellSize / 2;

      ctx.fillStyle = "rgba(225, 29, 72, 0.15)";
      ctx.beginPath();
      ctx.arc(foodCenterX, foodCenterY + 2, foodRadius * 1.1, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#e11d48";
      ctx.beginPath();
      ctx.arc(foodCenterX, foodCenterY, foodRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#059669";
      ctx.fillRect(foodCenterX - 1, foodCenterY - foodRadius - 2, 2, 4);

      const currBody = state.body;
      const prevBody = prevBodyRef.current;

      for (let i = currBody.length - 1; i >= 0; i--) {
        const curr = currBody[i];
        const prev = prevBody[i] || curr;

        const renderX = (prev.x + (curr.x - prev.x) * progress) * cellSize;
        const renderY = (prev.y + (curr.y - prev.y) * progress) * cellSize;

        const isHead = i === 0;
        const padding = 1.5;
        const segSize = cellSize - padding * 2;

        if (isHead) {
          ctx.fillStyle = "#0f172a";
          ctx.beginPath();
          ctx.roundRect(
            renderX + padding,
            renderY + padding,
            segSize,
            segSize,
            cellSize * 0.35
          );
          ctx.fill();

          ctx.fillStyle = "#ffffff";
          const eyeRadius = cellSize * 0.13;
          let eye1X = renderX + cellSize * 0.3;
          let eye1Y = renderY + cellSize * 0.3;
          let eye2X = renderX + cellSize * 0.7;
          let eye2Y = renderY + cellSize * 0.3;

          if (state.direction === "DOWN") {
            eye1Y = renderY + cellSize * 0.7;
            eye2Y = renderY + cellSize * 0.7;
          } else if (state.direction === "LEFT") {
            eye1X = renderX + cellSize * 0.3;
            eye2X = renderX + cellSize * 0.3;
            eye1Y = renderY + cellSize * 0.3;
            eye2Y = renderY + cellSize * 0.7;
          } else if (state.direction === "RIGHT") {
            eye1X = renderX + cellSize * 0.7;
            eye2X = renderX + cellSize * 0.7;
            eye1Y = renderY + cellSize * 0.3;
            eye2Y = renderY + cellSize * 0.7;
          }

          ctx.beginPath();
          ctx.arc(eye1X, eye1Y, eyeRadius, 0, Math.PI * 2);
          ctx.arc(eye2X, eye2Y, eyeRadius, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = "#0f172a";
          ctx.beginPath();
          ctx.arc(eye1X, eye1Y, eyeRadius * 0.55, 0, Math.PI * 2);
          ctx.arc(eye2X, eye2Y, eyeRadius * 0.55, 0, Math.PI * 2);
          ctx.fill();
        } else {
          const ratio = 1 - i / currBody.length;
          ctx.fillStyle = `rgba(15, 23, 42, ${0.45 + ratio * 0.45})`;

          ctx.beginPath();
          ctx.roundRect(
            renderX + padding,
            renderY + padding,
            segSize,
            segSize,
            cellSize * 0.25
          );
          ctx.fill();
        }
      }

      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [statusRef]);

  return (
    <GameShell ref={containerRef}>
      <GameHud
        stats={[
          {
            label: "Length",
            value: `${currentLength} / ${stateRef.current.targetLength}`,
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

      <div className="canvas-wrapper">
        <canvas
          ref={canvasRef}
          width={540}
          height={540}
          className="snake-canvas"
          aria-label="Snake Game Board"
        />

        {status === "IDLE" && (
          <div className="canvas-overlay">
            <h3 className="overlay-title">Ready?</h3>
            <p className="overlay-subtitle">
              Reach length <strong>20</strong> as fast as you can.
            </p>
            <button
              className="btn-primary"
              onClick={() => handleDirection("RIGHT")}
            >
              ▶ Start Sprint <kbd className="keycap overlay-keycap">Space</kbd>
            </button>
          </div>
        )}

        {status === "CRASHED" && (
          <ResultOverlay
            variant="crashed"
            title="Crashed"
            message={resultMessage}
            onRetry={resetGame}
            retryLabel="Restart"
          >
            <span className="restart-hint-pill">
              Single-key restart is active
            </span>
          </ResultOverlay>
        )}

        {status === "SUBMITTING" && (
          <ResultOverlay
            variant="submitting"
            title="Goal Reached!"
            message="Verifying inputs with server engine..."
          />
        )}

        {status === "WON" && (
          <ResultOverlay
            variant="win"
            title="Run Verified!"
            timeMs={elapsedMs}
            rank={rank}
            message={resultMessage}
            onRetry={resetGame}
          />
        )}

        {status === "LOST" && (
          <ResultOverlay
            variant="lost"
            title="Run Rejected"
            message={resultMessage}
            onRetry={resetGame}
            retryLabel="Try Again"
          />
        )}
      </div>

      <div className="controls-bar">
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span>Restart:</span>
          <span className="keycap">Space</span>
          <span>or</span>
          <span className="keycap">Enter</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            type="button"
            className={`action-pill-btn ${isFocusMode ? "active" : ""}`}
            onClick={onToggleFocus}
            title="Focus / Pop-up mode (mute background)"
          >
            <span>{isFocusMode ? "Exit Focus" : "Focus Mode"}</span>
            <span className="keycap" style={{ fontSize: "10px" }}>
              F
            </span>
          </button>

          <button
            type="button"
            className="action-pill-btn"
            onClick={toggleFullscreen}
            title="Toggle native fullscreen"
          >
            <span>{isFullscreen ? "⛶ Exit Fullscreen" : "⛶ Fullscreen"}</span>
          </button>
        </div>
      </div>

      <div className="mobile-controls" aria-label="Touch directional controls">
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
