import React from "react";
import { LeaderboardEntry } from "@daily-speedruns/shared";
import { formatTimeMs } from "../lib/storage.js";

interface LeaderboardProps {
  entries: LeaderboardEntry[];
  currentUserId: string;
  userBestTimeMs: number | null;
  loading: boolean;
}

export const Leaderboard: React.FC<LeaderboardProps> = ({
  entries,
  currentUserId,
  userBestTimeMs,
  loading,
}) => {
  return (
    <div className="leaderboard-card">
      <div className="card-header">
        <h3 className="card-title">
          <span>🏆</span>
          <span>Rankings</span>
        </h3>
        {userBestTimeMs != null && (
          <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
            Your Best:{" "}
            <strong
              style={{
                color: "var(--accent-emerald)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {formatTimeMs(userBestTimeMs)}
            </strong>
          </span>
        )}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th style={{ width: "40px" }}>#</th>
              <th>Runner</th>
              <th style={{ textAlign: "right" }}>Verified Time</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={3} className="empty-leaderboard">
                  {loading
                    ? "Loading rankings..."
                    : "No verified runs yet today. Claim #1!"}
                </td>
              </tr>
            ) : (
              entries.map((entry, idx) => {
                const rank = idx + 1;
                const isUser = entry.userId === currentUserId;
                const rankClass =
                  rank === 1
                    ? "rank-1"
                    : rank === 2
                    ? "rank-2"
                    : rank === 3
                    ? "rank-3"
                    : "rank-default";

                return (
                  <tr
                    key={entry.id}
                    className={`leaderboard-row ${
                      isUser ? "is-current-user" : ""
                    }`}
                  >
                    <td>
                      <span className={`rank-badge ${rankClass}`}>{rank}</span>
                    </td>
                    <td>
                      <span className="runner-name">
                        {entry.nickname}
                        {isUser && (
                          <span
                            style={{
                              fontSize: "10px",
                              padding: "1px 5px",
                              background: "var(--accent-emerald-light)",
                              border: "1px solid var(--accent-emerald-border)",
                              borderRadius: "4px",
                              color: "var(--accent-emerald)",
                              fontWeight: 700,
                            }}
                          >
                            YOU
                          </span>
                        )}
                        <span
                          className="verified-icon"
                          title="Server Replay Verified"
                        >
                          ✓
                        </span>
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <span className="time-cell">
                        {formatTimeMs(entry.timeMs)}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
