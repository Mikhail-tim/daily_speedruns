/**
 * Local identity & storage utilities for Daily Speedruns.
 */

const STORAGE_KEY_USER_ID = "ds_user_id";
const STORAGE_KEY_NICKNAME = "ds_nickname";

export function getOrCreateUserId(): string {
  let id = localStorage.getItem(STORAGE_KEY_USER_ID);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY_USER_ID, id);
  }
  return id;
}

export function getSavedNickname(): string {
  const saved = localStorage.getItem(STORAGE_KEY_NICKNAME);
  if (saved && saved.trim()) {
    return saved.trim();
  }
  const id = getOrCreateUserId();
  return `Runner #${id.slice(0, 5)}`;
}

export function saveNickname(name: string): void {
  const trimmed = name.trim().slice(0, 30);
  if (trimmed) {
    localStorage.setItem(STORAGE_KEY_NICKNAME, trimmed);
  }
}

/**
 * Formats milliseconds into a clean MM:SS.mmm format for speedrun displays.
 */
export function formatTimeMs(ms: number): string {
  if (ms == null || isNaN(ms) || ms < 0) return "--:--.---";
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = Math.floor(ms % 1000);

  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  const mmm = String(millis).padStart(3, "0");

  return `${mm}:${ss}.${mmm}`;
}
