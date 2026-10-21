import React, { useState, useEffect, useRef, useCallback } from "react";
import confetti from "canvas-confetti";
import {
  Game2048Engine,
  Game2048State,
  MoveDirection,
  TimestampedInput,
} from "@daily-speedruns/shared";
import { formatTimeMs } from "../lib/storage.js";

interface Game2048Props {
  seed: string;
  isFocusMode: boolean;
  onToggleFocus: () => void;
  onRunFinished: (
    claimedTimeMs: number,
    inputs: TimestampedInput<MoveDirection>[]
  ) => Promise<{
    verified: boolean;
    rank?: number | null;
    error?: string;
  }>;
}

type GameStatus = "IDLE" | "PLAYING" | "WON" | "LOST" | "SUBMITTING";

export const Game2048: React.FC<Game2048Props> = ({
  seed,
  isFocusMode,
  onToggleFocus,
  onRunFinished,
}) => {
  const engineRef = useRef(new Game2048Engine());

  const [state, setState] = useState<Game2048State>(() => engineRef.current.init(seed));
  const [status, setStatus] = useState<GameStatus>("IDLE");
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [resultMessage, setResultMessage] = useState<string>("");
  const [lastVerifiedRank, setLastVerifiedRank] = useState<number | null>(null);

  const startTimeRef = useRef<number>(0);
  const inputsRef = useRef<TimestampedInput<MoveDirection>[]>([]);
  const statusRef = useRef<GameStatus>("IDLE");
  statusRef.current = status;

  // Touch swipe tracking
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  // Reset or start fresh run
  const resetGame = useCallback(() => {
    const fresh = engineRef.current.init(seed);
    setState(fresh);
    setStatus("IDLE");
    setElapsedMs(0);
    setResultMessage("");
    setLastVerifiedRank(null);
    startTimeRef.current = 0;
    inputsRef.current = [];
  }, [seed]);

  useEffect(() => {
    resetGame();
  }, [resetGame]);

  // Live stopwatch loop
  useEffect(() => {
    if (status !== "PLAYING") return;

    let animId: number;
    const updateTimer = () => {
      if (statusRef.current === "PLAYING") {
        setElapsedMs(Math.round(performance.now() - startTimeRef.current));
        animId = requestAnimationFrame(updateTimer);
      }
    };

    animId = requestAnimationFrame(updateTimer);
    return () => cancelAnimationFrame(animId);
  }, [status]);

  // Execute directional move
  const handleMove = useCallback(
    (direction: MoveDirection) => {
      if (statusRef.current === "WON" || statusRef.current === "LOST" || statusRef.current === "SUBMITTING") {
        return;
      }

      // Start run on first move
      if (statusRef.current === "IDLE") {
        startTimeRef.current = performance.now();
        setStatus("PLAYING");
      }

      const timeElapsed = Math.round(performance.now() - startTimeRef.current);
      const stepRes = engineRef.current.step(state, direction);

      // Only record and update if the board actually moved
      if (!stepRes.changed) {
        return;
      }

      inputsRef.current.push({
        t: Math.max(0, timeElapsed),
        action: direction,
      });

      setState(stepRes.state);

      if (stepRes.win) {
        setStatus("SUBMITTING");
        const claimedTime = timeElapsed;
        setElapsedMs(claimedTime);

        confetti({
          particleCount: 85,
          spread: 75,
          origin: { y: 0.6 },
          colors: ["#eab308", "#f59e0b", "#10b981"],
        });

        onRunFinished(claimedTime, [...inputsRef.current])
          .then((res) => {
            if (res.verified) {
              setStatus("WON");
              setLastVerifiedRank(res.rank ?? null);
              setResultMessage(
                res.rank
                  ? `Verified! You claimed rank #${res.rank}!`
                  : "Run Verified!"
              );
            } else {
              setStatus("LOST");
              setResultMessage(res.error || "Anti-cheat rejected run");
            }
          })
          .catch((err) => {
            setStatus("LOST");
            setResultMessage(err.message || "Network error");
          });
        return;
      }

      if (stepRes.gameOver) {
        setStatus("LOST");
        setResultMessage(`No moves left! Max tile: ${stepRes.state.maxTile}`);
      }
    },
    [state, onRunFinished]
  );

  // Keyboard controls listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
        e.preventDefault();
      }

      // Single button restart on Space / Enter when game is over
      if (e.code === "Space" || e.code === "Enter" || e.code === "KeyR") {
        if (statusRef.current === "WON" || statusRef.current === "LOST") {
          resetGame();
          return;
        }
      }

      // Toggle focus mode
      if (e.code === "KeyF" && !(e.target instanceof HTMLInputElement)) {
        onToggleFocus();
        return;
      }

      switch (e.code) {
        case "ArrowUp":
        case "KeyW":
          handleMove("UP");
          break;
        case "ArrowDown":
        case "KeyS":
          handleMove("DOWN");
          break;
        case "ArrowLeft":
        case "KeyA":
          handleMove("LEFT");
          break;
        case "ArrowRight":
        case "KeyD":
          handleMove("RIGHT");
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleMove, resetGame, onToggleFocus]);

  // Touch Swipe handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current || e.changedTouches.length === 0) return;

    const deltaX = e.changedTouches[0].clientX - touchStartRef.current.x;
    const deltaY = e.changedTouches[0].clientY - touchStartRef.current.y;
    touchStartRef.current = null;

    const minSwipeDistance = 30;
    if (Math.abs(deltaX) < minSwipeDistance && Math.abs(deltaY) < minSwipeDistance) {
      return;
    }

    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      handleMove(deltaX > 0 ? "RIGHT" : "LEFT");
    } else {
      handleMove(deltaY > 0 ? "DOWN" : "UP");
    }
  };

  return (
    <div
      className="game-card game2048-card"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* 2048 HUD Bar */}
      <div className="game-hud">
        <div className="hud-stat">
          <span className="hud-label">Max Tile</span>
          <span className="hud-value highlight">
            {state.maxTile} / {state.targetTile}
          </span>
        </div>

        <div className="hud-stat" style={{ textAlign: "center" }}>
          <span className="hud-label">Score</span>
          <span className="hud-value">{state.score.toLocaleString()}</span>
        </div>

        <div className="hud-stat" style={{ textAlign: "right" }}>
          <span className="hud-label">Stopwatch</span>
          <span className="hud-value timer">{formatTimeMs(elapsedMs)}</span>
        </div>
      </div>

      {/* 4x4 Grid Board */}
      <div className="game2048-board-wrapper">
        <div className="game2048-grid">
          {state.grid.map((row, rIdx) =>
            row.map((cellValue, cIdx) => {
              const tileClass = cellValue > 0 ? `tile-${cellValue}` : "tile-empty";
              return (
                <div key={`${rIdx}-${cIdx}`} className="game2048-cell">
                  {cellValue > 0 && (
                    <div className={`game2048-tile ${tileClass}`}>
                      {cellValue}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Overlays on Win / Loss */}
        {status === "WON" && (
          <div className="canvas-overlay" style={{ borderRadius: "var(--radius-lg)" }}>
            <h3 className="overlay-title win">512 Reached!</h3>
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

            <div style={{ display: "flex", gap: "16px", margin: "4px 0" }}>
              <div style={{ textAlign: "center" }}>
                <span style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--text-tertiary)", fontWeight: 700 }}>
                  Moves
                </span>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "18px", fontWeight: 700, color: "var(--text-primary)" }}>
                  {state.moveCount}
                </div>
              </div>

              <div style={{ textAlign: "center" }}>
                <span style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--text-tertiary)", fontWeight: 700 }}>
                  Final Score
                </span>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "18px", fontWeight: 700, color: "var(--accent-emerald)" }}>
                  {state.score}
                </div>
              </div>
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

        {status === "LOST" && (
          <div className="canvas-overlay" style={{ borderRadius: "var(--radius-lg)" }}>
            <h3 className="overlay-title gameover">Game Over</h3>
            <p className="overlay-subtitle">{resultMessage}</p>
            <button className="btn-primary" onClick={resetGame}>
              🔄 Try Again (<kbd style={{ fontFamily: "var(--font-mono)", fontSize: "11px" }}>Space</kbd>)
            </button>
          </div>
        )}
      </div>

      {/* Mobile Touch / Mouse Controls */}
      <div className="mobile-controls" aria-label="Directional controls">
        <button
          className="ctrl-btn up"
          onClick={() => handleMove("UP")}
          aria-label="Slide Up"
        >
          ▲
        </button>
        <button
          className="ctrl-btn left"
          onClick={() => handleMove("LEFT")}
          aria-label="Slide Left"
        >
          ◀
        </button>
        <button
          className="ctrl-btn down"
          onClick={() => handleMove("DOWN")}
          aria-label="Slide Down"
        >
          ▼
        </button>
        <button
          className="ctrl-btn right"
          onClick={() => handleMove("RIGHT")}
          aria-label="Slide Right"
        >
          ▶
        </button>
      </div>

      {/* Focus & Shortcuts Bar */}
      <div className="controls-bar" style={{ marginTop: "4px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span>Swipe,</span>
          <span className="keycap">W A S D</span>
          <span>or</span>
          <span className="keycap">Arrows</span>
        </div>

        <button
          type="button"
          className={`action-pill-btn ${isFocusMode ? "active" : ""}`}
          onClick={onToggleFocus}
          title="Focus / Pop-up mode"
        >
          <span>{isFocusMode ? "✕ Exit Focus" : "🎯 Focus Mode"}</span>
          <span className="keycap" style={{ fontSize: "10px" }}>F</span>
        </button>
      </div>
    </div>
  );
};
