/**
 * Message contract between the main app and the isolated Doom runtime page.
 *
 * The engine runs in `doom.html` (a same-origin iframe) so that a crash, a
 * stuck pointer lock, or dozens of global keyboard handlers can never leak into
 * the rest of the site. Reloading the iframe is also the cheapest way to get a
 * truly clean engine state between attempts.
 */

export type DoomRuntimeStatus =
  | "booting"
  | "loading-iwad"
  | "running"
  | "awaiting-demo"
  | "captured"
  | "error";

/** The artifact the runtime hands back to the app after a run. */
export interface DoomRunCapture {
  /** Time from the first gameplay frame to the runner pressing Finish. */
  timeMs: number;
  /** True when the runner stopped the clock themselves rather than quitting. */
  timedManually: boolean;
  demoBase64: string;
  demoBytes: number;
  demoSha256: string;
  /** Tics recorded in the demo (includes post-level frames). */
  demoTics: number;
  demoValid: boolean;
  demoReason?: string;
  mapLabel: string;
  skill: number;
  iwadSha256: string;
  engineBuild: string;
}

export type DoomRuntimeMessage =
  | { type: "doom:status"; status: DoomRuntimeStatus; message?: string }
  | { type: "doom:progress"; loadedBytes: number; totalBytes: number }
  | { type: "doom:tick"; elapsedMs: number; demoDetected: boolean }
  | { type: "doom:captured"; capture: DoomRunCapture }
  | { type: "doom:log"; level: "info" | "error"; text: string }
  /** The runtime page asks the host to close the run overlay. */
  | { type: "doom:exit" };

export function isDoomRuntimeMessage(value: unknown): value is DoomRuntimeMessage {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && type.startsWith("doom:");
}
