import React, { useState, useEffect, useRef, useCallback } from "react";
import confetti from "canvas-confetti";
import {
  InvokerGameEngine,
  InvokerState,
  InvokerAction,
  OrbType,
  SPELL_LIST,
  TimestampedInput,
} from "@daily-speedruns/shared";
import { formatTimeMs } from "../lib/storage.js";
import { isGameInputLocked } from "../lib/keyboard.js";
import { useGameSession } from "../hooks/useGameSession.js";
import { GameShell } from "./GameShell.js";
import { GameHud } from "./GameHud.js";
import { ResultOverlay } from "./ResultOverlay.js";
import {
  QuasIcon,
  WexIcon,
  ExortIcon,
  InvokeIcon,
  SpellIcon,
} from "./invoker-icons.js";
import { invokerAudio } from "../lib/invoker-audio.js";
import "./InvokerGame.css";

interface InvokerGameProps {
  seed: string;
  isFocusMode: boolean;
  onToggleFocus: () => void;
  onRunFinished: (
    claimedTimeMs: number,
    inputs: TimestampedInput<InvokerAction>[]
  ) => Promise<{
    verified: boolean;
    rank?: number | null;
    error?: string;
  }>;
}

export const InvokerGame: React.FC<InvokerGameProps> = ({
  seed,
  isFocusMode,
  onToggleFocus,
  onRunFinished,
}) => {
  const engineRef = useRef(new InvokerGameEngine());

  const [state, setState] = useState<InvokerState>(() =>
    engineRef.current.init(seed)
  );
  const stateRef = useRef<InvokerState>(state);
  const commitState = useCallback((next: InvokerState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const [isErrorShake, setIsErrorShake] = useState<boolean>(false);
  const [showGrimoire, setShowGrimoire] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

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
  } = useGameSession<InvokerAction>({
    onRunFinished,
    winMessage: "Combo Sprint Verified!",
    onWin: () => {
      invokerAudio.playWin();
      confetti({
        particleCount: 110,
        spread: 85,
        origin: { y: 0.6 },
        colors: ["#38bdf8", "#e879f9", "#fb923c", "#fbbf24"],
      });
    },
  });

  const toggleSound = useCallback(() => {
    setSoundEnabled((prev) => {
      const next = !prev;
      invokerAudio.enabled = next;
      return next;
    });
  }, []);

  const resetGame = useCallback(() => {
    const fresh = engineRef.current.init(seed);
    stateRef.current = fresh;
    setState(fresh);
    setIsErrorShake(false);
    resetSession();
  }, [seed, resetSession]);

  useEffect(() => {
    resetGame();
  }, [resetGame]);

  const handleAction = useCallback(
    (action: InvokerAction) => {
      const curStatus = statusRef.current;
      if (
        curStatus === "WON" ||
        curStatus === "LOST" ||
        curStatus === "SUBMITTING"
      ) {
        return;
      }

      const t = Math.max(1, begin());
      record(action, t);

      // Play audio feedback
      if (action.type === "ORB") {
        if (action.orb === "Q") invokerAudio.playQuas();
        else if (action.orb === "W") invokerAudio.playWex();
        else if (action.orb === "E") invokerAudio.playExort();
      } else if (action.type === "INVOKE") {
        invokerAudio.playInvoke();
      }

      const stepRes = engineRef.current.step(stateRef.current, action);
      commitState(stepRes.state);

      if (action.type === "CAST") {
        if (stepRes.castSuccess) {
          invokerAudio.playCastSuccess();
          setIsErrorShake(false);
          if (stepRes.win) {
            submit(t);
          }
        } else {
          invokerAudio.playMistake();
          setIsErrorShake(true);
          window.setTimeout(() => setIsErrorShake(false), 300);
        }
      }
    },
    [begin, record, commitState, submit]
  );

  // Global Keyboard Handler
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isGameInputLocked()) return;
      if (e.repeat) return;

      const key = e.key.toLowerCase();

      // Space or Enter to confirm ready / start
      if (statusRef.current === "IDLE") {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          begin();
          return;
        }
      }

      if (statusRef.current === "PLAYING" || statusRef.current === "IDLE") {
        if (key === "q") {
          e.preventDefault();
          handleAction({ type: "ORB", orb: "Q" });
        } else if (key === "w") {
          e.preventDefault();
          handleAction({ type: "ORB", orb: "W" });
        } else if (key === "e") {
          e.preventDefault();
          handleAction({ type: "ORB", orb: "E" });
        } else if (key === "r") {
          e.preventDefault();
          handleAction({ type: "INVOKE" });
        } else if (key === "d") {
          e.preventDefault();
          handleAction({ type: "CAST", slot: "D" });
        } else if (key === "f") {
          e.preventDefault();
          handleAction({ type: "CAST", slot: "F" });
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [begin, handleAction]);

  const currentTarget = state.sequence[state.targetIndex] ?? null;
  const isTargetInSlotD = currentTarget && state.slotD?.id === currentTarget.id;
  const isTargetInSlotF = currentTarget && state.slotF?.id === currentTarget.id;

  return (
    <GameShell className="invoker-card">
      <GameHud
        stats={[
          {
            label: "Combo",
            value: state.comboName,
            tone: "highlight",
          },
          {
            label: "Progress",
            value: `${state.targetIndex} / ${state.sequence.length}`,
            align: "center",
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

      <div className={`invoker-container ${isErrorShake ? "shake" : ""}`}>
        <div className="invoker-backdrop" />

        {/* Ready Confirmation Overlay */}
        {status === "IDLE" && (
          <div className="invoker-ready-overlay">
            <div className="invoker-ready-card">
              <span className="invoker-badge">Daily Speedrun</span>
              <h2 className="invoker-ready-title">Invoker Combo Sprint</h2>
              <p className="invoker-ready-desc">
                Today&apos;s Challenge: <strong>{state.comboName}</strong>
                <br />
                Assemble your reagents with <code>Q</code>, <code>W</code>, <code>E</code>.
                Invoke with <code>R</code> into slot <code>D</code>/<code>F</code>, then cast to execute the sequence!
              </p>

              <button
                type="button"
                className="invoker-ready-btn"
                onClick={() => begin()}
              >
                <span>⚡ I Am Ready — Start Sprint</span>
              </button>

              <div className="invoker-ready-keys-hint">
                <span>[Q] Quas</span>
                <span>[W] Wex</span>
                <span>[E] Exort</span>
                <span>[R] Invoke</span>
                <span>[D/F] Cast</span>
              </div>
            </div>
          </div>
        )}

        {/* Stage Header */}
        <div className="invoker-header">
          <div className="invoker-title-box">
            <span className="invoker-badge">Combo</span>
            <span className="invoker-combo-name">{state.comboName}</span>
          </div>
          <div className="invoker-stats-rail">
            <div className="invoker-stat-item">
              <span>Progress:</span>
              <span className="invoker-stat-val">
                {state.targetIndex} / {state.sequence.length}
              </span>
            </div>
            {state.mistakes > 0 && (
              <div className="invoker-stat-item">
                <span style={{ color: "#ef4444" }}>Mistakes:</span>
                <span className="invoker-stat-val" style={{ color: "#f87171" }}>
                  {state.mistakes}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Target Combo Rail */}
        <div className="invoker-combo-rail-wrapper">
          <div className="invoker-rail-label">
            <span>Combo String</span>
            <span>{Math.round((state.targetIndex / state.sequence.length) * 100)}%</span>
          </div>
          <div className="invoker-spells-scroll">
            {state.sequence.map((spell, idx) => {
              const isDone = idx < state.targetIndex;
              const isActive = idx === state.targetIndex;
              return (
                <div
                  key={`${spell.id}-${idx}`}
                  className={`invoker-spell-token ${isDone ? "done" : ""} ${
                    isActive ? "active" : ""
                  }`}
                >
                  <span className="invoker-token-idx">#{idx + 1}</span>
                  <SpellIcon id={spell.id} size={22} />
                  <span className="invoker-token-name">{spell.name}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Center Target Arena */}
        <div className="invoker-stage">
          {currentTarget && (
            <div className="invoker-target-card">
              <div className="invoker-target-icon-wrap">
                <SpellIcon id={currentTarget.id} size={72} />
              </div>

              <div className="invoker-target-title">{currentTarget.name}</div>

              <div className="invoker-target-recipe">
                {currentTarget.recipe.map((orb, i) => (
                  <span key={i} className={`invoker-recipe-orb ${orb}`}>
                    {orb}
                  </span>
                ))}
                <span style={{ color: "#64748b", margin: "0 2px" }}>+</span>
                <span
                  className="invoker-recipe-orb"
                  style={{
                    background: "rgba(245, 158, 11, 0.2)",
                    border: "1px solid #fbbf24",
                    color: "#fef08a",
                  }}
                >
                  R
                </span>
              </div>

              {/* Action Coaching Badge */}
              {isTargetInSlotD ? (
                <div className="invoker-action-hint ready-d">
                  ⚡ Ready in Slot D — Press [D]
                </div>
              ) : isTargetInSlotF ? (
                <div className="invoker-action-hint ready-f">
                  ⚡ Ready in Slot F — Press [F]
                </div>
              ) : (
                <div className="invoker-action-hint need-invoke">
                  Invoke with {currentTarget.recipe.join("-")}-R
                </div>
              )}
            </div>
          )}
        </div>

        {/* AUTHENTIC DOTA 2 INVOKER HUD (BOTTOM) */}
        <div className="invoker-hud-wrap">
          {/* Active 3 Spheres */}
          <div className="invoker-spheres-tray">
            {[0, 1, 2].map((idx) => {
              const orb = state.orbs[idx] as OrbType | undefined;
              return (
                <div
                  key={idx}
                  className={`invoker-sphere-slot ${orb ? `has-orb ${orb}` : ""}`}
                >
                  {orb === "Q" && <QuasIcon size={32} />}
                  {orb === "W" && <WexIcon size={32} />}
                  {orb === "E" && <ExortIcon size={32} />}
                </div>
              );
            })}
          </div>

          {/* Abilities Bar */}
          <div className="invoker-ability-console">
            {/* [Q] Quas */}
            <button
              type="button"
              className="invoker-hud-btn quas"
              onClick={() => handleAction({ type: "ORB", orb: "Q" })}
              title="Quas [Q]"
            >
              <QuasIcon size={46} />
              <span className="invoker-keycap">Q</span>
            </button>

            {/* [W] Wex */}
            <button
              type="button"
              className="invoker-hud-btn wex"
              onClick={() => handleAction({ type: "ORB", orb: "W" })}
              title="Wex [W]"
            >
              <WexIcon size={46} />
              <span className="invoker-keycap">W</span>
            </button>

            {/* [E] Exort */}
            <button
              type="button"
              className="invoker-hud-btn exort"
              onClick={() => handleAction({ type: "ORB", orb: "E" })}
              title="Exort [E]"
            >
              <ExortIcon size={46} />
              <span className="invoker-keycap">E</span>
            </button>

            <div className="invoker-ability-sep" />

            {/* [D] Slot 1 */}
            <button
              type="button"
              className={`invoker-hud-btn slot ${
                state.slotD ? "" : "empty-slot"
              } ${isTargetInSlotD ? "highlight" : ""}`}
              onClick={() => handleAction({ type: "CAST", slot: "D" })}
              disabled={!state.slotD}
              title={state.slotD ? `Cast ${state.slotD.name} [D]` : "Slot D (Empty)"}
            >
              {state.slotD ? (
                <>
                  <SpellIcon id={state.slotD.id} size={48} />
                  <span className="invoker-slot-name">{state.slotD.name}</span>
                </>
              ) : (
                <span className="invoker-empty-label">Empty</span>
              )}
              <span className="invoker-keycap">D</span>
            </button>

            {/* [F] Slot 2 */}
            <button
              type="button"
              className={`invoker-hud-btn slot ${
                state.slotF ? "" : "empty-slot"
              } ${isTargetInSlotF ? "highlight" : ""}`}
              onClick={() => handleAction({ type: "CAST", slot: "F" })}
              disabled={!state.slotF}
              title={state.slotF ? `Cast ${state.slotF.name} [F]` : "Slot F (Empty)"}
            >
              {state.slotF ? (
                <>
                  <SpellIcon id={state.slotF.id} size={48} />
                  <span className="invoker-slot-name">{state.slotF.name}</span>
                </>
              ) : (
                <span className="invoker-empty-label">Empty</span>
              )}
              <span className="invoker-keycap">F</span>
            </button>

            <div className="invoker-ability-sep" />

            {/* [R] Invoke */}
            <button
              type="button"
              className="invoker-hud-btn invoke"
              onClick={() => handleAction({ type: "INVOKE" })}
              title="Invoke [R]"
            >
              <InvokeIcon size={46} />
              <span className="invoker-keycap">R</span>
            </button>
          </div>

          {/* Utility Bar */}
          <div className="invoker-utility-bar">
            <button
              type="button"
              className="invoker-util-btn"
              onClick={() => setShowGrimoire(true)}
            >
              📖 Grimoire (All Recipes)
            </button>
            <button
              type="button"
              className="invoker-util-btn"
              onClick={toggleSound}
              title="Toggle sound"
            >
              {soundEnabled ? "🔊 Sound On" : "🔇 Muted"}
            </button>
            <span style={{ fontSize: "0.68rem", color: "#64748b" }}>
              Hotkeys: [Q] [W] [E] [R] [D] [F]
            </span>
          </div>
        </div>

        {/* Grimoire Modal */}
        {showGrimoire && (
          <div
            className="invoker-grimoire-overlay"
            onClick={() => setShowGrimoire(false)}
          >
            <div
              className="invoker-grimoire-box"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="invoker-grimoire-header">
                <span className="invoker-grimoire-title">
                  Archmage&apos;s Grimoire — All 10 Recipes
                </span>
                <button
                  type="button"
                  className="invoker-util-btn"
                  onClick={() => setShowGrimoire(false)}
                >
                  ✕ Close
                </button>
              </div>

              <div className="invoker-grimoire-grid">
                {SPELL_LIST.map((sp) => (
                  <div key={sp.id} className="invoker-grimoire-item">
                    <SpellIcon id={sp.id} size={40} />
                    <div className="invoker-grimoire-info">
                      <span className="invoker-grimoire-name">{sp.name}</span>
                      <div className="invoker-target-recipe">
                        {sp.recipe.map((orb, i) => (
                          <span
                            key={i}
                            className={`invoker-recipe-orb ${orb}`}
                            style={{ width: "18px", height: "18px", fontSize: "0.65rem" }}
                          >
                            {orb}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {status === "WON" && (
          <ResultOverlay
            variant="win"
            title="Combo Verified!"
            timeMs={elapsedMs}
            stats={[
              {
                label: "Combo",
                value: state.comboName,
              },
              {
                label: "Total Keypresses",
                value: state.totalKeypresses,
              },
              {
                label: "Mistakes",
                value: state.mistakes,
                tone: state.mistakes > 0 ? "warning" : "success",
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
            title="Sprint Failed"
            message={resultMessage}
            onRetry={resetGame}
            retryLabel="Try Again"
          />
        )}
      </div>

      <div className="controls-bar" style={{ marginTop: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span>Press</span>
          <span className="keycap">Q</span>
          <span className="keycap">W</span>
          <span className="keycap">E</span>
          <span>orbs</span>
          <span className="keycap">R</span>
          <span>invoke</span>
          <span className="keycap">D</span>
          <span className="keycap">F</span>
          <span>cast</span>
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
