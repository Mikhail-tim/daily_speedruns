/**
 * True while a modal owns the keyboard. Games check this at the top of their
 * global keydown handlers so nickname typing never reaches the game.
 */
export function isGameInputLocked(): boolean {
  return (
    typeof document !== "undefined" &&
    document.body.dataset.gameInputLocked === "true"
  );
}

/** Keys games bind that also have a browser default (page scrolling). */
const SCROLL_KEYS = new Set([
  "Space",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

function onGameKeyDown(event: KeyboardEvent) {
  if (!SCROLL_KEYS.has(event.code)) return;
  // The game already claimed it.
  if (event.defaultPrevented) return;
  // Typing into a field: leave the browser (and the caret) alone.
  if (isTextField(event.target)) return;
  // A focused button or link activates on Space and never scrolls, so let the
  // native behaviour through and keep keyboard activation working.
  if (event.code === "Space") {
    const tag = event.target instanceof HTMLElement ? event.target.tagName : "";
    if (tag === "BUTTON" || tag === "A") return;
  }
  event.preventDefault();
}

let locks = 0;

/**
 * Blocks the page-scroll defaults for the keys games bind while a board is on
 * screen. Without it a stray Space mid-run scrolls the page out from under the
 * canvas. Returns a release function; nested locks are reference counted.
 */
export function lockGameScroll(): () => void {
  if (typeof window === "undefined") return () => {};
  locks += 1;
  if (locks === 1) {
    window.addEventListener("keydown", onGameKeyDown);
  }
  return () => {
    locks -= 1;
    if (locks === 0) {
      window.removeEventListener("keydown", onGameKeyDown);
    }
  };
}
