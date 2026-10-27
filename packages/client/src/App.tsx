import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  LeaderboardEntry,
  TimestampedInput,
} from "@daily-speedruns/shared";
import {
  ChallengeResponse,
  fetchLeaderboard,
  fetchTodayChallenge,
  submitRun,
  updateNicknameOnServer,
} from "./lib/api.js";
import {
  getOrCreateRunnerToken,
  getOrCreateUserId,
  getSavedNickname,
  saveNickname,
} from "./lib/storage.js";
import { Header } from "./components/Header.js";
import { DailyInfo } from "./components/DailyInfo.js";
import { SnakeCanvas } from "./components/SnakeCanvas.js";
import { WordleGame } from "./components/WordleGame.js";
import { TypingGame } from "./components/TypingGame.js";
import { Game2048 } from "./components/Game2048.js";
import { MinesweeperGame } from "./components/MinesweeperGame.js";
import { MathSprint } from "./components/MathSprint.js";
import { CaptchaGame } from "./components/CaptchaGame.js";
import { Leaderboard } from "./components/Leaderboard.js";
import { NicknameModal } from "./components/NicknameModal.js";
import {
  ArenaPlaceholder,
  type PlaceholderView,
} from "./components/ArenaPlaceholder.js";
import { formatTimeMs } from "./lib/storage.js";

type GameId =
  | "captcha"
  | "math"
  | "typing"
  | "wordle"
  | "snake"
  | "game2048"
  | "minesweeper";
type RailView = "today" | PlaceholderView;

const GAME_RAIL: Array<{
  id: GameId;
  index: string;
  label: string;
  meta: string;
}> = [
  { id: "captcha", index: "01", label: "reCAPTCHA", meta: "Human" },
  { id: "math", index: "02", label: "Mental Math", meta: "10Q" },
  { id: "typing", index: "03", label: "Typing", meta: "WPM" },
  { id: "wordle", index: "04", label: "Wordle", meta: "5×6" },
  { id: "snake", index: "05", label: "Snake", meta: "L20" },
  { id: "game2048", index: "06", label: "2048", meta: "512" },
  { id: "minesweeper", index: "07", label: "Minesweeper", meta: "9×9" },
];

const RAIL_NAV: Array<{ id: RailView; index: string; label: string }> = [
  { id: "today", index: "01", label: "Today" },
  { id: "archive", index: "02", label: "Archive" },
  { id: "seasons", index: "03", label: "Seasons" },
  { id: "runs", index: "04", label: "My runs" },
  { id: "rules", index: "05", label: "Rules" },
];

export const App: React.FC = () => {
  const [userId] = useState<string>(getOrCreateUserId);
  const [runnerToken] = useState<string>(getOrCreateRunnerToken);
  const [nickname, setNickname] = useState<string>(getSavedNickname);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isFocusMode, setIsFocusMode] = useState<boolean>(false);
  const [selectedGame, setSelectedGame] = useState<GameId>("captcha");
  const [activeView, setActiveView] = useState<RailView>("today");
  const [isEventsOpen, setIsEventsOpen] = useState<boolean>(false);
  const [shareLabel, setShareLabel] = useState<string>("Share result");

  const [challenge, setChallenge] = useState<ChallengeResponse | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [userBestTimeMs, setUserBestTimeMs] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadRequestId = useRef<number>(0);
  const selectedGameRef = useRef(selectedGame);
  selectedGameRef.current = selectedGame;

  useEffect(() => {
    if (isModalOpen) {
      document.body.dataset.gameInputLocked = "true";
    } else {
      delete document.body.dataset.gameInputLocked;
    }
    document.body.style.overflow = isModalOpen || isFocusMode ? "hidden" : "";

    return () => {
      delete document.body.dataset.gameInputLocked;
      document.body.style.overflow = "";
    };
  }, [isModalOpen, isFocusMode]);

  useEffect(() => {
    if (!isFocusMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFocusMode(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isFocusMode]);

  const loadData = useCallback(async () => {
    const requestId = ++loadRequestId.current;
    try {
      setLoading(true);
      setLeaderboard([]);
      setUserBestTimeMs(null);
      const ch = await fetchTodayChallenge(undefined, selectedGame);
      if (requestId !== loadRequestId.current) return;
      setChallenge(ch);

      const lb = await fetchLeaderboard(ch.date, userId, selectedGame);
      if (requestId !== loadRequestId.current) return;
      setLeaderboard(lb.leaderboard);
      setUserBestTimeMs(lb.userBestTimeMs);
      setLoadError(null);
    } catch (err: any) {
      if (requestId !== loadRequestId.current) return;
      setLoadError(err.message || "Failed to connect to backend");
    } finally {
      if (requestId === loadRequestId.current) {
        setLoading(false);
      }
    }
  }, [userId, selectedGame]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRunFinished = async (
    claimedTimeMs: number,
    inputs: TimestampedInput<any>[]
  ) => {
    if (!challenge) {
      return { verified: false, error: "Challenge not loaded" };
    }

    try {
      const res = await submitRun(
        {
          userId,
          nickname,
          date: challenge.date,
          gameId: challenge.gameId,
          timeMs: claimedTimeMs,
          inputs,
        },
        runnerToken
      );

      if (res.verified && selectedGameRef.current === challenge.gameId) {
        const updatedLb = await fetchLeaderboard(
          challenge.date,
          userId,
          challenge.gameId
        );
        setLeaderboard(updatedLb.leaderboard);
        setUserBestTimeMs(updatedLb.userBestTimeMs);
      }

      return {
        verified: res.verified,
        rank: res.rank,
        error: res.reason
          ? `${res.error} (${res.reason})`
          : res.error || "Verification rejected",
      };
    } catch (err: any) {
      return {
        verified: false,
        error: err.message || "Failed to submit run",
      };
    }
  };

  const handleSaveNickname = async (newName: string) => {
    saveNickname(newName);
    setNickname(newName);
    await updateNicknameOnServer(userId, newName, runnerToken);
    if (challenge && selectedGameRef.current === challenge.gameId) {
      const lb = await fetchLeaderboard(
        challenge.date,
        userId,
        challenge.gameId
      );
      setLeaderboard(lb.leaderboard);
    }
  };

  const activeChallenge =
    challenge && challenge.gameId === selectedGame ? challenge : null;
  const activeGame =
    GAME_RAIL.find((game) => game.id === selectedGame) ?? GAME_RAIL[0];
  const currentEntry = leaderboard.find((entry) => entry.isCurrentUser);

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareLabel("Link copied");
    } catch {
      setShareLabel("Copy failed");
    }
    window.setTimeout(() => setShareLabel("Share result"), 1600);
  };

  return (
    <div className={`arena-app ${isFocusMode ? "focus-active" : ""}`}>
      <div
        className={`focus-backdrop ${isFocusMode ? "active" : ""}`}
        onClick={() => setIsFocusMode(false)}
      />

      {isFocusMode && (
        <button
          type="button"
          className="focus-exit-btn"
          onClick={() => setIsFocusMode(false)}
        >
          Exit focus <span>Esc</span>
        </button>
      )}

      <Header
        nickname={nickname}
        dateStr={activeChallenge?.date}
        onEditNickname={() => setIsModalOpen(true)}
      />

      <div className="arena-layout">
        <aside className="arena-rail">
          <div className="rail-season">
            <div className="rail-season-head">
              <span>Season 01</span>
              <span>Day 21</span>
            </div>
            <div className="rail-season-stats">
              <div>
                <span>Days left</span>
                <strong>12</strong>
              </div>
              <div>
                <span>Rank</span>
                <strong>#34</strong>
              </div>
            </div>
            <div className="rail-progress">
              <span style={{ width: "62%" }} />
            </div>
            <div className="rail-season-foot">
              <span>1,208 pts</span>
              <span>1,208 players</span>
            </div>
          </div>

          <nav className="rail-nav" aria-label="Main navigation">
            {RAIL_NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`rail-item ${
                  activeView === item.id ? "active" : ""
                }`}
                aria-current={activeView === item.id ? "page" : undefined}
                onClick={() => setActiveView(item.id)}
              >
                <span className="rail-num">{item.index}</span>
                <span className="rail-label">{item.label}</span>
                <span className="rail-meta">
                  {item.id === "today" ? "Live" : ""}
                </span>
              </button>
            ))}
          </nav>

          <div className="rail-today">
            <div className="rail-block-head">
              <span>Today</span>
              <span>{activeChallenge?.date ?? "—"}</span>
            </div>
            <div className="rail-stat-row">
              <span>Rank</span>
              <strong>
                {currentEntry?.rank ? `#${currentEntry.rank}` : "—"}
              </strong>
            </div>
            <div className="rail-stat-row">
              <span>Best</span>
              <strong>
                {userBestTimeMs != null ? formatTimeMs(userBestTimeMs) : "—"}
              </strong>
            </div>
            <div className="rail-stat-row">
              <span>Streak</span>
              <strong>4 days</strong>
            </div>
            <button
              type="button"
              className="rail-share-btn"
              onClick={handleShare}
            >
              {shareLabel}
            </button>
          </div>

          <div
            className="rail-events"
            onPointerEnter={(event) => {
              if (event.pointerType === "mouse") setIsEventsOpen(true);
            }}
            onPointerLeave={(event) => {
              if (event.pointerType === "mouse") setIsEventsOpen(false);
            }}
            onBlur={(event) => {
              if (
                !event.currentTarget.contains(event.relatedTarget as Node | null)
              ) {
                setIsEventsOpen(false);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setIsEventsOpen(false);
              }
            }}
          >
            <span className="rail-block-label">Test build</span>
            <button
              type="button"
              className="rail-event-trigger"
              aria-haspopup="menu"
              aria-expanded={isEventsOpen}
              onClick={() => setIsEventsOpen((open) => !open)}
            >
              <span>
                {activeGame.index} / {activeGame.label}
              </span>
              <span className="rail-chevron">
                {isEventsOpen ? "▴" : "▾"}
              </span>
            </button>

            {isEventsOpen && (
              <div className="rail-events-menu" role="menu">
                {GAME_RAIL.map((game) => (
                  <button
                    key={game.id}
                    type="button"
                    role="menuitem"
                    className={`rail-event-item ${
                      selectedGame === game.id ? "active" : ""
                    }`}
                    onClick={() => {
                      setSelectedGame(game.id);
                      setActiveView("today");
                      setIsEventsOpen(false);
                    }}
                  >
                    <span>{game.index}</span>
                    <span>{game.label}</span>
                    <span>{game.meta}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rail-foot">
            <span>One challenge.</span>
            <span>One leaderboard.</span>
          </div>
        </aside>

        <main className="arena-main">
          {loadError && (
            <div className="arena-error">
              <strong>Offline</strong>
              <span>{loadError}. Start the backend with npm run dev:server.</span>
            </div>
          )}

          {activeView === "today" ? (
            <>
              <DailyInfo
                challenge={activeChallenge}
                eventIndex={activeGame.index}
              />

              {activeChallenge ? (
                <div className="arena-game-slot">
                  {selectedGame === "captcha" ? (
                    <CaptchaGame
                      key={`captcha-${activeChallenge.seed}`}
                      seed={activeChallenge.seed}
                      isFocusMode={isFocusMode}
                      onToggleFocus={() => setIsFocusMode((prev) => !prev)}
                      onRunFinished={handleRunFinished}
                    />
                  ) : selectedGame === "math" ? (
                    <MathSprint
                      key={`math-${activeChallenge.seed}`}
                      seed={activeChallenge.seed}
                      isFocusMode={isFocusMode}
                      onToggleFocus={() => setIsFocusMode((prev) => !prev)}
                      onRunFinished={handleRunFinished}
                    />
                  ) : selectedGame === "typing" ? (
                    <TypingGame
                      key={`typing-${activeChallenge.seed}`}
                      seed={activeChallenge.seed}
                      isFocusMode={isFocusMode}
                      onToggleFocus={() => setIsFocusMode((prev) => !prev)}
                      onRunFinished={handleRunFinished}
                    />
                  ) : selectedGame === "wordle" ? (
                    <WordleGame
                      key={`wordle-${activeChallenge.seed}`}
                      seed={activeChallenge.seed}
                      isFocusMode={isFocusMode}
                      onToggleFocus={() => setIsFocusMode((prev) => !prev)}
                      onRunFinished={handleRunFinished}
                    />
                  ) : selectedGame === "snake" ? (
                    <SnakeCanvas
                      key={`snake-${activeChallenge.seed}`}
                      seed={activeChallenge.seed}
                      isFocusMode={isFocusMode}
                      onToggleFocus={() => setIsFocusMode((prev) => !prev)}
                      onRunFinished={handleRunFinished}
                    />
                  ) : selectedGame === "game2048" ? (
                    <Game2048
                      key={`2048-${activeChallenge.seed}`}
                      seed={activeChallenge.seed}
                      isFocusMode={isFocusMode}
                      onToggleFocus={() => setIsFocusMode((prev) => !prev)}
                      onRunFinished={handleRunFinished}
                    />
                  ) : (
                    <MinesweeperGame
                      key={`minesweeper-${activeChallenge.seed}`}
                      seed={activeChallenge.seed}
                      isFocusMode={isFocusMode}
                      onToggleFocus={() => setIsFocusMode((prev) => !prev)}
                      onRunFinished={handleRunFinished}
                    />
                  )}
                </div>
              ) : (
                <div className="arena-loading">
                  <span className="arena-loading-bar" />
                  <span>Loading challenge feed</span>
                </div>
              )}

              <div className="arena-statusbar">
                <div className="status-cell">
                  <span>Seed</span>
                  <code>{activeChallenge?.seed ?? "—"}</code>
                </div>
                <div className="status-cell">
                  <span>Fair play</span>
                  <p>Edge replay · valid runs only</p>
                </div>
                <div className="status-cell">
                  <span>Keys</span>
                  <p>
                    <kbd>1–9</kbd> select <kbd>Enter</kbd> verify <kbd>F</kbd>{" "}
                    focus
                  </p>
                </div>
              </div>
            </>
          ) : (
            <ArenaPlaceholder
              view={activeView}
              onBack={() => setActiveView("today")}
            />
          )}
        </main>

        <aside className="arena-side">
          <Leaderboard
            entries={leaderboard}
            userBestTimeMs={userBestTimeMs}
            loading={loading}
          />

          <div className="arena-side-note">
            <span>Daily reset</span>
            <p>
              One challenge per day. The next feed replaces this one at 00:00
              UTC.
            </p>
          </div>
        </aside>
      </div>

      <NicknameModal
        currentNickname={nickname}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveNickname}
      />
    </div>
  );
};
