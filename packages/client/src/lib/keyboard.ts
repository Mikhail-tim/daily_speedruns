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
