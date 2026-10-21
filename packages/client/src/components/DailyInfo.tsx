import React, { useState, useEffect } from "react";
import { ChallengeResponse } from "../lib/api.js";

interface DailyInfoProps {
  challenge: ChallengeResponse | null;
}

export const DailyInfo: React.FC<DailyInfoProps> = ({ challenge }) => {
  const [countdown, setCountdown] = useState<string>("");

  useEffect(() => {
    function updateCountdown() {
      const now = new Date();
      const tomorrowUTC = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0)
      );
      const diffMs = tomorrowUTC.getTime() - now.getTime();

      if (diffMs <= 0) {
        setCountdown("Resetting...");
        return;
      }

      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);

      const hh = String(hours).padStart(2, "0");
      const mm = String(minutes).padStart(2, "0");
      const ss = String(seconds).padStart(2, "0");

      setCountdown(`${hh}:${mm}:${ss}`);
    }

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, []);

  if (!challenge) return null;

  return (
    <div className="hero-meta-bar">
      <div className="hero-challenge-info">
        <div className="hero-title-row">
          <h2 className="hero-challenge-title">{challenge.name}</h2>
          <span className="hero-target-pill">{challenge.targetDescription}</span>
        </div>
        <p className="hero-desc">{challenge.description}</p>
      </div>

      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--text-tertiary)", fontWeight: 700 }}>
          Resets in
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "14px", fontWeight: 700, color: "var(--accent-sky)" }}>
          {countdown}
        </div>
      </div>
    </div>
  );
};
