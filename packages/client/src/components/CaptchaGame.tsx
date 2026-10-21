import React, { useState, useEffect, useRef, useCallback } from "react";
import confetti from "canvas-confetti";
import {
  CaptchaEngine,
  CaptchaState,
  CaptchaAction,
  TimestampedInput,
} from "@daily-speedruns/shared";
import { formatTimeMs } from "../lib/storage.js";
import { isGameInputLocked } from "../lib/keyboard.js";
import { useGameSession } from "../hooks/useGameSession.js";
import { GameShell } from "./GameShell.js";
import { ResultOverlay } from "./ResultOverlay.js";

interface CaptchaGameProps {
  seed: string;
  isFocusMode: boolean;
  onToggleFocus: () => void;
  onRunFinished: (
    claimedTimeMs: number,
    inputs: TimestampedInput<CaptchaAction>[]
  ) => Promise<{
    verified: boolean;
    rank?: number | null;
    error?: string;
  }>;
}

export const CaptchaGame: React.FC<CaptchaGameProps> = ({
  seed,
  isFocusMode,
  onToggleFocus,
  onRunFinished,
}) => {
  const engineRef = useRef(new CaptchaEngine());

  const [state, setState] = useState<CaptchaState>(() =>
    engineRef.current.init(seed)
  );
  const stateRef = useRef<CaptchaState>(state);
  const commitState = useCallback((next: CaptchaState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const [errorMessage, setErrorMessage] = useState<string>("");
  const [isShake, setIsShake] = useState<boolean>(false);

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
  } = useGameSession<CaptchaAction>({
    onRunFinished,
    winMessage: "Human verified!",
    onWin: () => {
      confetti({
        particleCount: 90,
        spread: 80,
        origin: { y: 0.6 },
        colors: ["#1a73e8", "#10b981", "#f59e0b"],
      });
    },
  });

  const resetGame = useCallback(() => {
    const fresh = engineRef.current.init(seed);
    stateRef.current = fresh;
    setState(fresh);
    setErrorMessage("");
    setIsShake(false);
    resetSession();
  }, [seed, resetSession]);

  useEffect(() => {
    resetGame();
  }, [resetGame]);

  const handleToggleTile = useCallback(
    (index: number) => {
      const currentStatus = statusRef.current;
      if (
        currentStatus === "WON" ||
        currentStatus === "LOST" ||
        currentStatus === "SUBMITTING"
      ) {
        return;
      }

      const t = begin();
      const action: CaptchaAction = { type: "TOGGLE", index };
      record(action, t);

      const stepRes = engineRef.current.step(stateRef.current, action);
      commitState(stepRes.state);
      if (errorMessage) setErrorMessage("");
    },
    [begin, record, commitState, errorMessage, statusRef]
  );

  const handleVerify = useCallback(() => {
    const currentStatus = statusRef.current;
    if (
      currentStatus === "WON" ||
      currentStatus === "LOST" ||
      currentStatus === "SUBMITTING"
    ) {
      return;
    }

    const t = Math.max(1, begin());
    const action: CaptchaAction = { type: "VERIFY" };
    record(action, t);

    const stepRes = engineRef.current.step(stateRef.current, action);
    commitState(stepRes.state);

    if (stepRes.win) {
      submit(t);
      return;
    }

    setIsShake(true);
    const current = stateRef.current;
    setErrorMessage(
      current.challenge.mode === "dynamic" && current.selectedIndices.length > 0
        ? "Clear the incorrectly selected images, then verify again."
        : "Please select all matching images."
    );
    setTimeout(() => setIsShake(false), 500);
  }, [begin, record, commitState, submit, statusRef]);

  // Keyboard controls: 1-9 toggle tiles, Enter verifies, F focus mode.
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
        return;
      }

      if (e.code === "Enter" || e.code === "NumpadEnter") {
        e.preventDefault();
        handleVerify();
        return;
      }

      const num = parseInt(e.key, 10);
      if (!isNaN(num) && num >= 1 && num <= 9) {
        e.preventDefault();
        handleToggleTile(num - 1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    handleToggleTile,
    handleVerify,
    resetGame,
    onToggleFocus,
    statusRef,
  ]);

  const { challenge, selectedIndices } = state;
  const targetCount = challenge.targetIndices.length;

  return (
    <GameShell className="captcha-card arena-captcha">
      <div className="arena-runbar">
        <div className="arena-run-timer-block">
          <span className="arena-run-label">Run time</span>
          <span className="arena-run-timer">{formatTimeMs(elapsedMs)}</span>
        </div>

        <div className={`arena-run-status ${status === "PLAYING" ? "live" : ""}`}>
          <i />
          <span>
            {status === "IDLE"
              ? "Ready"
              : status === "PLAYING"
                ? "Live run"
                : status === "SUBMITTING"
                  ? "Verifying"
                  : status === "WON"
                    ? "Verified"
                    : "Stopped"}
          </span>
        </div>

        <div className="arena-run-stats">
          <div>
            <span>Target</span>
            <strong>{targetCount}</strong>
          </div>
          <div>
            <span>Mistakes</span>
            <strong className={state.mistakes > 0 ? "bad" : ""}>
              {state.mistakes}
            </strong>
          </div>
          <div>
            <span>Mode</span>
            <strong>{challenge.mode}</strong>
          </div>
        </div>
      </div>

      <div className="arena-stage">
        <div className="arena-stage-head">
          <span>Challenge feed</span>
          <span>
            {challenge.gridSize}×{challenge.gridSize} /{" "}
            {challenge.categoryDisplayName}
          </span>
        </div>

        {/* Authentic reCAPTCHA Box */}
        <div className={`recaptcha-box ${isShake ? "recaptcha-shake" : ""}`}>
          <div className="recaptcha-header">
          <div className="recaptcha-header-text">
            <span className="recaptcha-header-label">{challenge.promptPrefix}</span>
            <strong className="recaptcha-header-target">
              {challenge.categoryDisplayName}
            </strong>
            <span className="recaptcha-header-sub">
              {challenge.mode === "dynamic"
                ? state.remainingTargets === 0
                  ? "All matches found — click verify."
                  : "Matches refresh when clicked. Verify once there are none left."
                : "Select every match, then click verify."}
            </span>
            <span className="recaptcha-mode-pill">
              {challenge.gridSize}×{challenge.gridSize} ·{" "}
              {challenge.mode === "dynamic" ? "dynamic" : "static"}
            </span>
          </div>

          <div
            className="recaptcha-sample-box"
            title={`Sample of ${challenge.categoryDisplayName}`}
          >
            <img
              src={challenge.sampleImageSrc}
              alt={`Sample ${challenge.categoryDisplayName}`}
              className="recaptcha-sample-img"
            />
          </div>
        </div>

        <div className="recaptcha-grid" role="grid" aria-label="Captcha 3x3 image grid">
          {challenge.tiles.map((tile) => {
            const isSelected = selectedIndices.includes(tile.index);
            return (
              <div
                key={tile.id}
                role="gridcell"
                aria-selected={isSelected}
                tabIndex={0}
                className={`recaptcha-tile ${isSelected ? "selected" : ""} ${
                  tile.replaced ? "replaced" : ""
                }`}
                onClick={() => handleToggleTile(tile.index)}
                onKeyDown={(e) => {
                  if (e.key === " " || e.key === "Enter") {
                    e.preventDefault();
                    handleToggleTile(tile.index);
                  }
                }}
              >
                <img
                  src={tile.imageSrc}
                  alt={tile.alt}
                  className="recaptcha-tile-img"
                  loading="eager"
                />

                <span className="recaptcha-num-badge">{tile.index + 1}</span>

                {isSelected && (
                  <div className="recaptcha-check-badge">
                    <svg
                      viewBox="0 0 24 24"
                      width="16"
                      height="16"
                      fill="none"
                      stroke="#ffffff"
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {errorMessage && (
          <div className="recaptcha-error-banner" role="alert">
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="recaptcha-footer">
          <div className="recaptcha-footer-icons">
            <button
              type="button"
              className="recaptcha-icon-btn"
              onClick={resetGame}
              title="Restart this challenge"
              aria-label="Restart challenge"
            >
              ↺
            </button>
            <button
              type="button"
              className="recaptcha-icon-btn"
              onClick={() =>
                alert("Click all tiles that contain the target object, then click Verify!")
              }
              title="Help and instructions"
              aria-label="Help and instructions"
            >
              ?
            </button>
          </div>

          <button
            type="button"
            className="recaptcha-verify-btn"
            onClick={handleVerify}
            disabled={status === "SUBMITTING"}
          >
            {status === "SUBMITTING" ? "Verifying..." : "VERIFY"}
          </button>
        </div>

        {status === "WON" && (
          <ResultOverlay
            variant="win"
            title="Human Verified!"
            timeMs={elapsedMs}
            stats={[
              {
                label: "Mistakes",
                value: state.mistakes,
                tone: state.mistakes === 0 ? "success" : "warning",
              },
              {
                label: "Target Tiles",
                value: `${targetCount} / ${challenge.tiles.length}`,
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
            title="Verification Failed"
            message={resultMessage}
            onRetry={resetGame}
            retryLabel="Try Again"
          />
        )}
        </div>
      </div>

      <div className="arena-kbdhints">
        <div>
          <span className="keycap">1–9</span> select
          <span className="keycap">Enter</span> verify
        </div>

        <button
          type="button"
          className={`arena-focus-btn ${isFocusMode ? "active" : ""}`}
          onClick={onToggleFocus}
          title="Focus / Pop-up mode"
        >
          {isFocusMode ? "Exit focus" : "Focus mode"}
          <span className="keycap">F</span>
        </button>
      </div>
    </GameShell>
  );
};
