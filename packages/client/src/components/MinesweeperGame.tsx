import React, { useState, useEffect, useRef, useCallback } from "react";
import confetti from "canvas-confetti";
import {
  MinesweeperEngine,
  MinesweeperInput,
  MinesweeperState,
  TimestampedInput,
} from "@daily-speedruns/shared";
import { formatTimeMs } from "../lib/storage.js";
import { isGameInputLocked } from "../lib/keyboard.js";
import { useGameSession } from "../hooks/useGameSession.js";
import { GameShell } from "./GameShell.js";
import { GameHud } from "./GameHud.js";
import { ResultOverlay } from "./ResultOverlay.js";

interface MinesweeperGameProps {
  seed: string;
  isFocusMode: boolean;
  onToggleFocus: () => void;
  onRunFinished: (
    claimedTimeMs: number,
    inputs: TimestampedInput<MinesweeperInput>[]
  ) => Promise<{
    verified: boolean;
    rank?: number | null;
    error?: string;
  }>;
}

export const MinesweeperGame: React.FC<MinesweeperGameProps> = ({
  seed,
  isFocusMode,
  onToggleFocus,
  onRunFinished,
}) => {
  const engineRef = useRef(new MinesweeperEngine());

  const [state, setState] = useState<MinesweeperState>(() =>
    engineRef.current.init(seed)
  );
  const stateRef = useRef<MinesweeperState>(state);
  const commitState = useCallback((next: MinesweeperState) => {
    stateRef.current = next;
    setState(next);
  }, []);

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
  } = useGameSession<MinesweeperInput>({
    onRunFinished,
    winMessage: "Board cleared!",
    onWin: () => {
      confetti({
        particleCount: 90,
        spread: 80,
        origin: { y: 0.6 },
        colors: ["#ff4d00", "#f2efe8", "#7ce3a5"],
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

  const isFinished =
    status === "WON" || status === "LOST" || status === "SUBMITTING";

  const handleReveal = useCallback(
    (row: number, col: number) => {
      const currentStatus = statusRef.current;
      if (
        currentStatus === "WON" ||
        currentStatus === "LOST" ||
        currentStatus === "SUBMITTING"
      ) {
        return;
      }

      const stepRes = engineRef.current.step(stateRef.current, { row, col });
      if (!stepRes.changed) return;

      const t = Math.max(1, begin());
      record({ row, col }, t);
      commitState(stepRes.state);

      if (stepRes.win) {
        submit(t);
        return;
      }

      if (stepRes.mineHit) {
        fail("Boom! You detonated a mine. The run is over.");
      }
    },
    [begin, record, commitState, submit, fail, statusRef]
  );

  const handleFlag = useCallback(
    (row: number, col: number) => {
      const currentStatus = statusRef.current;
      if (
        currentStatus === "WON" ||
        currentStatus === "LOST" ||
        currentStatus === "SUBMITTING"
      ) {
        return;
      }

      const stepRes = engineRef.current.step(stateRef.current, {
        row,
        col,
        type: "FLAG",
      });
      if (!stepRes.changed) return;

      // Flags never start the clock; they are just markers.
      const t =
        statusRef.current === "PLAYING" ? Math.max(1, now()) : 0;
      record({ row, col, type: "FLAG" }, t);
      commitState(stepRes.state);
    },
    [now, record, commitState, statusRef]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isGameInputLocked()) return;

      if (statusRef.current === "WON" || statusRef.current === "LOST") {
        if (e.code === "Space" || e.code === "Enter" || e.code === "KeyR") {
          e.preventDefault();
          resetGame();
          return;
        }
      }

      if (e.code === "KeyF" && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        onToggleFocus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [resetGame, onToggleFocus, statusRef]);

  const revealedCount = state.revealedCount;
  const safeTotal = state.safeTotal;
  const progressPercent =
    safeTotal > 0 ? Math.round((revealedCount / safeTotal) * 100) : 0;

  return (
    <GameShell className="minesweeper-card">
      <GameHud
        stats={[
          {
            label: "Flags",
            value: `${state.flagCount} / ${state.mineCount}`,
            tone: "danger",
          },
          {
            label: "Cleared",
            value: `${revealedCount} / ${safeTotal}`,
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
        className="minesweeper-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={safeTotal}
        aria-valuenow={revealedCount}
        aria-label="Safe squares cleared"
      >
        <span
          className="minesweeper-progress-fill"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <div
        className="minesweeper-board-wrapper"
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="minesweeper-grid" role="grid" aria-label="Minesweeper board">
          {state.revealed.map((isRevealed, index) => {
            const row = Math.floor(index / state.cols);
            const col = index % state.cols;
            const isMine = state.mines[index];
            const adjacent = state.adjacent[index];
            const isExploded = state.explodedIndex === index;
            const showMine =
              isMine &&
              (isRevealed ||
                state.status === "LOST" ||
                state.status === "WON");
            const isFlagged = state.flagged[index] && !isRevealed && !showMine;

            let cellClass = "minesweeper-cell";
            if (isRevealed) cellClass += " revealed";
            if (showMine) cellClass += " mine";
            if (isFlagged) cellClass += " flagged";
            if (isExploded) cellClass += " exploded";
            if (isRevealed && !isMine && adjacent > 0) {
              cellClass += ` n${adjacent}`;
            }

            let content = "";
            if (showMine) {
              content = isExploded ? "✹" : "✸";
            } else if (isFlagged) {
              content = "⚑";
            } else if (isRevealed && adjacent > 0) {
              content = String(adjacent);
            }

            const label = showMine
              ? `Mine at row ${row + 1}, column ${col + 1}`
              : isFlagged
                ? `Flag on row ${row + 1}, column ${col + 1}. Right-click to remove it.`
                : isRevealed
                  ? `Row ${row + 1}, column ${col + 1}, ${adjacent} adjacent mines`
                  : `Reveal row ${row + 1}, column ${col + 1}. Right-click to flag.`;

            return (
              <button
                key={index}
                type="button"
                role="gridcell"
                className={cellClass}
                aria-label={label}
                disabled={isFinished || isRevealed}
                onClick={() => handleReveal(row, col)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  handleFlag(row, col);
                }}
              >
                {content}
              </button>
            );
          })}
        </div>

        {status === "WON" && (
          <ResultOverlay
            variant="win"
            title="Board Cleared!"
            timeMs={elapsedMs}
            stats={[
              {
                label: "Cleared",
                value: `${revealedCount} / ${safeTotal}`,
                tone: "success",
              },
              { label: "Clicks", value: state.actionCount },
            ]}
            rank={rank}
            message={resultMessage}
            onRetry={resetGame}
          />
        )}

        {status === "LOST" && (
          <ResultOverlay
            variant="lost"
            title="Mine Detonated"
            message={resultMessage}
            onRetry={resetGame}
            retryLabel="Try Again"
          />
        )}
      </div>

      <div className="controls-bar" style={{ marginTop: "4px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span className="keycap">Left click</span>
          <span>reveal</span>
          <span className="keycap">Right click</span>
          <span>flag</span>
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
