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

type GameStatus = "IDLE" | "PLAYING" | "CRASHED" | "WON" | "SUBMITTING";

export const SnakeCanvas: React.FC<SnakeCanvasProps> = ({
  seed,
  isFocusMode,
  onToggleFocus,
  onRunFinished,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef(new SnakeGameEngine());

  // Game state refs (for smooth 60/120+ FPS animation loop without React render overhead)
  const stateRef = useRef<SnakeState>(engineRef.current.init(seed));
  const prevBodyRef = useRef<Point[]>([...stateRef.current.body]);
  const lastTickTimeRef = useRef<number>(performance.now());
  const inputsRef = useRef<TimestampedInput<SnakeDirection>[]>([]);
  const startTimeRef = useRef<number>(0);
  const gameStatusRef = useRef<GameStatus>("IDLE");

  // React UI state
  const [status, setStatus] = useState<GameStatus>("IDLE");
  const [currentLength, setCurrentLength] = useState<number>(3);
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [resultMessage, setResultMessage] = useState<string>("");
  const [lastVerifiedRank, setLastVerifiedRank] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  const setGameStatus = (newStatus: GameStatus) => {
    gameStatusRef.current = newStatus;
    setStatus(newStatus);
  };

  const inputQueueRef = useRef<SnakeDirection[]>([]);

  // Reset or start fresh run
  const resetGame = useCallback(() => {
    const freshState = engineRef.current.init(seed);
    stateRef.current = freshState;
    prevBodyRef.current = [...freshState.body];
    lastTickTimeRef.current = performance.now();
    inputsRef.current = [];
    inputQueueRef.current = [];
    startTimeRef.current = 0;
    setCurrentLength(freshState.body.length);
    setElapsedMs(0);
    setResultMessage("");
    setLastVerifiedRank(null);
    setGameStatus("IDLE");
  }, [seed]);

  useEffect(() => {
    resetGame();
  }, [resetGame]);

  // Handle directional input with turn queue (buffers up to 2 rapid turns)
  const handleDirection = useCallback(
    (newDir: SnakeDirection) => {
      const currentStatus = gameStatusRef.current;

      // Start run on first input
      if (currentStatus === "IDLE") {
        startTimeRef.current = performance.now();
        lastTickTimeRef.current = performance.now();
        setGameStatus("PLAYING");
      } else if (currentStatus !== "PLAYING") {
        return;
      }

      // Check against last queued turn (or current direction if queue empty)
      const lastDir =
        inputQueueRef.current.length > 0
          ? inputQueueRef.current[inputQueueRef.current.length - 1]
          : stateRef.current.direction;

      if (newDir !== OPPOSITE_DIRECTIONS[lastDir] && newDir !== lastDir) {
        if (inputQueueRef.current.length < 2) {
          inputQueueRef.current.push(newDir);
          // Guide sub-tick visual rendering towards the next pending turn
          stateRef.current = {
            ...stateRef.current,
            nextDirection: inputQueueRef.current[0],
          };
        }
      }
    },
    []
  );

  // Keyboard controls: single button restart (Space or Enter), WASD / Arrow keys, Focus mode (F)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent browser scroll on space & arrow keys
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
        e.preventDefault();
      }

      // Single-button instant restart on Space or Enter (or 'R')
      if (e.code === "Space" || e.code === "Enter" || e.code === "KeyR") {
        if (
          gameStatusRef.current === "CRASHED" ||
          gameStatusRef.current === "WON" ||
          e.code === "KeyR"
        ) {
          resetGame();
          return;
        }
        if (gameStatusRef.current === "IDLE") {
          handleDirection("RIGHT");
          return;
        }
      }

      // Toggle focus mode on 'F' key if not typing in an input
      if (e.code === "KeyF" && !(e.target instanceof HTMLInputElement)) {
        onToggleFocus();
        return;
      }

      // Exit focus mode or fullscreen on Escape
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
  }, [handleDirection, resetGame, onToggleFocus, isFocusMode]);

  // Toggle native browser fullscreen
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
      // Fallback: toggle focus mode
      onToggleFocus();
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // Fixed deterministic tick loop (100ms per tick)
  useEffect(() => {
    if (status !== "PLAYING") return;

    const tickInterval = setInterval(() => {
      if (gameStatusRef.current !== "PLAYING") return;

      const currentState = stateRef.current;
      // Record previous body snapshot for sub-tick 60/120+ FPS interpolation
      prevBodyRef.current = currentState.body.map((p) => ({ ...p }));
      lastTickTimeRef.current = performance.now();

      // Check if there is a buffered turn queued
      let turnAction: SnakeDirection | undefined = undefined;
      if (inputQueueRef.current.length > 0) {
        turnAction = inputQueueRef.current.shift()!;
        const timeElapsed = Math.max(0, Math.round(performance.now() - startTimeRef.current));
        inputsRef.current.push({
          t: timeElapsed,
          tick: currentState.tickCount,
          action: turnAction,
        });
      }

      const stepRes = engineRef.current.step(currentState, turnAction);
      stateRef.current = stepRes.state;

      setCurrentLength(stepRes.state.body.length);

      if (stepRes.gameOver) {
        setGameStatus("CRASHED");
        setResultMessage("Snake crashed into a wall or itself!");
        return;
      }

      if (stepRes.win) {
        setGameStatus("SUBMITTING");
        const claimedTime = Math.round(performance.now() - startTimeRef.current);
        setElapsedMs(claimedTime);

        // Confetti celebration
        confetti({
          particleCount: 75,
          spread: 60,
          origin: { y: 0.55 },
          colors: ["#059669", "#0284c7", "#f59e0b"],
        });

        // Submit to edge server for deterministic verification
        onRunFinished(claimedTime, [...inputsRef.current])
          .then((res) => {
            if (res.verified) {
              setGameStatus("WON");
              setLastVerifiedRank(res.rank ?? null);
              setResultMessage(
                res.rank
                  ? `Verified! You claimed rank #${res.rank}!`
                  : "Run Verified!"
              );
            } else {
              setGameStatus("CRASHED");
              setResultMessage(res.error || "Anti-cheat rejected run");
            }
          })
          .catch((err) => {
            setGameStatus("CRASHED");
            setResultMessage(err.message || "Network error");
          });
      }
    }, stateRef.current.tickMs);

    return () => clearInterval(tickInterval);
  }, [status, onRunFinished]);

  // Live stopwatch loop (60fps)
  useEffect(() => {
    if (status !== "PLAYING") return;

    let animFrame: number;
    const updateTimer = () => {
      if (gameStatusRef.current === "PLAYING") {
        setElapsedMs(Math.round(performance.now() - startTimeRef.current));
        animFrame = requestAnimationFrame(updateTimer);
      }
    };

    animFrame = requestAnimationFrame(updateTimer);
    return () => cancelAnimationFrame(animFrame);
  }, [status]);

  // High-FPS Canvas Rendering with Sub-Tick Interpolation (60/120/144+ FPS)
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

      // Clean white minimalist canvas background
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);

      // Delicate subtle grid lines
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

      // Calculate Sub-Tick Interpolation Progress: [0.0, 1.0]
      const now = performance.now();
      const progress =
        gameStatusRef.current === "PLAYING"
          ? Math.min(1, Math.max(0, (now - lastTickTimeRef.current) / state.tickMs))
          : 1;

      // Draw Apple (vivid ruby with subtle pulse)
      const pulse = 1 + Math.sin(now / 180) * 0.06;
      const foodRadius = (cellSize / 2.3) * pulse;
      const foodCenterX = state.food.x * cellSize + cellSize / 2;
      const foodCenterY = state.food.y * cellSize + cellSize / 2;

      // Soft ambient shadow under apple
      ctx.fillStyle = "rgba(225, 29, 72, 0.15)";
      ctx.beginPath();
      ctx.arc(foodCenterX, foodCenterY + 2, foodRadius * 1.1, 0, Math.PI * 2);
      ctx.fill();

      // Apple circle
      ctx.fillStyle = "#e11d48";
      ctx.beginPath();
      ctx.arc(foodCenterX, foodCenterY, foodRadius, 0, Math.PI * 2);
      ctx.fill();

      // Apple leaf
      ctx.fillStyle = "#059669";
      ctx.fillRect(foodCenterX - 1, foodCenterY - foodRadius - 2, 2, 4);

      // Draw Snake with Sub-Tick Smooth Interpolation
      const currBody = state.body;
      const prevBody = prevBodyRef.current;

      for (let i = currBody.length - 1; i >= 0; i--) {
        const curr = currBody[i];
        const prev = prevBody[i] || curr;

        // Smoothly lerp between prev and curr cell coordinates
        const renderX = (prev.x + (curr.x - prev.x) * progress) * cellSize;
        const renderY = (prev.y + (curr.y - prev.y) * progress) * cellSize;

        const isHead = i === 0;
        const padding = 1.5;
        const segSize = cellSize - padding * 2;

        if (isHead) {
          // Snake Head: Deep charcoal slate with subtle rounded corners
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

          // Snake Eyes
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

          // Pupils
          ctx.fillStyle = "#0f172a";
          ctx.beginPath();
          ctx.arc(eye1X, eye1Y, eyeRadius * 0.55, 0, Math.PI * 2);
          ctx.arc(eye2X, eye2Y, eyeRadius * 0.55, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Snake Body: Minimalist deep slate/emerald gradient
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
  }, []);

  return (
    <div className="game-card" ref={containerRef}>
      {/* Game HUD Bar */}
      <div className="game-hud">
        <div className="hud-stat">
          <span className="hud-label">Length</span>
          <span className="hud-value highlight">
            {currentLength} / {stateRef.current.targetLength}
          </span>
        </div>

        <div className="hud-stat" style={{ textAlign: "right" }}>
          <span className="hud-label">Stopwatch</span>
          <span className="hud-value timer">{formatTimeMs(elapsedMs)}</span>
        </div>
      </div>

      {/* Canvas Board & Overlays */}
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
            <button className="btn-primary" onClick={() => handleDirection("RIGHT")}>
              ▶ Start Sprint (<kbd style={{ fontFamily: "var(--font-mono)", fontSize: "11px" }}>Space</kbd>)
            </button>
          </div>
        )}

        {status === "CRASHED" && (
          <div className="canvas-overlay">
            <h3 className="overlay-title gameover">Crashed</h3>
            <p className="overlay-subtitle">{resultMessage}</p>
            <button className="btn-primary" onClick={resetGame}>
              🔄 Restart (<kbd style={{ fontFamily: "var(--font-mono)", fontSize: "11px" }}>Space / Enter</kbd>)
            </button>
            <span className="restart-hint-pill">
              Single-key restart is active
            </span>
          </div>
        )}

        {status === "SUBMITTING" && (
          <div className="canvas-overlay">
            <h3 className="overlay-title win">Goal Reached!</h3>
            <p className="overlay-subtitle">Verifying inputs with server engine...</p>
          </div>
        )}

        {status === "WON" && (
          <div className="canvas-overlay">
            <h3 className="overlay-title win">Run Verified!</h3>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "30px",
                color: "var(--accent-sky)",
                fontWeight: 700,
              }}
            >
              {formatTimeMs(elapsedMs)}
            </div>
            {lastVerifiedRank && (
              <div
                style={{
                  padding: "3px 12px",
                  borderRadius: "999px",
                  background: "var(--accent-amber-light)",
                  border: "1px solid #fde68a",
                  color: "var(--accent-amber)",
                  fontWeight: 700,
                  fontSize: "13px",
                }}
              >
                🏆 #{lastVerifiedRank} on Today's Leaderboard
              </div>
            )}
            <p className="overlay-subtitle">{resultMessage}</p>
            <button className="btn-primary" onClick={resetGame}>
              ⚡ Beat Your Record (<kbd style={{ fontFamily: "var(--font-mono)", fontSize: "11px" }}>Space</kbd>)
            </button>
          </div>
        )}
      </div>

      {/* Controls & Focus Toolbar */}
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
            <span>{isFocusMode ? "✕ Exit Focus" : "🎯 Focus Mode"}</span>
            <span className="keycap" style={{ fontSize: "10px" }}>F</span>
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

      {/* Mobile Touch Controls */}
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
    </div>
  );
};
