import React, { useState, useEffect, useRef, useCallback } from "react";
import confetti from "canvas-confetti";
import {
  WordleGameEngine,
  WordleState,
  TimestampedInput,
} from "@daily-speedruns/shared";
import { formatTimeMs } from "../lib/storage.js";
import { isGameInputLocked } from "../lib/keyboard.js";
import { useGameSession } from "../hooks/useGameSession.js";
import { GameShell } from "./GameShell.js";
import { GameHud } from "./GameHud.js";
import { ResultOverlay } from "./ResultOverlay.js";

interface WordleGameProps {
  seed: string;
  isFocusMode: boolean;
  onToggleFocus: () => void;
  onRunFinished: (
    claimedTimeMs: number,
    inputs: TimestampedInput<string>[]
  ) => Promise<{
    verified: boolean;
    rank?: number | null;
    error?: string;
  }>;
}

const KEYBOARD_ROWS = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["ENTER", "Z", "X", "C", "V", "B", "N", "M", "BACKSPACE"],
];

export const WordleGame: React.FC<WordleGameProps> = ({
  seed,
  isFocusMode,
  onToggleFocus,
  onRunFinished,
}) => {
  const engineRef = useRef(new WordleGameEngine());

  const [state, setState] = useState<WordleState>(() =>
    engineRef.current.init(seed)
  );
  const stateRef = useRef<WordleState>(state);
  const commitState = useCallback((next: WordleState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const [currentGuess, setCurrentGuess] = useState<string>("");
  const currentGuessRef = useRef<string>("");
  const [shakeRow, setShakeRow] = useState<boolean>(false);
  const [notice, setNotice] = useState<string | null>(null);

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
  } = useGameSession<string>({
    onRunFinished,
    winMessage: "Word solved!",
    onWin: () => {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
        colors: ["#10b981", "#6366f1", "#f59e0b"],
      });
    },
  });

  const resetGame = useCallback(() => {
    const freshState = engineRef.current.init(seed);
    stateRef.current = freshState;
    setState(freshState);
    currentGuessRef.current = "";
    setCurrentGuess("");
    setNotice(null);
    setShakeRow(false);
    resetSession();
  }, [seed, resetSession]);

  useEffect(() => {
    resetGame();
  }, [resetGame]);

  const showNotice = useCallback((msg: string) => {
    setNotice(msg);
    setShakeRow(true);
    window.setTimeout(() => setShakeRow(false), 500);
    window.setTimeout(() => setNotice(null), 1800);
  }, []);

  const handleSubmitGuess = useCallback(() => {
    const currentStatus = statusRef.current;
    if (
      currentStatus === "WON" ||
      currentStatus === "LOST" ||
      currentStatus === "SUBMITTING"
    ) {
      return;
    }

    const guess = currentGuessRef.current;
    if (guess.length !== 5) {
      showNotice("Not enough letters");
      return;
    }

    const stepRes = engineRef.current.step(stateRef.current, guess);
    if (stepRes.error) {
      showNotice(stepRes.error);
      return;
    }

    const t = Math.max(1, now());
    record(guess, t);
    commitState(stepRes.state);
    currentGuessRef.current = "";
    setCurrentGuess("");

    if (stepRes.win) {
      submit(t);
      return;
    }

    if (stepRes.gameOver) {
      fail(`Word was: ${stepRes.state.targetWord}`);
    }
  }, [now, record, commitState, submit, fail, showNotice, statusRef]);

  const handleLetter = useCallback(
    (char: string) => {
      if (isGameInputLocked()) return;
      const currentStatus = statusRef.current;
      if (
        currentStatus === "WON" ||
        currentStatus === "LOST" ||
        currentStatus === "SUBMITTING"
      ) {
        return;
      }

      begin();

      if (currentGuessRef.current.length >= 5) return;
      const next = currentGuessRef.current + char.toUpperCase();
      currentGuessRef.current = next;
      setCurrentGuess(next);
    },
    [begin, statusRef]
  );

  const handleBackspace = useCallback(() => {
    const currentStatus = statusRef.current;
    if (
      currentStatus === "WON" ||
      currentStatus === "LOST" ||
      currentStatus === "SUBMITTING"
    ) {
      return;
    }
    const next = currentGuessRef.current.slice(0, -1);
    currentGuessRef.current = next;
    setCurrentGuess(next);
  }, [statusRef]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isGameInputLocked()) return;
      if (e.target instanceof HTMLInputElement) return;

      if (statusRef.current === "WON" || statusRef.current === "LOST") {
        if (e.code === "Space" || e.code === "Enter" || e.code === "KeyR") {
          e.preventDefault();
          resetGame();
          return;
        }
      }

      if (e.code === "F2") {
        e.preventDefault();
        onToggleFocus();
        return;
      }

      if (e.code === "Enter") {
        e.preventDefault();
        handleSubmitGuess();
        return;
      }

      if (e.code === "Backspace") {
        e.preventDefault();
        handleBackspace();
        return;
      }

      if (/^[a-zA-Z]$/.test(e.key)) {
        handleLetter(e.key);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    handleBackspace,
    handleLetter,
    handleSubmitGuess,
    onToggleFocus,
    resetGame,
    statusRef,
  ]);

  return (
    <GameShell className="wordle-card">
      <GameHud
        stats={[
          {
            label: "Attempts",
            value: `${state.guesses.length} / ${state.maxGuesses}`,
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

      {notice && (
        <div className="wordle-notice" role="status">
          {notice}
        </div>
      )}

      <div className="wordle-grid-container">
        {Array.from({ length: 6 }).map((_, rowIndex) => {
          const isCurrentRow = rowIndex === state.guesses.length;
          const isSubmitted = rowIndex < state.guesses.length;
          const rowGuess = isSubmitted
            ? state.guesses[rowIndex]
            : isCurrentRow
              ? currentGuess
              : "";
          const rowEval = isSubmitted ? state.evaluations[rowIndex] : null;

          return (
            <div
              key={rowIndex}
              className={`wordle-row ${
                isCurrentRow && shakeRow ? "shake" : ""
              }`}
            >
              {Array.from({ length: 5 }).map((_, colIndex) => {
                const char = rowGuess[colIndex] || "";
                const evalType = rowEval ? rowEval[colIndex] : null;

                let tileClass = "wordle-tile";
                if (evalType) {
                  tileClass += ` tile-${evalType}`;
                } else if (char) {
                  tileClass += " tile-filled";
                }

                return (
                  <div key={colIndex} className={tileClass}>
                    {char}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {status === "WON" && (
        <ResultOverlay
          variant="win"
          title="Solved!"
          timeMs={elapsedMs}
          rank={rank}
          message={resultMessage}
          onRetry={resetGame}
        />
      )}

      {status === "LOST" && (
        <ResultOverlay
          variant="lost"
          title="Unsolved"
          message={resultMessage}
          onRetry={resetGame}
          retryLabel="Try Again"
        />
      )}

      <div className="wordle-keyboard" aria-label="Virtual Keyboard">
        {KEYBOARD_ROWS.map((row, rIdx) => (
          <div key={rIdx} className="keyboard-row">
            {row.map((key) => {
              const isSpecial = key === "ENTER" || key === "BACKSPACE";
              const keyStatus = state.letterStatuses[key];

              let keyClass = "keyboard-key";
              if (isSpecial) keyClass += " key-wide";
              if (keyStatus) keyClass += ` key-${keyStatus}`;

              return (
                <button
                  key={key}
                  type="button"
                  className={keyClass}
                  onClick={() => {
                    if (key === "ENTER") handleSubmitGuess();
                    else if (key === "BACKSPACE") handleBackspace();
                    else handleLetter(key);
                  }}
                >
                  {key === "BACKSPACE" ? "⌫" : key}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="controls-bar" style={{ marginTop: "4px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span>Type with your keyboard or tap keys</span>
        </div>

        <button
          type="button"
          className={`action-pill-btn ${isFocusMode ? "active" : ""}`}
          onClick={onToggleFocus}
          title="Focus / Pop-up mode"
        >
          <span>{isFocusMode ? "Exit Focus" : "Focus Mode"}</span>
          <span className="keycap" style={{ fontSize: "10px" }}>
            F2
          </span>
        </button>
      </div>
    </GameShell>
  );
};
