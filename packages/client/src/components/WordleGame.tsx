import React, { useState, useEffect, useRef, useCallback } from "react";
import confetti from "canvas-confetti";
import {
  WordleGameEngine,
  WordleState,
  TimestampedInput,
} from "@daily-speedruns/shared";
import { formatTimeMs } from "../lib/storage.js";

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

type GameStatus = "IDLE" | "PLAYING" | "WON" | "LOST" | "SUBMITTING";

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

  const [state, setState] = useState<WordleState>(() => engineRef.current.init(seed));
  const [currentGuess, setCurrentGuess] = useState<string>("");
  const [status, setStatus] = useState<GameStatus>("IDLE");
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [resultMessage, setResultMessage] = useState<string>("");
  const [lastVerifiedRank, setLastVerifiedRank] = useState<number | null>(null);
  const [shakeRow, setShakeRow] = useState<boolean>(false);
  const [notice, setNotice] = useState<string | null>(null);

  const startTimeRef = useRef<number>(0);
  const inputsRef = useRef<TimestampedInput<string>[]>([]);
  const statusRef = useRef<GameStatus>("IDLE");
  statusRef.current = status;

  // Reset or initialize new run
  const resetGame = useCallback(() => {
    const freshState = engineRef.current.init(seed);
    setState(freshState);
    setCurrentGuess("");
    setStatus("IDLE");
    setElapsedMs(0);
    setResultMessage("");
    setLastVerifiedRank(null);
    setNotice(null);
    setShakeRow(false);
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

  // Flash temporary validation notice
  const showNotice = (msg: string) => {
    setNotice(msg);
    setShakeRow(true);
    setTimeout(() => setShakeRow(false), 500);
    setTimeout(() => setNotice(null), 1800);
  };

  // Submit current 5-letter guess
  const handleSubmitGuess = useCallback(() => {
    if (statusRef.current === "WON" || statusRef.current === "LOST" || statusRef.current === "SUBMITTING") {
      return;
    }

    if (currentGuess.length !== 5) {
      showNotice("Not enough letters");
      return;
    }

    const timeElapsed = Math.round(performance.now() - startTimeRef.current);
    const stepRes = engineRef.current.step(state, currentGuess);

    if (stepRes.error) {
      showNotice(stepRes.error);
      return;
    }

    // Record verified input guess with timestamp
    inputsRef.current.push({
      t: Math.max(0, timeElapsed),
      action: currentGuess,
    });

    setState(stepRes.state);
    setCurrentGuess("");

    if (stepRes.win) {
      setStatus("SUBMITTING");
      const claimedTime = timeElapsed;
      setElapsedMs(claimedTime);

      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
        colors: ["#10b981", "#6366f1", "#f59e0b"],
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
            setResultMessage(res.error || "Replay verification failed");
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
      setResultMessage(`Word was: ${stepRes.state.targetWord}`);
    }
  }, [currentGuess, state, onRunFinished]);

  // Handle typing letters
  const handleLetter = useCallback(
    (char: string) => {
      if (statusRef.current === "WON" || statusRef.current === "LOST" || statusRef.current === "SUBMITTING") {
        return;
      }

      // Start run on first keystroke
      if (statusRef.current === "IDLE") {
        startTimeRef.current = performance.now();
        setStatus("PLAYING");
      }

      if (currentGuess.length < 5) {
        setCurrentGuess((prev) => prev + char.toUpperCase());
      }
    },
    [currentGuess]
  );

  // Handle backspace
  const handleBackspace = useCallback(() => {
    if (statusRef.current === "WON" || statusRef.current === "LOST" || statusRef.current === "SUBMITTING") {
      return;
    }
    setCurrentGuess((prev) => prev.slice(0, -1));
  }, []);

  // Physical keyboard listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;

      // Single-button restart on Space / Enter when game is over
      if (e.code === "Space" || e.code === "Enter") {
        if (statusRef.current === "WON" || statusRef.current === "LOST") {
          e.preventDefault();
          resetGame();
          return;
        }
      }

      if (e.code === "KeyR" && (statusRef.current === "WON" || statusRef.current === "LOST")) {
        resetGame();
        return;
      }

      // Toggle focus mode
      if (e.code === "KeyF") {
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
  }, [handleBackspace, handleLetter, handleSubmitGuess, onToggleFocus, resetGame]);

  return (
    <div className="game-card wordle-card">
      {/* Game HUD Bar */}
      <div className="game-hud">
        <div className="hud-stat">
          <span className="hud-label">Attempts</span>
          <span className="hud-value highlight">
            {state.guesses.length} / {state.maxGuesses}
          </span>
        </div>

        <div className="hud-stat" style={{ textAlign: "right" }}>
          <span className="hud-label">Stopwatch</span>
          <span className="hud-value timer">{formatTimeMs(elapsedMs)}</span>
        </div>
      </div>

      {/* Notice Toast */}
      {notice && (
        <div
          style={{
            textAlign: "center",
            padding: "6px 14px",
            background: "var(--accent-rose-light)",
            border: "1px solid var(--accent-rose)",
            color: "var(--accent-rose)",
            borderRadius: "var(--radius-sm)",
            fontSize: "13px",
            fontWeight: 700,
          }}
        >
          {notice}
        </div>
      )}

      {/* 6x5 Grid */}
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
              className={`wordle-row ${isCurrentRow && shakeRow ? "shake" : ""}`}
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

      {/* Overlays on Win / Loss */}
      {status === "WON" && (
        <div className="canvas-overlay" style={{ borderRadius: "var(--radius-lg)" }}>
          <h3 className="overlay-title win">Solved!</h3>
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

      {status === "LOST" && (
        <div className="canvas-overlay" style={{ borderRadius: "var(--radius-lg)" }}>
          <h3 className="overlay-title gameover">Unsolved</h3>
          <p className="overlay-subtitle">{resultMessage}</p>
          <button className="btn-primary" onClick={resetGame}>
            🔄 Try Again (<kbd style={{ fontFamily: "var(--font-mono)", fontSize: "11px" }}>Space</kbd>)
          </button>
        </div>
      )}

      {/* Virtual Keyboard */}
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

      {/* Focus Toolbar */}
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
          <span>{isFocusMode ? "✕ Exit Focus" : "🎯 Focus Mode"}</span>
          <span className="keycap" style={{ fontSize: "10px" }}>F</span>
        </button>
      </div>
    </div>
  );
};
