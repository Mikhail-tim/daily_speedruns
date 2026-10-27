import React, { useCallback, useEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";
import {
  ALL_SPELLS,
  InvokerAction,
  InvokerGameEngine,
  InvokerState,
  OrbType,
  SPELL_LIST,
  SpellDef,
  TimestampedInput,
} from "@daily-speedruns/shared";
import { formatTimeMs } from "../lib/storage.js";
import { isGameInputLocked } from "../lib/keyboard.js";
import { useGameSession } from "../hooks/useGameSession.js";
import { GameShell } from "./GameShell.js";
import { GameHud } from "./GameHud.js";
import { ResultOverlay } from "./ResultOverlay.js";
import {
  ExortIcon,
  InvokeIcon,
  QuasIcon,
  SpellIcon,
  WexIcon,
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

const ORB_KEYS: OrbType[] = ["Q", "W", "E"];
const ORB_GLYPHS: Record<OrbType, React.FC<{ size?: number | string }>> = {
  Q: QuasIcon,
  W: WexIcon,
  E: ExortIcon,
};

const SpellChip: React.FC<{ spell: SpellDef | null; size?: number }> = ({
  spell,
  size = 52,
}) =>
  spell ? (
    <SpellIcon id={spell.id} size={size} />
  ) : (
    <span
      className="invoker-chip-empty"
      style={{ width: size, height: size }}
      aria-hidden
    />
  );

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

  const [shake, setShake] = useState(false);
  const [showGrimoire, setShowGrimoire] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const railRef = useRef<HTMLOListElement | null>(null);

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
    winMessage: "Combo verified!",
    onWin: () => {
      invokerAudio.playWin();
      confetti({
        particleCount: 110,
        spread: 85,
        origin: { y: 0.6 },
        colors: ["#38bdf8", "#d946ef", "#f97316", "#f8fafc"],
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
    setShake(false);
    setShowGrimoire(false);
    resetSession();
  }, [seed, resetSession]);

  useEffect(() => {
    resetGame();
  }, [resetGame]);

  // Keep the spell being cast centred in the rail. Done by hand so the page
  // itself never scrolls.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const active = rail.querySelector<HTMLElement>(".invoker-token.is-active");
    if (!active) return;
    const left = active.offsetLeft - (rail.clientWidth - active.clientWidth) / 2;
    rail.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [state.targetIndex]);

  const handleAction = useCallback(
    (action: InvokerAction) => {
      const current = statusRef.current;
      if (current === "WON" || current === "LOST" || current === "SUBMITTING") {
        return;
      }

      // The clock starts on the very first press of the run.
      const t = Math.max(1, begin());
      record(action, t);

      if (action.type === "ORB") {
        if (action.orb === "Q") invokerAudio.playQuas();
        else if (action.orb === "W") invokerAudio.playWex();
        else invokerAudio.playExort();
      } else if (action.type === "INVOKE") {
        invokerAudio.playInvoke();
      }

      const result = engineRef.current.step(stateRef.current, action);
      commitState(result.state);

      if (action.type !== "CAST") return;

      if (result.castSuccess) {
        invokerAudio.playCastSuccess();
        setShake(false);
        if (result.win) submit(t);
      } else {
        invokerAudio.playMistake();
        setShake(true);
        window.setTimeout(() => setShake(false), 320);
      }
    },
    [begin, commitState, record, submit, statusRef]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isGameInputLocked()) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const code = event.code;
      const finished =
        statusRef.current === "WON" || statusRef.current === "LOST";

      if (finished) {
        if (code === "Space" || code === "Enter" || code === "KeyR") {
          event.preventDefault();
          resetGame();
        }
        return;
      }

      if (statusRef.current === "IDLE") {
        if (code === "Space" || code === "Enter") {
          event.preventDefault();
          begin();
          return;
        }
      }

      switch (code) {
        case "KeyQ":
          event.preventDefault();
          handleAction({ type: "ORB", orb: "Q" });
          break;
        case "KeyW":
          event.preventDefault();
          handleAction({ type: "ORB", orb: "W" });
          break;
        case "KeyE":
          event.preventDefault();
          handleAction({ type: "ORB", orb: "E" });
          break;
        case "KeyR":
          event.preventDefault();
          handleAction({ type: "INVOKE" });
          break;
        case "KeyD":
          event.preventDefault();
          handleAction({ type: "CAST", slot: "D" });
          break;
        case "KeyF":
          if (event.target instanceof HTMLInputElement) return;
          event.preventDefault();
          if (statusRef.current === "PLAYING") {
            handleAction({ type: "CAST", slot: "F" });
          } else {
            onToggleFocus();
          }
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [begin, handleAction, onToggleFocus, resetGame, statusRef]);

  const target = state.sequence[state.targetIndex] ?? null;
  const targetInD = Boolean(target && state.slotD?.id === target.id);
  const targetInF = Boolean(target && state.slotF?.id === target.id);

  const hint = !target
    ? ""
    : targetInD
      ? "Ready in slot D — press D"
      : targetInF
        ? "Ready in slot F — press F"
        : `Press ${target.recipe.join(" ")} then R`;

  return (
    <GameShell className="invoker-card">
      <GameHud
        stats={[
          {
            label: "Progress",
            value: `${state.targetIndex} / ${state.sequence.length}`,
            tone: "highlight",
          },
          {
            label: "Mistakes",
            value: `${state.mistakes}`,
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

      <div className={`invoker-stage${shake ? " is-error" : ""}`}>
        <div className="invoker-stage-head">
          <div className="invoker-stage-title">
            <span className="invoker-eyebrow">Today&apos;s combo</span>
            <strong>{state.comboName}</strong>
          </div>
          <span className="invoker-stage-count">
            {state.targetIndex}/{state.sequence.length} cast
          </span>
        </div>

        <ol className="invoker-rail" ref={railRef} aria-label="Spells to cast in order">
          {state.sequence.map((spell, index) => {
            const done = index < state.targetIndex;
            const active = index === state.targetIndex;
            return (
              <li
                key={`${spell.id}-${index}`}
                className={`invoker-token${done ? " is-done" : ""}${
                  active ? " is-active" : ""
                }`}
                aria-current={active ? "step" : undefined}
              >
                <span className="invoker-token-index">{index + 1}</span>
                <SpellIcon id={spell.id} size={40} />
                <span className="invoker-token-name">{spell.name}</span>
              </li>
            );
          })}
        </ol>

        <div className="invoker-target" data-empty={target ? undefined : "true"}>
          <div className="invoker-target-main">
            <SpellChip spell={target} size={60} />
            <div className="invoker-target-text">
              <span className="invoker-eyebrow">
                {target ? `Spell ${state.targetIndex + 1}` : "Combo complete"}
              </span>
              <strong className="invoker-target-name">
                {target ? target.name : "All spells cast"}
              </strong>
              <span className="invoker-target-hint">{hint}</span>
            </div>
          </div>

          {target && (
            <div className="invoker-recipe" aria-label="Required orbs">
              {target.recipe.map((orb, index) => {
                const Glyph = ORB_GLYPHS[orb];
                return (
                  <span className={`invoker-recipe-orb orb-${orb}`} key={index}>
                    <Glyph size={26} />
                    <span>{orb}</span>
                  </span>
                );
              })}
              <span className="invoker-recipe-plus">+</span>
              <span className="invoker-recipe-orb orb-invoke">
                <InvokeIcon size={26} />
                <span>R</span>
              </span>
            </div>
          )}
        </div>

        <div className="invoker-hud">
          <div className="invoker-tray-group">
            <span className="invoker-eyebrow">Loaded</span>
            <div className="invoker-tray" aria-label="Active orbs">
              {[0, 1, 2].map((slot) => {
                const orb = state.orbs[slot];
                const Glyph = orb ? ORB_GLYPHS[orb] : null;
                return (
                  <span
                    key={slot}
                    className={`invoker-tray-slot${orb ? ` orb-${orb}` : ""}`}
                  >
                    {Glyph ? <Glyph size={30} /> : null}
                  </span>
                );
              })}
            </div>
          </div>

          <div className="invoker-keys">
            {ORB_KEYS.map((orb) => {
              const Glyph = ORB_GLYPHS[orb];
              return (
                <button
                  key={orb}
                  type="button"
                  className={`invoker-btn orb-${orb}`}
                  onClick={() => handleAction({ type: "ORB", orb })}
                  title={`${orb} orb`}
                >
                  <Glyph size={38} />
                  <kbd className="invoker-key">{orb}</kbd>
                </button>
              );
            })}

            <span className="invoker-sep" aria-hidden />

            <button
              type="button"
              className={`invoker-slot${targetInD ? " is-target" : ""}`}
              onClick={() => handleAction({ type: "CAST", slot: "D" })}
              title={state.slotD ? `Cast ${state.slotD.name}` : "Slot D is empty"}
            >
              <SpellChip spell={state.slotD} size={46} />
              <span className="invoker-slot-label">
                {state.slotD?.name ?? "Empty"}
              </span>
              <kbd className="invoker-key">D</kbd>
            </button>

            <button
              type="button"
              className={`invoker-slot${targetInF ? " is-target" : ""}`}
              onClick={() => handleAction({ type: "CAST", slot: "F" })}
              title={state.slotF ? `Cast ${state.slotF.name}` : "Slot F is empty"}
            >
              <SpellChip spell={state.slotF} size={46} />
              <span className="invoker-slot-label">
                {state.slotF?.name ?? "Empty"}
              </span>
              <kbd className="invoker-key">F</kbd>
            </button>

            <span className="invoker-sep" aria-hidden />

            <button
              type="button"
              className="invoker-btn invoker-btn-invoke"
              onClick={() => handleAction({ type: "INVOKE" })}
              title="Invoke the current orbs"
            >
              <InvokeIcon size={38} />
              <kbd className="invoker-key">R</kbd>
            </button>
          </div>
        </div>

        {status === "IDLE" && (
          <div className="canvas-overlay invoker-overlay">
            <h3 className="overlay-title">Ready?</h3>
            <p className="overlay-subtitle">
              Cast <strong>{state.comboName}</strong> — {state.sequence.length}{" "}
              spells in order.
              <br />
              Press <kbd className="keycap">Q</kbd>{" "}
              <kbd className="keycap">W</kbd> <kbd className="keycap">E</kbd>{" "}
              to load orbs, <kbd className="keycap">R</kbd> to invoke,{" "}
              <kbd className="keycap">D</kbd> / <kbd className="keycap">F</kbd>{" "}
              to cast.
            </p>
            <button className="btn-primary" onClick={() => begin()}>
              Start combo
              <kbd className="keycap overlay-keycap">Space</kbd>
            </button>
          </div>
        )}

        {status === "SUBMITTING" && (
          <ResultOverlay
            variant="submitting"
            title="Combo complete!"
            message="Verifying the keypress stream with the server engine..."
          />
        )}

        {status === "WON" && (
          <ResultOverlay
            variant="win"
            title="Combo Verified"
            timeMs={elapsedMs}
            stats={[
              { label: "Combo", value: state.comboName },
              { label: "Keypresses", value: state.totalKeypresses },
              {
                label: "Mistakes",
                value: state.mistakes,
                tone: state.mistakes > 0 ? "warning" : "success",
              },
            ]}
            rank={rank}
            message={resultMessage}
            onRetry={resetGame}
            retryLabel="Run it again"
          />
        )}

        {status === "LOST" && (
          <ResultOverlay
            variant="lost"
            title="Run rejected"
            message={resultMessage}
            onRetry={resetGame}
            retryLabel="Try again"
          />
        )}

        {showGrimoire && (
          <div
            className="invoker-grimoire"
            role="dialog"
            aria-label="All spell recipes"
            onClick={() => setShowGrimoire(false)}
          >
            <div
              className="invoker-grimoire-box"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="invoker-grimoire-head">
                <span className="invoker-eyebrow">Recipe book</span>
                <button
                  type="button"
                  className="invoker-link"
                  onClick={() => setShowGrimoire(false)}
                >
                  Close ✕
                </button>
              </div>
              <div className="invoker-grimoire-grid">
                {SPELL_LIST.map((spell) => (
                  <div className="invoker-grimoire-item" key={spell.id}>
                    <SpellIcon id={spell.id} size={40} />
                    <div>
                      <strong>{spell.name}</strong>
                      <span className="invoker-grimoire-recipe">
                        {spell.recipe.join(" · ")} + R
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="controls-bar invoker-controls">
        <div className="invoker-controls-keys">
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

        <div className="invoker-controls-actions">
          <button
            type="button"
            className="invoker-link"
            onClick={() => setShowGrimoire(true)}
          >
            Recipes
          </button>
          <button type="button" className="invoker-link" onClick={toggleSound}>
            {soundEnabled ? "Sound on" : "Sound off"}
          </button>
          <button
            type="button"
            className={`action-pill-btn${isFocusMode ? " active" : ""}`}
            onClick={onToggleFocus}
            title="Focus / pop-up mode"
          >
            <span>{isFocusMode ? "Exit Focus" : "Focus Mode"}</span>
            <span className="keycap" style={{ fontSize: 10 }}>
              F
            </span>
          </button>
        </div>
      </div>
    </GameShell>
  );
};

// Kept for the recipe hint text in tests/tools that import the spell table.
export const INVOKER_SPELLS = ALL_SPELLS;
