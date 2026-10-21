import React, { useState, useEffect, useCallback } from "react";
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
import { Leaderboard } from "./components/Leaderboard.js";
import { NicknameModal } from "./components/NicknameModal.js";

export const App: React.FC = () => {
  const [userId] = useState<string>(getOrCreateUserId);
  const [nickname, setNickname] = useState<string>(getSavedNickname);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isFocusMode, setIsFocusMode] = useState<boolean>(false);
  const [selectedGame, setSelectedGame] = useState<"typing" | "wordle" | "snake" | "game2048">("typing");

  const [challenge, setChallenge] = useState<ChallengeResponse | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [userBestTimeMs, setUserBestTimeMs] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load challenge and leaderboard for the active game
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const ch = await fetchTodayChallenge(undefined, selectedGame);
      setChallenge(ch);

      const lb = await fetchLeaderboard(ch.date, userId, selectedGame);
      setLeaderboard(lb.leaderboard);
      setUserBestTimeMs(lb.userBestTimeMs);
      setLoadError(null);
    } catch (err: any) {
      setLoadError(err.message || "Failed to connect to backend");
    } finally {
      setLoading(false);
    }
  }, [userId, selectedGame]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle run completion & submission (supports any game inputs)
  const handleRunFinished = async (
    claimedTimeMs: number,
    inputs: TimestampedInput<any>[]
  ) => {
    if (!challenge) {
      return { verified: false, error: "Challenge not loaded" };
    }

    try {
      const res = await submitRun({
        userId,
        nickname,
        date: challenge.date,
        gameId: challenge.gameId,
        timeMs: claimedTimeMs,
        inputs,
      });

      if (res.verified) {
        // Refresh leaderboard to reflect new rank
        const updatedLb = await fetchLeaderboard(challenge.date, userId, challenge.gameId);
        setLeaderboard(updatedLb.leaderboard);
        setUserBestTimeMs(updatedLb.userBestTimeMs);
      }

      return {
        verified: res.verified,
        rank: res.rank,
        error: res.reason ? `${res.error} (${res.reason})` : res.error || "Verification rejected",
      };
    } catch (err: any) {
      return {
        verified: false,
        error: err.message || "Failed to submit run",
      };
    }
  };

  // Handle nickname updates
  const handleSaveNickname = async (newName: string) => {
    saveNickname(newName);
    setNickname(newName);
    await updateNicknameOnServer(userId, newName);
    if (challenge) {
      const lb = await fetchLeaderboard(challenge.date, userId, challenge.gameId);
      setLeaderboard(lb.leaderboard);
    }
  };

  return (
    <div className={isFocusMode ? "focus-active" : ""}>
      {/* Soft Backdrop when Focus / Pop-Up Mode is Active */}
      <div
        className={`focus-backdrop ${isFocusMode ? "active" : ""}`}
        onClick={() => setIsFocusMode(false)}
      />

      <div className="app-container">
        <Header
          nickname={nickname}
          dateStr={challenge?.date}
          onEditNickname={() => setIsModalOpen(true)}
        />

        {loadError && (
          <div
            style={{
              padding: "12px 18px",
              background: "var(--accent-rose-light)",
              border: "1px solid var(--accent-rose)",
              borderRadius: "var(--radius-md)",
              color: "var(--accent-rose)",
              fontSize: "13px",
            }}
          >
            <strong>Notice:</strong> {loadError}. Start backend with{" "}
            <code>npm run dev:server</code>.
          </div>
        )}

        {/* HERO SECTION: Game of the day front-and-center */}
        <section className="hero-stage">
          {/* Game Switcher Tabs */}
          <div style={{ display: "flex", justifyContent: "center", width: "100%" }}>
            <div className="game-switcher" role="tablist" aria-label="Game Selection">
              <button
                type="button"
                role="tab"
                aria-selected={selectedGame === "typing"}
                className={`game-tab-btn ${selectedGame === "typing" ? "active" : ""}`}
                onClick={() => setSelectedGame("typing")}
              >
                <span>⌨️</span>
                <span>Typing Sprint</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={selectedGame === "wordle"}
                className={`game-tab-btn ${selectedGame === "wordle" ? "active" : ""}`}
                onClick={() => setSelectedGame("wordle")}
              >
                <span>🔤</span>
                <span>Wordle Sprint</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={selectedGame === "snake"}
                className={`game-tab-btn ${selectedGame === "snake" ? "active" : ""}`}
                onClick={() => setSelectedGame("snake")}
              >
                <span>🐍</span>
                <span>Snake Sprint</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={selectedGame === "game2048"}
                className={`game-tab-btn ${selectedGame === "game2048" ? "active" : ""}`}
                onClick={() => setSelectedGame("game2048")}
              >
                <span>🔢</span>
                <span>2048 Sprint</span>
              </button>
            </div>
          </div>

          <DailyInfo challenge={challenge} />

          {challenge ? (
            selectedGame === "typing" ? (
              <TypingGame
                key={`typing-${challenge.seed}`}
                seed={challenge.seed}
                isFocusMode={isFocusMode}
                onToggleFocus={() => setIsFocusMode((prev) => !prev)}
                onRunFinished={handleRunFinished}
              />
            ) : selectedGame === "wordle" ? (
              <WordleGame
                key={`wordle-${challenge.seed}`}
                seed={challenge.seed}
                isFocusMode={isFocusMode}
                onToggleFocus={() => setIsFocusMode((prev) => !prev)}
                onRunFinished={handleRunFinished}
              />
            ) : selectedGame === "snake" ? (
              <SnakeCanvas
                key={`snake-${challenge.seed}`}
                seed={challenge.seed}
                isFocusMode={isFocusMode}
                onToggleFocus={() => setIsFocusMode((prev) => !prev)}
                onRunFinished={handleRunFinished}
              />
            ) : (
              <Game2048
                key={`2048-${challenge.seed}`}
                seed={challenge.seed}
                isFocusMode={isFocusMode}
                onToggleFocus={() => setIsFocusMode((prev) => !prev)}
                onRunFinished={handleRunFinished}
              />
            )
          ) : (
            <div
              className="game-card"
              style={{ padding: "80px", textAlign: "center", color: "var(--text-tertiary)" }}
            >
              Loading challenge...
            </div>
          )}
        </section>

        {/* SUBORDINATE SECTION: Leaderboard & Meta Information */}
        <section className="subordinate-section">
          <Leaderboard
            entries={leaderboard}
            currentUserId={userId}
            userBestTimeMs={userBestTimeMs}
            loading={loading}
          />

          <div className="meta-card">
            <div className="meta-block">
              <span className="meta-label">Authoritative Seed</span>
              <span className="meta-val mono">
                {challenge ? challenge.seed : "..."}
              </span>
            </div>

            <div className="meta-block">
              <span className="meta-label">Fair Play Anti-Cheat</span>
              <span className="meta-val">
                The edge server replays your exact guesses/turns against today's seed.
                Only authentic, solved runs rank on the leaderboard.
              </span>
            </div>

            <div className="meta-block">
              <span className="meta-label">Shortcuts</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "4px" }}>
                <span className="keycap">Space</span>
                <span className="keycap">Enter</span>
                <span style={{ fontSize: "12px", color: "var(--text-secondary)", alignSelf: "center" }}>
                  Restart
                </span>
                <span className="keycap" style={{ marginLeft: "8px" }}>F</span>
                <span style={{ fontSize: "12px", color: "var(--text-secondary)", alignSelf: "center" }}>
                  Focus Mode
                </span>
              </div>
            </div>
          </div>
        </section>
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
