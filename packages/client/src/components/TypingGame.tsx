import React, { useState, useEffect, useRef, useCallback } from "react";
import confetti from "canvas-confetti";
import {
  TypingGameEngine,
  TypingState,
  TimestampedInput,
} from "@daily-speedruns/shared";
import { formatTimeMs } from "../lib/storage.js";
import { isGameInputLocked } from "../lib/keyboard.js";
import { useGameSession } from "../hooks/useGameSession.js";
import { GameShell } from "./GameShell.js";
import { GameHud } from "./GameHud.js";
import { ResultOverlay } from "./ResultOverlay.js";

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

export const TypingGame: React.FC<TypingGameProps> = ({
  seed,
  isFocusMode,
  onToggleFocus,
  onRunFinished,
}) => {
  const engineRef = useRef(new TypingGameEngine());
  const inputAreaRef = useRef<HTMLInputElement | null>(null);

  const [state, setState] = useState<TypingState>(() =>
    engineRef.current.init(seed)
  );
  const stateRef = useRef<TypingState>(state);
  const commitState = useCallback((next: TypingState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const [liveWpm, setLiveWpm] = useState<number>(0);
  const [liveAccuracy, setLiveAccuracy] = useState<number>(100);
  const [summaryData, setSummaryData] = useState<{
    wpm: number;
    accuracy: number;
  } | null>(null);

  const {
    status,
    statusRef,
    elapsedMs,
    resultMessage,
    rank,
    begin,
    record,
    submit,
    reset: resetSession,
  } = useGameSession<string>({
    onRunFinished,
    winMessage: "Sprint verified!",
    onWin: () => {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
        colors: ["#059669", "#0284c7", "#f59e0b"],
      });
    },
  });

  const resetGame = useCallback(() => {
    const fresh = engineRef.current.init(seed);
    stateRef.current = fresh;
    setState(fresh);
    setLiveWpm(0);
    setLiveAccuracy(100);
    setSummaryData(null);
    resetSession();
    window.setTimeout(() => inputAreaRef.current?.focus(), 0);
  }, [seed, resetSession]);

  useEffect(() => {
    resetGame();
  }, [resetGame]);

  // Live speed/accuracy meters derived from the shared stopwatch.
  useEffect(() => {
    if (status !== "PLAYING" || elapsedMs < 500) return;

    const minutes = elapsedMs / 60000;
    const wordsTyped = state.typedBuffer.length / 5;
    setLiveWpm(Math.max(0, Math.round(wordsTyped / minutes)));

    if (state.totalKeystrokes > 0) {
      setLiveAccuracy(
        Math.max(
          0,
          Math.min(
            100,
            Math.round(
              ((state.totalKeystrokes - state.errorCount) /
                state.totalKeystrokes) *
                100
            )
          )
        )
      );
    }
  }, [
    status,
    elapsedMs,
    state.typedBuffer.length,
    state.totalKeystrokes,
    state.errorCount,
  ]);

  const handleKeystroke = useCallback(
    (action: string) => {
      const currentStatus = statusRef.current;
      if (
        currentStatus === "WON" ||
        currentStatus === "LOST" ||
        currentStatus === "SUBMITTING"
      ) {
        return;
      }

      const t = begin();
      record(action, t);

      const stepRes = engineRef.current.step(stateRef.current, action);
      commitState(stepRes.state);

      if (stepRes.win) {
        const finalState = stepRes.state;
        const minutes = Math.max(t, 1) / 60000;
        const wpm = Math.round(finalState.targetText.length / 5 / minutes);
        const accuracy = Math.max(
          0,
          Math.min(
            100,
            Math.round(
              ((finalState.targetText.length - finalState.errorCount) /
                Math.max(
                  finalState.targetText.length,
                  finalState.totalKeystrokes
                )) *
                100
            )
          )
        );

        setSummaryData({ wpm, accuracy });
        submit(Math.max(1, t));
      }
    },
    [begin, record, commitState, submit, statusRef]
  );

  // Global keyboard listener (the hidden input keeps mobile focus alive).
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
        onToggleFocus();
        return;
      }

      if (e.code === "Escape" && isFocusMode) {
        onToggleFocus();
        return;
      }

      if (
        statusRef.current === "WON" ||
        statusRef.current === "LOST" ||
        statusRef.current === "SUBMITTING"
      ) {
        return;
      }

      if (e.key === "Backspace") {
        e.preventDefault();
        handleKeystroke("BACKSPACE");
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        handleKeystroke(e.key);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    handleKeystroke,
    resetGame,
    onToggleFocus,
    isFocusMode,
    statusRef,
  ]);

  const targetChars = state.targetText.split("");
  const typedLength = state.typedBuffer.length;
  const progressPercent = Math.min(
    100,
    Math.round((typedLength / state.targetText.length) * 100)
  );

  return (
    <GameShell
      className="typing-card"
      onClick={() => inputAreaRef.current?.focus()}
    >
      <input
        ref={inputAreaRef}
        type="text"
        aria-label="Typing Input Area"
        style={{
          position: "absolute",
          opacity: 0,
          pointerEvents: "none",
          width: 1,
          height: 1,
        }}
        autoFocus
      />

      <GameHud
        stats={[
          {
            label: "Speed",
            value: (
              <>
                {liveWpm}{" "}
                <span style={{ fontSize: "13px", fontWeight: 600 }}>WPM</span>
              </>
            ),
            tone: "highlight",
          },
          {
            label: "Accuracy",
            value: `${liveAccuracy}%`,
            align: "center",
            tone: liveAccuracy < 90 ? "danger" : "default",
          },
          {
            label: "Stopwatch",
            value: formatTimeMs(elapsedMs),
            align: "right",
            tone: "timer",
          },
        ]}
      />

      <div className="typing-progress-track">
        <div
          className="typing-progress-fill"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <div className="typing-text-container">
        {targetChars.map((char, index) => {
          const isTyped = index < typedLength;
          const isCurrent = index === typedLength;
          let charClass = "type-char";

          if (isTyped) {
            const actualTyped = state.typedBuffer[index];
            charClass +=
              actualTyped === char ? " char-correct" : " char-incorrect";
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

      {status === "WON" && (
        <ResultOverlay
          variant="win"
          title="Sprint Finished!"
          timeMs={elapsedMs}
          stats={[
            {
              label: "Speed",
              value: `${summaryData?.wpm ?? 0} WPM`,
              tone: "success",
            },
            {
              label: "Accuracy",
              value: `${summaryData?.accuracy ?? 0}%`,
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
          title="Run Not Verified"
          message={resultMessage}
          onRetry={resetGame}
          retryLabel="Try Again"
        />
      )}

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
          <span>{isFocusMode ? "Exit Focus" : "Focus Mode"}</span>
          <span className="keycap" style={{ fontSize: "10px" }}>
            F
          </span>
        </button>
      </div>
    </GameShell>
  );
};
