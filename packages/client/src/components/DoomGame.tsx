import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DOOM_CHALLENGE_LABEL, formatDoomTime } from "@daily-speedruns/shared";
import "./DoomGame.css";
import {
  DEFAULT_DOOM_SETTINGS,
  encodeDoomSettings,
  type DoomRunSettings,
} from "../doom/settings.js";
import {
  isDoomRuntimeMessage,
  type DoomRunCapture,
  type DoomRuntimeMessage,
} from "../doom/protocol.js";

const BASE = import.meta.env.BASE_URL || "/";
const SETTINGS_KEY = "ds.doom.settings.v1";

export type DoomSubmitResult =
  | { status: "pending"; message?: string }
  | { status: "verified"; rank?: number | null }
  | { status: "error"; message: string };

export interface DoomGameProps {
  onRunFinished: (capture: DoomRunCapture) => Promise<DoomSubmitResult>;
}

type Phase = "idle" | "running" | "submitting" | "done" | "error";

const LOCKED_RULES = [
  `${DOOM_CHALLENGE_LABEL} · "Hangar"`,
  "Ultra-Violence",
  "Pistol start, no saves",
  "Shareware IWAD, unmodified",
  "Pinned engine build",
];

function loadSettings(): DoomRunSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_DOOM_SETTINGS;
    return { ...DEFAULT_DOOM_SETTINGS, ...JSON.parse(raw) } as DoomRunSettings;
  } catch {
    return DEFAULT_DOOM_SETTINGS;
  }
}

function useDesktopEligible(): boolean {
  const query = "(pointer: fine) and (min-width: 1024px)";
  const [eligible, setEligible] = useState<boolean>(
    () => typeof window !== "undefined" && window.matchMedia(query).matches
  );

  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setEligible(list.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, []);

  return eligible;
}

export const DoomGame: React.FC<DoomGameProps> = ({ onRunFinished }) => {
  const eligible = useDesktopEligible();
  const [settings, setSettings] = useState<DoomRunSettings>(loadSettings);
  const [phase, setPhase] = useState<Phase>("idle");
  const [capture, setCapture] = useState<DoomRunCapture | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [demoDetected, setDemoDetected] = useState<boolean>(false);
  const [runtimeReady, setRuntimeReady] = useState<boolean | null>(null);
  const [runNonce, setRunNonce] = useState<number>(0);

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const lastBeatRef = useRef<number>(0);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  // The engine bundle is a build artifact, not source. Tell the runner clearly
  // instead of booting a frame that will 404.
  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}doom/DOOM1.WAD`, { method: "HEAD" })
      .then((res) => {
        if (!cancelled) setRuntimeReady(res.ok);
      })
      .catch(() => {
        if (!cancelled) setRuntimeReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const runtimeUrl = useMemo(() => {
    // `?debug=1` on the app URL turns on the runtime's console panel and its
    // geometry report, which is how odd zoom/DPI rendering gets diagnosed.
    const debug = new URLSearchParams(window.location.search).has("debug")
      ? "&debug=1"
      : "";
    return `${BASE}doom.html?s=${encodeDoomSettings(settings)}&run=${runNonce}${debug}`;
  }, [settings, runNonce]);

  const exitFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }, []);

  const startRun = useCallback(async () => {
    setCapture(null);
    setMessage(null);
    setElapsedMs(0);
    setDemoDetected(false);
    setRunNonce((nonce) => nonce + 1);
    setPhase("running");
    lastBeatRef.current = Date.now();

    // Requesting fullscreen on the container that already holds the iframe
    // keeps the escape key and the exit gesture in the browser's hands. The
    // iframe must also be focused, or key presses never reach the engine.
    requestAnimationFrame(() => {
      const element = overlayRef.current;
      const frame = frameRef.current;
      if (!element?.requestFullscreen) {
        frame?.focus();
        return;
      }
      element
        .requestFullscreen()
        .catch(() => undefined)
        .finally(() => frame?.focus());
    });
  }, []);

  const submit = useCallback(
    async (result: DoomRunCapture) => {
      setPhase("submitting");
      try {
        const response = await onRunFinished(result);
        if (response.status === "error") {
          setPhase("error");
          setMessage(response.message);
          return;
        }
        setPhase("done");
        setMessage(
          response.status === "pending"
            ? "Submitted. A reviewer replays the demo before it joins the board."
            : "Run verified and added to the board."
        );
      } catch (error) {
        setPhase("error");
        setMessage(
          error instanceof Error ? error.message : "Failed to submit run"
        );
      }
    },
    [onRunFinished]
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      if (!isDoomRuntimeMessage(event.data)) return;
      lastBeatRef.current = Date.now();
      const payload = event.data as DoomRuntimeMessage;

      if (payload.type === "doom:tick") {
        setElapsedMs(payload.elapsedMs);
        setDemoDetected(payload.demoDetected);
        return;
      }
      if (payload.type === "doom:captured") {
        setCapture(payload.capture);
        setElapsedMs(payload.capture.timeMs);
        exitFullscreen();
        void submit(payload.capture);
        return;
      }
      if (payload.type === "doom:exit") {
        exitFullscreen();
        setPhase("idle");
        return;
      }
      if (payload.type === "doom:status" && payload.status === "error") {
        setPhase("error");
        setMessage(payload.message ?? "The Doom runtime stopped unexpectedly.");
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [exitFullscreen, submit]);

  // A crashed renderer takes the whole tab with it, but a wedged engine leaves
  // a black frame that never updates. The runtime beats every 250ms, so silence
  // for this long means it is gone.
  useEffect(() => {
    if (phase !== "running") return;
    const id = window.setInterval(() => {
      if (Date.now() - lastBeatRef.current < 15_000) return;
      window.clearInterval(id);
      exitFullscreen();
      setPhase("error");
      setMessage(
        "The Doom runtime stopped responding. Start the run again - your previous attempt was not submitted."
      );
    }, 3_000);
    return () => window.clearInterval(id);
  }, [phase, exitFullscreen]);

  const update = <K extends keyof DoomRunSettings>(
    key: K,
    value: DoomRunSettings[K]
  ) => setSettings((prev) => ({ ...prev, [key]: value }));

  if (!eligible) {
    return (
      <div className="game-card doom-gate" data-testid="doom-gate">
        <div className="doom-gate-inner">
          <span className="doom-eyebrow">Desktop event</span>
          <h3>Doom needs a keyboard and a mouse</h3>
          <p>
            {DOOM_CHALLENGE_LABEL} on Ultra-Violence is a real-time first person
            speedrun. It is not playable on touch devices, so the event is
            hidden on phones and tablets.
          </p>
          <p className="doom-gate-note">
            Open this page on a desktop browser to compete.
          </p>
        </div>
      </div>
    );
  }

  if (runtimeReady === false) {
    return (
      <div className="game-card doom-gate" data-testid="doom-missing">
        <div className="doom-gate-inner">
          <span className="doom-eyebrow">Runtime data missing</span>
          <h3>The Doom engine bundle is not installed</h3>
          <p>
            The shareware IWAD and the Chocolate Doom WebAssembly build are
            fetched at build time rather than committed.
          </p>
          <code className="doom-gate-code">
            npm run doom:fetch -w packages/client
          </code>
        </div>
      </div>
    );
  }

  return (
    <div className="game-card doom-card" data-testid="doom-card">
      <div className="doom-panel">
        <header className="doom-head">
          <div>
            <span className="doom-eyebrow">Event 07 · Doom (1993)</span>
            <h3>
              {DOOM_CHALLENGE_LABEL} <span>Hangar</span>
            </h3>
          </div>
          <div className="doom-clock" aria-live="off">
            {formatDoomTime(phase === "running" ? elapsedMs : capture?.timeMs ?? 0)}
          </div>
        </header>

        <div className="doom-locked">
          <span className="doom-locked-label">Locked</span>
          <ul>
            {LOCKED_RULES.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </div>

        <div className="doom-settings">
          <label className="doom-field">
            <span>Controls</span>
            <select
              value={settings.controlPreset}
              onChange={(event) =>
                update(
                  "controlPreset",
                  event.target.value as DoomRunSettings["controlPreset"]
                )
              }
            >
              <option value="wasd">WASD + mouse</option>
              <option value="classic">Arrows (classic)</option>
            </select>
          </label>

          <label className="doom-field">
            <span>Mouse turning</span>
            <select
              value={settings.mouseTurning ? "on" : "off"}
              onChange={(event) =>
                update("mouseTurning", event.target.value === "on")
              }
            >
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </label>

          <label className="doom-field">
            <span>Mouse sensitivity</span>
            <input
              type="range"
              min={0}
              max={9}
              step={1}
              value={settings.mouseSensitivity}
              onChange={(event) =>
                update("mouseSensitivity", Number(event.target.value))
              }
            />
            <output>{settings.mouseSensitivity}</output>
          </label>

          <label className="doom-field">
            <span>Sound</span>
            <select
              value={settings.soundEnabled ? "on" : "off"}
              onChange={(event) =>
                update("soundEnabled", event.target.value === "on")
              }
            >
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </label>

          <label className="doom-field">
            <span>Sound effects</span>
            <input
              type="range"
              min={0}
              max={15}
              step={1}
              value={settings.sfxVolume}
              disabled={!settings.soundEnabled}
              onChange={(event) => update("sfxVolume", Number(event.target.value))}
            />
            <output>{settings.sfxVolume}</output>
          </label>

          <label className="doom-field">
            <span>Brightness</span>
            <input
              type="range"
              min={0}
              max={4}
              step={1}
              value={settings.gamma}
              onChange={(event) => update("gamma", Number(event.target.value))}
            />
            <output>{settings.gamma}</output>
          </label>

          <label className="doom-field">
            <span>Screen melt</span>
            <select
              value={settings.screenMelt ? "on" : "off"}
              onChange={(event) =>
                update("screenMelt", event.target.value === "on")
              }
            >
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </label>

          <label className="doom-field">
            <span>Pixel scaling</span>
            <select
              value={settings.pixelScaling}
              onChange={(event) =>
                update(
                  "pixelScaling",
                  event.target.value as DoomRunSettings["pixelScaling"]
                )
              }
            >
              <option value="crisp">Crisp</option>
              <option value="smooth">Smooth</option>
            </select>
          </label>
        </div>

        <div className="doom-actions">
          <button
            type="button"
            className="arena-focus-btn doom-start"
            onClick={() => void startRun()}
            disabled={runtimeReady !== true || phase === "running"}
          >
            {phase === "running" ? "Run in progress" : "Start run"}
          </button>
          <span className="doom-fineprint">
            Press <kbd>F10</kbd> the moment you exit the level, then quit Doom to
            upload the demo.
          </span>
        </div>

        {phase !== "idle" && (
          <div className="doom-status-line">
            <span
              className={`doom-dot ${
                phase === "error" ? "is-bad" : phase === "done" ? "is-ok" : ""
              }`}
            />
            <span>
              {phase === "running" &&
                (demoDetected
                  ? "Demo detected - uploading"
                  : "Engine running - press F10 at the exit")}
              {phase === "submitting" && "Submitting run for review"}
              {phase === "done" && "Run submitted"}
              {phase === "error" && (message ?? "Something went wrong")}
            </span>
          </div>
        )}

        {capture && (
          <dl className="doom-result">
            <div>
              <dt>Claimed time</dt>
              <dd>{formatDoomTime(capture.timeMs)}</dd>
            </div>
            <div>
              <dt>Recorded tics</dt>
              <dd>{capture.demoTics}</dd>
            </div>
            <div>
              <dt>Demo size</dt>
              <dd>{Math.round(capture.demoBytes / 1024)} KB</dd>
            </div>
            <div>
              <dt>Timing</dt>
              <dd>{capture.timedManually ? "Manual finish" : "Auto"}</dd>
            </div>
            <div>
              <dt>Demo check</dt>
              <dd className={capture.demoValid ? "is-ok" : "is-bad"}>
                {capture.demoValid ? "Readable" : capture.demoReason ?? "Invalid"}
              </dd>
            </div>
            <div>
              <dt>Review</dt>
              <dd className="is-pending">
                {phase === "done" ? "Pending" : "—"}
              </dd>
            </div>
          </dl>
        )}
      </div>

      {phase === "running" && (
        <div className="doom-overlay" ref={overlayRef}>
          <iframe
            ref={frameRef}
            key={runNonce}
            className="doom-frame"
            title="Doom runtime"
            src={runtimeUrl}
            allow="fullscreen; gamepad"
            onLoad={() => frameRef.current?.focus()}
          />
        </div>
      )}
    </div>
  );
};
