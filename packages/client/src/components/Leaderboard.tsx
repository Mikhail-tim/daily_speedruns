import React from "react";
import { LeaderboardEntry } from "@daily-speedruns/shared";
import { formatTimeMs } from "../lib/storage.js";

interface LeaderboardProps {
  entries: LeaderboardEntry[];
  userBestTimeMs: number | null;
  loading: boolean;
}

export const Leaderboard: React.FC<LeaderboardProps> = ({
  entries,
  userBestTimeMs,
  loading,
}) => {
  return (
    <section className="tower-card">
      <div className="tower-head">
        <div>
          <span className="tower-kicker">Live standings</span>
          <h2>Timing Tower</h2>
        </div>
        <span className="tower-count">
          {entries.length ? `${entries.length} verified` : "00"}
        </span>
      </div>

      {userBestTimeMs != null && (
        <div className="tower-best">
          <span>Your best</span>
          <strong>{formatTimeMs(userBestTimeMs)}</strong>
        </div>
      )}

      <div className="tower-columns">
        <span>#</span>
        <span>Runner</span>
        <span>Time</span>
      </div>

      {entries.length === 0 ? (
        <div className="tower-empty">
          <span className="tower-empty-mark">—</span>
          <p>{loading ? "Loading standings" : "No verified runs yet"}</p>
          <span>{loading ? "Fetching today's times" : "Claim the first slot."}</span>
        </div>
      ) : (
        <ol className="tower-list">
          {entries.map((entry, index) => {
            const rank = index + 1;
            const isUser = entry.isCurrentUser === true;

            return (
              <li
                key={entry.id}
                className={`tower-row ${
                  rank <= 3 ? `tower-podium-${rank}` : ""
                } ${isUser ? "is-user" : ""}`}
              >
                <span className="tower-rank">
                  {String(rank).padStart(2, "0")}
                </span>
                <span className="tower-name">
                  {entry.nickname}
                  {isUser && <em>You</em>}
                </span>
                <span className="tower-time">{formatTimeMs(entry.timeMs)}</span>
              </li>
            );
          })}
        </ol>
      )}

      <div className="tower-foot">
        <span>Verified by replay</span>
        <span>Top 100</span>
      </div>
    </section>
  );
};
