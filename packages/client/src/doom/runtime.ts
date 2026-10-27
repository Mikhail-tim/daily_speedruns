/**
 * Isolated Doom runtime.
 *
 * Runs inside `doom.html` in a same-origin iframe. It owns the canvas, the
 * engine module, the stopwatch, and demo capture, and it reports back to the
 * parent app over `postMessage`.
 *
 * Why a separate page instead of a component:
 *  - the engine installs global keyboard handlers and a request animation loop;
 *  - a truly clean restart is a reload;
 *  - a hung engine can never block the leaderboard UI.
 */

import "./runtime.css";
import {
  DOOM_ENGINE_BUILD,
  DOOM_IWAD_SHA256,
  formatDoomTime,
  parseDoomDemo,
} from "@daily-speedruns/shared";
import {
  buildEngineArgs,
  buildExtraConfig,
  buildMainConfig,
  decodeDoomSettings,
  type DoomRunSettings,
} from "./settings.js";
import type {
  DoomRunCapture,
  DoomRuntimeMessage,
  DoomRuntimeStatus,
} from "./protocol.js";

const BASE = import.meta.env.BASE_URL || "/";
const ENGINE_MODULE_URL = `${BASE}doom/chocolate-doom.js`;
const ENGINE_FILE_BASE = `${BASE}doom/`;
const IWAD_URL = `${BASE}doom/DOOM1.WAD`;

/** Key the runner presses to stop the clock at the moment they exit the level. */
const FINISH_KEY = "F10";

const canvas = (document.querySelector<HTMLCanvasElement>("#canvas") ??
  document.querySelector<HTMLCanvasElement>("#doom-canvas"))!;

const originalGetElementById = document.getElementById.bind(document);
document.getElementById = (id: string) => {
  if (id === "canvas" || id === "doom-canvas") return canvas;
  return originalGetElementById(id);
};

const originalQuerySelector = document.querySelector.bind(document);
document.querySelector = function <E extends Element = Element>(
  selectors: string
): E | null {
  if (
    selectors === "#canvas" ||
    selectors === "#doom-canvas" ||
    selectors === "canvas"
  ) {
    return canvas as unknown as E;
  }
  return originalQuerySelector(selectors);
};

// SDL2's software framebuffer blits via `putImageData(SDL2.image, 0, 0)`.
// In browsers with HighDPI or fractional devicePixelRatio, SDL2 creates an
// image matched to physical device pixels (e.g. 400x300, 960x720). If the canvas
// backing store (canvas.width/height) does not match the image dimensions,
// putImageData clips off the right side and the bottom HUD status bar.
// Auto-syncing the canvas backing store to the incoming image buffer prevents
// any clipping at any zoom or DPI level.
if (typeof CanvasRenderingContext2D !== "undefined") {
  const originalPutImageData = CanvasRenderingContext2D.prototype.putImageData;
  CanvasRenderingContext2D.prototype.putImageData = function (
    imagedata: ImageData,
    dx: number,
    dy: number,
    ...rest: [number, number, number, number] | []
  ) {
    if (this.canvas === canvas) {
      if (
        canvas.width !== imagedata.width ||
        canvas.height !== imagedata.height
      ) {
        canvas.width = imagedata.width;
        canvas.height = imagedata.height;
      }
    }
    return (originalPutImageData as any).call(this, imagedata, dx, dy, ...rest);
  };
}
const stage = document.querySelector<HTMLElement>("#doom-stage")!;
const overlay = document.querySelector<HTMLElement>("#doom-overlay")!;
const overlayTitle = document.querySelector<HTMLElement>("#overlay-title")!;
const overlayBody = document.querySelector<HTMLElement>("#overlay-body")!;
const overlayBar = document.querySelector<HTMLElement>("#overlay-bar")!;
const overlayFill = document.querySelector<HTMLElement>("#overlay-fill")!;
const timerEl = document.querySelector<HTMLElement>("#doom-timer")!;
const hudStatus = document.querySelector<HTMLElement>("#doom-hud-status")!;
const metricsEl = document.querySelector<HTMLElement>("#doom-metrics")!;
const logEl = document.querySelector<HTMLElement>("#doom-log")!;
const finishBtn = document.querySelector<HTMLButtonElement>("#finish-button")!;
const menuBtn = document.querySelector<HTMLButtonElement>("#menu-button")!;
const restartBtn = document.querySelector<HTMLButtonElement>("#restart-button")!;
const exitBtn = document.querySelector<HTMLButtonElement>("#exit-button")!;

const settings: DoomRunSettings = decodeDoomSettings(
  new URLSearchParams(window.location.search).get("s")
);

let moduleRef: {
  FS: any;
  callMain: (args: string[]) => void;
} | null = null;
let startedAt = 0;
let stoppedAt = 0;
let finished = false;
let pollHandle = 0;
let tickHandle = 0;
let demoDetected = false;

/**
 * Doom renders 320x200 with non-square pixels, so the classic look is 4:3.
 *
 * The canvas box is computed here rather than in CSS: it must be an exact
 * integer rectangle that fits inside the stage, and the engine's blit has to
 * agree with the box we give it. Container-query units and `object-fit` both
 * left the two out of step at some zoom levels.
 *
 * All maths is done in **device** pixels, then converted back to CSS pixels.
 * At a browser zoom other than 100% the CSS pixel is fractional, and a box or
 * offset that lands mid-device-pixel gets resampled unevenly — which reads as a
 * shifted or cropped image. Snapping to the device grid removes that entirely.
 */
function layoutCanvas(): void {
  const rect = stage.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;

  const dpr = window.devicePixelRatio || 1;
  const maxWidth = Math.floor(rect.width * dpr);
  const maxHeight = Math.floor(rect.height * dpr);

  const width = Math.min(maxWidth, Math.floor((maxHeight * 4) / 3));
  const height = Math.floor((width * 3) / 4);
  if (width < 1 || height < 1) return;

  canvas.style.width = `${width / dpr}px`;
  canvas.style.height = `${height / dpr}px`;
  canvas.style.left = `${Math.floor((maxWidth - width) / 2) / dpr}px`;
  canvas.style.top = `${Math.floor((maxHeight - height) / 2) / dpr}px`;

  if (!metricsEl.hidden) {
    metricsEl.textContent = describeLayout();
  }
}

/** One-shot geometry report, surfaced by `?debug=1`. */
function describeLayout(): string {
  const rect = stage.getBoundingClientRect();
  const viewport = window.visualViewport;
  const dpr = window.devicePixelRatio || 1;
  return [
    `stage ${Math.round(rect.width)}x${Math.round(rect.height)}`,
    `canvas ${canvas.style.width}x${canvas.style.height}`,
    `at ${canvas.style.left},${canvas.style.top}`,
    `buffer ${canvas.width}x${canvas.height}`,
    `dpr ${dpr.toFixed(3)}`,
    `zoom ${viewport ? viewport.scale.toFixed(3) : "n/a"}`,
    `viewport ${window.innerWidth}x${window.innerHeight}`,
  ].join(" | ");
}

function post(message: DoomRuntimeMessage): void {
  window.parent?.postMessage(message, window.location.origin);
}

function setStatus(status: DoomRuntimeStatus, message?: string): void {
  post({ type: "doom:status", status, message });
}

function log(text: string, level: "info" | "error" = "info"): void {
  const line = String(text ?? "").trim();
  if (!line) return;
  const stamp = new Date().toISOString().slice(11, 19);
  logEl.textContent += `${stamp}  ${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
  post({ type: "doom:log", level, text: line });
  if (level === "error") console.error(line);
  else console.log(line);
}

function showOverlay(title: string, body: string, progress?: number): void {
  overlay.hidden = false;
  overlayTitle.textContent = title;
  overlayBody.textContent = body;
  if (progress === undefined) {
    overlayBar.hidden = true;
  } else {
    overlayBar.hidden = false;
    overlayFill.style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
  }
}

function hideOverlay(): void {
  overlay.hidden = true;
}

function fail(message: string): void {
  setStatus("error");
  showOverlay("Runtime error", message);
  log(message, "error");
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const view = new Uint8Array(bytes.byteLength);
  view.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", view);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fetchWad(): Promise<Uint8Array> {
  const response = await fetch(IWAD_URL, { cache: "force-cache" });
  if (!response.ok) {
    throw new Error(`IWAD request failed: HTTP ${response.status}`);
  }

  const total = Number(response.headers.get("Content-Length") ?? 0);
  if (!response.body) {
    return new Uint8Array(await response.arrayBuffer());
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (total > 0) {
      post({ type: "doom:progress", loadedBytes: loaded, totalBytes: total });
      showOverlay(
        "Loading shareware episode",
        `${(loaded / 1024 / 1024).toFixed(1)} of ${(total / 1024 / 1024).toFixed(1)} MB`,
        loaded / total
      );
    }
  }

  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function ensureDir(fs: any, path: string): void {
  let cursor = "";
  for (const segment of path.split("/").filter(Boolean)) {
    cursor += `/${segment}`;
    try {
      fs.mkdir(cursor);
    } catch (error) {
      const message = String((error as Error)?.message ?? error);
      if (!message.includes("File exists")) throw error;
    }
  }
}

function prepareFilesystem(
  runtimeModule: any,
  wad: Uint8Array,
  runSettings: DoomRunSettings
): void {
  const { FS } = runtimeModule;
  ensureDir(FS, "/config");
  ensureDir(FS, "/savegames");
  ensureDir(FS, "/iwads");

  FS.writeFile("/config/default.cfg", buildMainConfig(runSettings));
  FS.writeFile("/config/chocolate-doom.cfg", buildExtraConfig());
  // The prebuilt bundle expects its data at this path; we bypass its 28 MB
  // Freedoom payload and place the shareware IWAD here instead.
  FS.writeFile("/iwads/doom1.wad", wad);
}

function startClock(): void {
  startedAt = performance.now();
  // This doubles as a heartbeat. If the runtime page dies — a crashed renderer
  // cannot post anything — the host notices the silence and offers a restart
  // instead of leaving a frozen frame on screen.
  tickHandle = window.setInterval(() => {
    if (finished) return;
    const running = stoppedAt === 0;
    const elapsed = (running ? performance.now() : stoppedAt) - startedAt;
    if (running) {
      timerEl.textContent = formatDoomTime(elapsed);
      if (!metricsEl.hidden) metricsEl.textContent = describeLayout();
    }
    post({
      type: "doom:tick",
      elapsedMs: Math.round(elapsed),
      demoDetected,
    });
  }, 250);
}

function stopClock(manual: boolean): void {
  if (stoppedAt > 0) return;
  stoppedAt = performance.now();
  timerEl.textContent = formatDoomTime(stoppedAt - startedAt);
  hudStatus.textContent = manual
    ? "Clock stopped - quit Doom to upload the demo"
    : "Run captured";
  setStatus("awaiting-demo");
}

function findDemoPath(): string | null {
  if (!moduleRef) return null;
  try {
    const names: string[] = moduleRef.FS.readdir("/savegames");
    const demo = names.find((name) => name.toLowerCase().endsWith(".lmp"));
    return demo ? `/savegames/${demo}` : null;
  } catch {
    return null;
  }
}

function hasDemoFile(): boolean {
  const path = findDemoPath();
  if (!path) return false;
  try {
    return moduleRef!.FS.stat(path).size > 14;
  } catch {
    return false;
  }
}

async function capture(): Promise<void> {
  if (finished) return;
  const path = findDemoPath();
  if (!path) return;

  let bytes: Uint8Array;
  try {
    bytes = moduleRef!.FS.readFile(path);
  } catch {
    return;
  }
  if (bytes.length <= 14) return;

  finished = true;
  window.clearInterval(pollHandle);
  window.clearInterval(tickHandle);

  const manual = stoppedAt > 0;
  if (!manual) stopClock(false);

  const info = parseDoomDemo(bytes);
  const demoSha256 = await sha256Hex(bytes);

  const captured: DoomRunCapture = {
    timeMs: Math.max(0, Math.round((stoppedAt || performance.now()) - startedAt)),
    timedManually: manual,
    demoBase64: toBase64(bytes),
    demoBytes: bytes.length,
    demoSha256,
    demoTics: info.tics,
    demoValid: info.valid,
    demoReason: info.reason,
    mapLabel: info.mapLabel,
    skill: info.header.skill,
    iwadSha256: DOOM_IWAD_SHA256,
    engineBuild: DOOM_ENGINE_BUILD,
  };

  setStatus("captured");
  hudStatus.textContent = "Run captured";
  showOverlay(
    "Run captured",
    info.valid
      ? `Demo recorded: ${info.tics} tics on ${info.mapLabel}. Sending it for review.`
      : `Demo problem: ${info.reason ?? "unknown"}. The run cannot be submitted.`
  );
  finishBtn.disabled = true;
  post({ type: "doom:captured", capture: captured });
}

function watchForDemo(): void {
  pollHandle = window.setInterval(() => {
    if (finished) return;
    demoDetected = hasDemoFile();
    if (demoDetected) {
      void capture();
    }
  }, 600);
}

/** The engine reads Escape to open its menu; in browser fullscreen the browser eats it. */
function sendEscapeToEngine(): void {
  const init: KeyboardEventInit = {
    key: "Escape",
    code: "Escape",
    keyCode: 27,
    which: 27,
    bubbles: true,
    cancelable: true,
  } as KeyboardEventInit;
  canvas.dispatchEvent(new KeyboardEvent("keydown", init));
  canvas.dispatchEvent(new KeyboardEvent("keyup", init));
}

async function boot(): Promise<void> {
  setStatus("booting");
  showOverlay("Starting engine", "Fetching the shareware episode");
  log(`Starting run with settings ${JSON.stringify(settings)}`);

  const wad = await fetchWad();
  const wadHash = await sha256Hex(wad);
  if (wadHash !== DOOM_IWAD_SHA256) {
    throw new Error(
      `IWAD integrity check failed (${wadHash.slice(0, 12)}...). Refusing to start.`
    );
  }
  log(`IWAD verified (${(wad.length / 1024 / 1024).toFixed(2)} MB)`);

  showOverlay("Starting engine", "Loading WebAssembly build", 1);
  setStatus("loading-iwad");

  // The engine bundle lives in /public, so it must be imported through the
  // browser's own loader rather than Vite's module graph.
  const imported = (await (0, eval)(
    `import(${JSON.stringify(ENGINE_MODULE_URL)})`
  )) as { default: (options: Record<string, unknown>) => Promise<any> };
  const createDoomModule = imported.default;

  const runtimeModule = await createDoomModule({
    canvas,
    // Listen on the whole document, not just the canvas. The parent focuses the
    // iframe, which leaves the iframe's own active element on <body>, so a
    // canvas-only listener silently receives nothing and the player cannot move.
    keyboardListeningElement: document.body,
    locateFile: (path: string) => `${ENGINE_FILE_BASE}${path}`,
    noInitialRun: true,
    // The prebuilt bundle wants to download a 28 MB Freedoom data file. We do
    // not ship it: hand the loader a stub so it proceeds, and write the real
    // shareware IWAD into the virtual filesystem ourselves.
    getPreloadedPackage: () => new ArrayBuffer(1),
    preRun: [
      (loaded: any) => {
        prepareFilesystem(loaded, wad, settings);
      },
    ],
    print: (text: string) => log(text),
    // Chocolate Doom writes progress chatter to stderr, so it is not an error
    // channel here. Real failures arrive through `onAbort`.
    printErr: (text: string) => log(text),
    onAbort: (reason: unknown) => fail(`Engine aborted: ${String(reason)}`),
  });

  moduleRef = runtimeModule;

  const args = buildEngineArgs(settings);
  log(`chocolate-doom ${args.join(" ")}`);

  try {
    runtimeModule.callMain(args);
  } catch (error) {
    const message = String(error ?? "");
    if (!message.includes("unwind") && !message.includes("SimulateInfiniteLoop")) {
      throw error;
    }
  }

  hideOverlay();
  setStatus("running");
  hudStatus.textContent = settings.mouseTurning
    ? "Click the game to capture the mouse - F10 stops the clock"
    : "F10 stops the clock";
  // Take focus inside this document as well as in the parent, otherwise the
  // engine's key handlers never see a thing.
  window.focus();
  document.body.focus();
  canvas.focus();
  startClock();
  watchForDemo();
  log("Engine running.");
  if (!metricsEl.hidden) {
    metricsEl.textContent = describeLayout();
  }
  log(`Layout ${describeLayout()}`);
}

function bindControls(): void {
  finishBtn.addEventListener("click", () => {
    if (finished) return;
    stopClock(true);
    finishBtn.disabled = true;
    if (!hasDemoFile()) {
      hudStatus.textContent = "Now press Esc in Doom and quit to upload your demo";
    }
  });

  menuBtn.addEventListener("click", () => {
    canvas.focus();
    sendEscapeToEngine();
  });

  restartBtn.addEventListener("click", () => {
    window.location.reload();
  });

  exitBtn.addEventListener("click", () => {
    post({ type: "doom:exit" });
  });

  window.addEventListener(
    "keydown",
    (event) => {
      // Backquote toggles the engine log. It overlays the bottom of the picture,
      // so it stays closed unless asked for.
      if (event.code === "Backquote" && !event.repeat) {
        document.body.classList.toggle("log-visible");
      }
      if (event.key !== FINISH_KEY) return;
      event.preventDefault();
      event.stopPropagation();
      if (!finished && startedAt > 0) {
        stopClock(true);
        finishBtn.disabled = true;
        if (!hasDemoFile()) {
          hudStatus.textContent =
            "Now press Esc in Doom and quit to upload your demo";
        }
      }
    },
    true
  );

  // Pointer lock is what makes mouse turning work at all: Chocolate Doom only
  // accumulates mouse motion while the mouse is grabbed, and in the browser
  // "grabbed" means pointer lock. If the browser refuses the lock the mouse is
  // inert, so say so rather than leaving the player guessing.
  let mouseCaptureFailed = false;
  const requestMouseCapture = () => {
    canvas.focus();
    if (!settings.mouseTurning || finished) return;
    if (document.pointerLockElement === canvas) return;
    Promise.resolve(canvas.requestPointerLock?.())
      .then(() => {
        mouseCaptureFailed = false;
      })
      .catch(() => {
        mouseCaptureFailed = true;
        hudStatus.textContent = "Mouse capture blocked - use arrow keys to turn";
      });
  };

  stage.addEventListener("mousedown", requestMouseCapture);
  canvas.addEventListener("click", () => canvas.focus());

  document.addEventListener("pointerlockchange", () => {
    if (finished) return;
    hudStatus.textContent =
      document.pointerLockElement === canvas
        ? "Mouse captured - Esc releases it"
        : settings.mouseTurning
          ? mouseCaptureFailed
            ? "Mouse capture blocked - use arrow keys to turn"
            : "Click the game to capture the mouse - F10 stops the clock"
          : "F10 stops the clock";
  });

  window.addEventListener("beforeunload", () => {
    window.clearInterval(pollHandle);
    window.clearInterval(tickHandle);
  });
}

/**
 * Re-run the layout whenever the device pixel ratio changes. Browser zoom often
 * fires `resize` too, but not always, and a stale box computed for the previous
 * ratio is exactly what puts the canvas on a fractional device pixel.
 */
function watchPixelRatio(): void {
  const query = window.matchMedia(
    `(resolution: ${window.devicePixelRatio || 1}dppx)`
  );
  const onChange = () => {
    layoutCanvas();
    watchPixelRatio();
  };
  query.addEventListener("change", onChange, { once: true });
}

async function main(): Promise<void> {
  bindControls();
  layoutCanvas();
  // Zoom changes and fullscreen transitions resize the stage; keep the canvas
  // box in lockstep with it.
  new ResizeObserver(layoutCanvas).observe(stage);
  window.addEventListener("resize", layoutCanvas);
  watchPixelRatio();
  stage.classList.toggle("is-smooth", settings.pixelScaling === "smooth");

  if (new URLSearchParams(window.location.search).get("debug") === "1") {
    document.body.classList.add("is-debug");
    metricsEl.hidden = false;
    metricsEl.textContent = describeLayout();
    log(`Layout ${describeLayout()}`);
  }

  // If the engine throws outside the boot path, tell the host rather than
  // leaving a frozen frame behind.
  window.addEventListener("error", (event) => {
    log(`Runtime error: ${event.message}`, "error");
    post({ type: "doom:status", status: "error", message: event.message });
  });
  window.addEventListener("unhandledrejection", (event) => {
    log(`Unhandled rejection: ${String(event.reason)}`, "error");
  });

  try {
    await boot();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(message);
  }
}

void main();
