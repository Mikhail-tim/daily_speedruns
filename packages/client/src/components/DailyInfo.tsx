import React, { useState, useEffect } from "react";
import { ChallengeResponse } from "../lib/api.js";

interface DailyInfoProps {
  challenge: ChallengeResponse | null;
  eventIndex?: string;
}

export const DailyInfo: React.FC<DailyInfoProps> = ({
  challenge,
  eventIndex = "01",
}) => {
  const [countdown, setCountdown] = useState<string>("");

  useEffect(() => {
    function updateCountdown() {
      const now = new Date();
      const tomorrowUTC = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() + 1,
          0,
          0,
          0
        )
      );
      const diffMs = tomorrowUTC.getTime() - now.getTime();

      if (diffMs <= 0) {
        setCountdown("00:00:00");
        return;
      }

      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);

      setCountdown(
        `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
          2,
          "0"
        )}:${String(seconds).padStart(2, "0")}`
      );
    }

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, []);

  if (!challenge) return null;

  return (
    <div className="arena-event-head">
      <div className="arena-event-title">
        <span className="arena-event-kicker">
          Event {eventIndex} / Daily
        </span>
        <h1 className="arena-event-name">{challenge.name}</h1>
        <div className="arena-event-sub">
          <span className="arena-target-tag">{challenge.targetDescription}</span>
          <p className="arena-event-desc">{challenge.description}</p>
        </div>
      </div>

      <div className="arena-countdown">
        <span>{challenge.date} · UTC</span>
        <span>Resets in</span>
        <strong>{countdown}</strong>
      </div>
    </div>
  );
};
