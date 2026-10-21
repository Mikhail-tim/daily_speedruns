import React, { useState, useEffect, useRef, useCallback } from "react";
import confetti from "canvas-confetti";
import {
  TypingGameEngine,
  TypingState,
  TimestampedInput,
} from "@daily-speedruns/shared";
import { formatTimeMs } from "../lib/storage.js";

interface TypingGameProps {
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

type GameStatus = "IDLE" | "PLAYING" | "WON" | "SUBMITTING";

export const TypingGame: React.FC<TypingGameProps> = ({
  seed,
  isFocusMode,
  onToggleFocus,
  onRunFinished,
}) => {
  const engineRef = useRef(new TypingGameEngine());
  const inputAreaRef = useRef<HTMLInputElement | null>(null);

  const [state, setState] = useState<TypingState>(() => engineRef.current.init(seed));
  const [status, setStatus] = useState<GameStatus>("IDLE");
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [liveWpm, setLiveWpm] = useState<number>(0);
  const [liveAccuracy, setLiveAccuracy] = useState<number>(100);
  const [resultMessage, setResultMessage] = useState<string>("");
  const [lastVerifiedRank, setLastVerifiedRank] = useState<number | null>(null);
  const [summaryData, setSummaryData] = useState<{ wpm: number; accuracy: number } | null>(null);

  const startTimeRef = useRef<number>(0);
  const inputsRef = useRef<TimestampedInput<string>[]>([]);
  const statusRef = useRef<GameStatus>("IDLE");
  statusRef.current = status;

  // Reset or start fresh run
  const resetGame = useCallback(() => {
    const fresh = engineRef.current.init(seed);
    setState(fresh);
    setStatus("IDLE");
    setElapsedMs(0);
    setLiveWpm(0);
    setLiveAccuracy(100);
    setResultMessage("");
    setLastVerifiedRank(null);
    setSummaryData(null);
    startTimeRef.current = 0;
    inputsRef.current = [];
    if (inputAreaRef.current) {
      inputAreaRef.current.focus();
    }
  }, [seed]);

  useEffect(() => {
    resetGame();
  }, [resetGame]);

  // Live stopwatch and live WPM/Accuracy meter
  useEffect(() => {
    if (status !== "PLAYING") return;

    let animId: number;
    const updateStats = () => {
      if (statusRef.current === "PLAYING") {
        const now = performance.now();
        const elapsed = Math.round(now - startTimeRef.current);
        setElapsedMs(elapsed);

        if (elapsed > 500) {
          const minutes = elapsed / 60000;
          const wordsTyped = state.typedBuffer.length / 5;
          const currentWpm = Math.round(wordsTyped / minutes);
          setLiveWpm(Math.max(0, currentWpm));

          if (state.totalKeystrokes > 0) {
            const acc = Math.max(
              0,
              Math.min(
                100,
                Math.round(
                  ((state.totalKeystrokes - state.errorCount) / state.totalKeystrokes) *
                    100
                )
              )
            );
            setLiveAccuracy(acc);
          }
        }

        animId = requestAnimationFrame(updateStats);
      }
    };

    animId = requestAnimationFrame(updateStats);
    return () => cancelAnimationFrame(animId);
  }, [status, state.typedBuffer.length, state.totalKeystrokes, state.errorCount]);

  // Process a keystroke
  const handleKeystroke = useCallback(
    (action: string) => {
      if (statusRef.current === "WON" || statusRef.current === "SUBMITTING") {
        return;
      }

      // Start run on first keystroke
      if (statusRef.current === "IDLE") {
        startTimeRef.current = performance.now();
        setStatus("PLAYING");
      }

      const timeElapsed = Math.round(performance.now() - startTimeRef.current);
      inputsRef.current.push({
        t: Math.max(0, timeElapsed),
        action,
      });

      const stepRes = engineRef.current.step(state, action);
      setState(stepRes.state);

      if (stepRes.win) {
        setStatus("SUBMITTING");
        const claimedTime = timeElapsed;
        setElapsedMs(claimedTime);

        // Calculate final stats
        const minutes = claimedTime / 60000;
        const wpm = Math.round(stepRes.state.targetText.length / 5 / minutes);
        const accuracy = Math.max(
          0,
          Math.min(
            100,
            Math.round(
              ((stepRes.state.targetText.length - stepRes.state.errorCount) /
                Math.max(stepRes.state.targetText.length, stepRes.state.totalKeystrokes)) *
                100
            )
          )
        );

        setSummaryData({ wpm, accuracy });

        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 },
          colors: ["#059669", "#0284c7", "#f59e0b"],
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
              setStatus("IDLE");
              setResultMessage(res.error || "Anti-cheat rejected run");
            }
          })
          .catch((err) => {
            setStatus("IDLE");
            setResultMessage(err.message || "Network error");
          });
      }
    },
    [state, onRunFinished]
  );

  // Keyboard event listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Single button restart on Space / Enter when won
      if (statusRef.current === "WON") {
        if (e.code === "Space" || e.code === "Enter" || e.code === "KeyR") {
          e.preventDefault();
          resetGame();
          return;
        }
      }

      // Focus mode toggle
      if (e.code === "KeyF" && !(e.target instanceof HTMLInputElement)) {
        onToggleFocus();
        return;
      }

      if (e.code === "Escape" && isFocusMode) {
        onToggleFocus();
        return;
      }

      if (statusRef.current === "WON" || statusRef.current === "SUBMITTING") {
        return;
      }

      if (e.key === "Backspace") {
        e.preventDefault();
        handleKeystroke("BACKSPACE");
        return;
      }

      // Printable single characters
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        handleKeystroke(e.key);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeystroke, resetGame, onToggleFocus, isFocusMode]);

  const targetChars = state.targetText.split("");
  const typedLength = state.typedBuffer.length;
  const progressPercent = Math.min(
    100,
    Math.round((typedLength / state.targetText.length) * 100)
  );

  return (
    <div
      className="game-card typing-card"
      onClick={() => inputAreaRef.current?.focus()}
    >
      {/* Hidden dummy input to catch mobile focus */}
      <input
        ref={inputAreaRef}
        type="text"
        aria-label="Typing Input Area"
        style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 1, height: 1 }}
        autoFocus
      />

      {/* Typing HUD Bar */}
      <div className="game-hud">
        <div className="hud-stat">
          <span className="hud-label">Speed</span>
          <span className="hud-value highlight">
            {liveWpm} <span style={{ fontSize: "13px", fontWeight: 600 }}>WPM</span>
          </span>
        </div>

        <div className="hud-stat" style={{ textAlign: "center" }}>
          <span className="hud-label">Accuracy</span>
          <span className="hud-value" style={{ color: liveAccuracy < 90 ? "var(--accent-rose)" : "var(--accent-emerald)" }}>
            {liveAccuracy}%
          </span>
        </div>

        <div className="hud-stat" style={{ textAlign: "right" }}>
          <span className="hud-label">Stopwatch</span>
          <span className="hud-value timer">{formatTimeMs(elapsedMs)}</span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="typing-progress-track">
        <div
          className="typing-progress-fill"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Paragraph Display Container */}
      <div className="typing-text-container">
        {targetChars.map((char, index) => {
          const isTyped = index < typedLength;
          const isCurrent = index === typedLength;
          let charClass = "type-char";

          if (isTyped) {
            const actualTyped = state.typedBuffer[index];
            charClass += actualTyped === char ? " char-correct" : " char-incorrect";
          } else {
            charClass += " char-pending";
          }

          return (
            <span key={index} className={charClass}>
              {isCurrent && <span className="type-caret" />}
              {char === " " ? "\u00A0" : char}
            </span>
          );
        })}
      </div>

      {/* Result Overlay on Win */}
      {status === "WON" && (
        <div className="canvas-overlay" style={{ borderRadius: "var(--radius-lg)" }}>
          <h3 className="overlay-title win">Sprint Finished!</h3>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "32px",
              color: "var(--accent-sky)",
              fontWeight: 700,
            }}
          >
            {formatTimeMs(elapsedMs)}
          </div>

          {summaryData && (
            <div style={{ display: "flex", gap: "16px", margin: "4px 0" }}>
              <div style={{ textAlign: "center" }}>
                <span style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--text-tertiary)", fontWeight: 700 }}>
                  Speed
                </span>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "20px", fontWeight: 800, color: "var(--accent-emerald)" }}>
                  {summaryData.wpm} WPM
                </div>
              </div>

              <div style={{ textAlign: "center" }}>
                <span style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--text-tertiary)", fontWeight: 700 }}>
                  Accuracy
                </span>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "20px", fontWeight: 800, color: "var(--text-primary)" }}>
                  {summaryData.accuracy}%
                </div>
              </div>
            </div>
          )}

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

      {/* Controls & Focus Toolbar */}
      <div className="controls-bar" style={{ marginTop: "4px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span>Start typing to begin</span>
          <span>•</span>
          <span className="keycap">Backspace</span>
          <span>to correct</span>
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
