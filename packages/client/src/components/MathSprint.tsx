import React, { useState, useEffect, useRef, useCallback } from "react";
import confetti from "canvas-confetti";
import {
  MathSprintEngine,
  MathState,
  MathInput,
  TimestampedInput,
} from "@daily-speedruns/shared";
import { formatTimeMs } from "../lib/storage.js";
import { isGameInputLocked } from "../lib/keyboard.js";
import { useGameSession } from "../hooks/useGameSession.js";
import { GameShell } from "./GameShell.js";
import { GameHud } from "./GameHud.js";
import { ResultOverlay } from "./ResultOverlay.js";

interface MathSprintProps {
  seed: string;
  isFocusMode: boolean;
  onToggleFocus: () => void;
  onRunFinished: (
    claimedTimeMs: number,
    inputs: TimestampedInput<MathInput>[]
  ) => Promise<{
    verified: boolean;
    rank?: number | null;
    error?: string;
  }>;
}

export const MathSprint: React.FC<MathSprintProps> = ({
  seed,
  isFocusMode,
  onToggleFocus,
  onRunFinished,
}) => {
  const engineRef = useRef(new MathSprintEngine());

  const [state, setState] = useState<MathState>(() =>
    engineRef.current.init(seed)
  );
  const stateRef = useRef<MathState>(state);
  const commitState = useCallback((next: MathState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const [inputValue, setInputValue] = useState<string>("");
  const inputValueRef = useRef<string>("");
  const [isErrorShake, setIsErrorShake] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");

  const inputRef = useRef<HTMLInputElement>(null);

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
  } = useGameSession<MathInput>({
    onRunFinished,
    winMessage: "Sprint verified!",
    onWin: () => {
      confetti({
        particleCount: 85,
        spread: 75,
        origin: { y: 0.6 },
        colors: ["#0284c7", "#10b981", "#f59e0b"],
      });
    },
  });

  const setInput = useCallback((next: string) => {
    inputValueRef.current = next;
    setInputValue(next);
  }, []);

  const resetGame = useCallback(() => {
    const fresh = engineRef.current.init(seed);
    stateRef.current = fresh;
    setState(fresh);
    setInput("");
    setIsErrorShake(false);
    setErrorMessage("");
    resetSession();
    window.setTimeout(() => inputRef.current?.focus(), 50);
  }, [seed, resetSession, setInput]);

  useEffect(() => {
    resetGame();
  }, [resetGame]);

  useEffect(() => {
    if (status === "IDLE" || status === "PLAYING") {
      inputRef.current?.focus();
    }
  }, [status, state.currentIndex]);

  const handleSubmitAnswer = useCallback(
    (e?: React.FormEvent) => {
      if (e) e.preventDefault();

      const currentStatus = statusRef.current;
      if (
        currentStatus === "WON" ||
        currentStatus === "LOST" ||
        currentStatus === "SUBMITTING"
      ) {
        return;
      }

      const trimmed = inputValueRef.current.trim();
      if (!trimmed || isNaN(Number(trimmed))) {
        return;
      }

      const parsedAnswer = parseInt(trimmed, 10);
      const t = Math.max(1, begin());
      const curIndex = stateRef.current.currentIndex;
      const inputAction: MathInput = {
        questionIndex: curIndex,
        answer: parsedAnswer,
      };

      record(inputAction, t);
      const stepRes = engineRef.current.step(stateRef.current, inputAction);
      commitState(stepRes.state);

      if (stepRes.correct) {
        setIsErrorShake(false);
        setErrorMessage("");
        setInput("");

        if (stepRes.win) {
          submit(t);
        }
      } else {
        setIsErrorShake(true);
        setErrorMessage("Incorrect answer — check your math and try again!");
        inputRef.current?.select();
        window.setTimeout(() => setIsErrorShake(false), 500);
      }
    },
    [begin, record, commitState, submit, setInput, statusRef]
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

      if (
        e.code === "KeyF" &&
        e.target !== inputRef.current &&
        !(e.target instanceof HTMLInputElement)
      ) {
        e.preventDefault();
        onToggleFocus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [resetGame, onToggleFocus, statusRef]);

  const handleNumpad = (char: string) => {
    if (char === "ENTER") {
      handleSubmitAnswer();
    } else if (char === "BACK") {
      setInput(inputValueRef.current.slice(0, -1));
    } else if (char === "-") {
      setInput(
        inputValueRef.current.startsWith("-")
          ? inputValueRef.current.slice(1)
          : `-${inputValueRef.current}`
      );
    } else {
      setInput(inputValueRef.current + char);
    }
    inputRef.current?.focus();
  };

  const currentQ = state.questions[state.currentIndex];

  return (
    <GameShell className="math-card">
      <GameHud
        stats={[
          {
            label: "Progress",
            value: `${Math.min(state.currentIndex + 1, 10)} / 10`,
            tone: "highlight",
          },
          {
            label: "Mistakes",
            value: state.mistakes,
            align: "center",
            tone: state.mistakes > 0 ? "danger" : "default",
          },
          {
            label: "Stopwatch",
            value: formatTimeMs(elapsedMs),
            align: "right",
            tone: "timer",
          },
        ]}
      />

      <div className="math-progress-pills" aria-label="Questions progress">
        {state.questions.map((_, idx) => {
          let pillClass = "math-pill pending";
          if (idx < state.currentIndex) {
            pillClass = "math-pill completed";
          } else if (idx === state.currentIndex) {
            pillClass = "math-pill active";
          }
          return (
            <div key={idx} className={pillClass} title={`Question ${idx + 1}`}>
              {idx < state.currentIndex ? "✓" : idx + 1}
            </div>
          );
        })}
      </div>

      <div className="math-stage-wrapper">
        {currentQ ? (
          <div className="math-question-box">
            <div className="math-category-badge">{currentQ.category}</div>
            <div className="math-prompt-text">{currentQ.prompt}</div>

            <form onSubmit={handleSubmitAnswer} className="math-input-form">
              <div
                className={`math-input-wrapper ${
                  isErrorShake ? "input-shake-error" : ""
                }`}
              >
                <input
                  ref={inputRef}
                  type="text"
                  inputMode="numeric"
                  className="math-input"
                  placeholder="Answer"
                  value={inputValue}
                  onChange={(e) => {
                    setInput(e.target.value);
                    if (errorMessage) setErrorMessage("");
                  }}
                  autoFocus
                  disabled={
                    status === "WON" ||
                    status === "LOST" ||
                    status === "SUBMITTING"
                  }
                />

                <button
                  type="submit"
                  className="math-submit-btn"
                  disabled={!inputValue.trim()}
                  aria-label="Submit answer"
                >
                  ↵ Enter
                </button>
              </div>

              {errorMessage && (
                <div className="math-mistake-feedback" role="alert">
                  <span>⚠️</span>
                  <span>{errorMessage}</span>
                </div>
              )}
            </form>
          </div>
        ) : null}

        {status === "WON" && (
          <ResultOverlay
            variant="win"
            title="Sprint Completed!"
            timeMs={elapsedMs}
            stats={[
              {
                label: "Mistakes",
                value: state.mistakes,
                tone: state.mistakes === 0 ? "success" : "warning",
              },
              {
                label: "Accuracy",
                value: `${Math.round(
                  (10 / Math.max(1, 10 + state.mistakes)) * 100
                )}%`,
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
            title="Submission Error"
            message={resultMessage}
            onRetry={resetGame}
            retryLabel="Try Again"
          />
        )}
      </div>

      <div className="math-numpad" aria-label="Numeric keypad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "-", "0", "BACK"].map(
          (k) => (
            <button
              key={k}
              type="button"
              className="math-numpad-btn"
              onClick={() => handleNumpad(k)}
            >
              {k === "BACK" ? "⌫" : k}
            </button>
          )
        )}
      </div>

      <div className="controls-bar" style={{ marginTop: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span>Type number & press</span>
          <span className="keycap">Enter</span>
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
