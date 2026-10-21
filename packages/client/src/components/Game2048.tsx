import React, { useState, useEffect, useRef, useCallback } from "react";
import confetti from "canvas-confetti";
import {
  Game2048Engine,
  Game2048State,
  MoveDirection,
  TimestampedInput,
} from "@daily-speedruns/shared";
import { formatTimeMs } from "../lib/storage.js";
import { isGameInputLocked } from "../lib/keyboard.js";
import { useGameSession } from "../hooks/useGameSession.js";
import { GameShell } from "./GameShell.js";
import { GameHud } from "./GameHud.js";
import { ResultOverlay } from "./ResultOverlay.js";

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

export const Game2048: React.FC<Game2048Props> = ({
  seed,
  isFocusMode,
  onToggleFocus,
  onRunFinished,
}) => {
  const engineRef = useRef(new Game2048Engine());

  const [state, setState] = useState<Game2048State>(() =>
    engineRef.current.init(seed)
  );
  const stateRef = useRef<Game2048State>(state);
  const commitState = useCallback((next: Game2048State) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const {
    status,
    statusRef,
    elapsedMs,
    resultMessage,
    rank,
    begin,
    record,
    submit,
    fail,
    reset: resetSession,
  } = useGameSession<MoveDirection>({
    onRunFinished,
    winMessage: "512 reached!",
    onWin: () => {
      confetti({
        particleCount: 85,
        spread: 75,
        origin: { y: 0.6 },
        colors: ["#eab308", "#f59e0b", "#10b981"],
      });
    },
  });

  const resetGame = useCallback(() => {
    const fresh = engineRef.current.init(seed);
    stateRef.current = fresh;
    setState(fresh);
    resetSession();
  }, [seed, resetSession]);

  useEffect(() => {
    resetGame();
  }, [resetGame]);

  const handleMove = useCallback(
    (direction: MoveDirection) => {
      const currentStatus = statusRef.current;
      if (
        currentStatus === "WON" ||
        currentStatus === "LOST" ||
        currentStatus === "SUBMITTING"
      ) {
        return;
      }

      const stepRes = engineRef.current.step(stateRef.current, direction);
      if (!stepRes.changed) return;

      const t = Math.max(1, begin());
      record(direction, t);
      commitState(stepRes.state);

      if (stepRes.win) {
        submit(t);
        return;
      }

      if (stepRes.gameOver) {
        fail(`No moves left! Max tile: ${stepRes.state.maxTile}`);
      }
    },
    [begin, record, commitState, submit, fail, statusRef]
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

      if (statusRef.current === "WON" || statusRef.current === "LOST") {
        if (e.code === "Space" || e.code === "Enter" || e.code === "KeyR") {
          resetGame();
          return;
        }
      }

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
  }, [handleMove, resetGame, onToggleFocus, statusRef]);

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
    if (
      Math.abs(deltaX) < minSwipeDistance &&
      Math.abs(deltaY) < minSwipeDistance
    ) {
      return;
    }

    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      handleMove(deltaX > 0 ? "RIGHT" : "LEFT");
    } else {
      handleMove(deltaY > 0 ? "DOWN" : "UP");
    }
  };

  return (
    <GameShell
      className="game2048-card"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <GameHud
        stats={[
          {
            label: "Max Tile",
            value: `${state.maxTile} / ${state.targetTile}`,
            tone: "highlight",
          },
          {
            label: "Score",
            value: state.score.toLocaleString(),
            align: "center",
          },
          {
            label: "Stopwatch",
            value: formatTimeMs(elapsedMs),
            align: "right",
            tone: "timer",
          },
        ]}
      />

      <div className="game2048-board-wrapper">
        <div className="game2048-grid">
          {state.grid.map((row, rIdx) =>
            row.map((cellValue, cIdx) => {
              const tileClass =
                cellValue > 0 ? `tile-${cellValue}` : "tile-empty";
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

        {status === "WON" && (
          <ResultOverlay
            variant="win"
            title="512 Reached!"
            timeMs={elapsedMs}
            stats={[
              { label: "Moves", value: state.moveCount },
              {
                label: "Final Score",
                value: state.score,
                tone: "success",
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
            title="Game Over"
            message={resultMessage}
            onRetry={resetGame}
            retryLabel="Try Again"
          />
        )}
      </div>

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
          <span>{isFocusMode ? "Exit Focus" : "Focus Mode"}</span>
          <span className="keycap" style={{ fontSize: "10px" }}>
            F
          </span>
        </button>
      </div>
    </GameShell>
  );
};
