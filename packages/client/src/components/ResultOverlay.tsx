import React, { ReactNode } from "react";
import { formatTimeMs } from "../lib/storage.js";

export interface ResultStat {
  label: string;
  value: ReactNode;
  tone?: "default" | "success" | "warning";
}

interface ResultOverlayProps {
  variant: "win" | "lost" | "crashed" | "submitting";
  title: string;
  timeMs?: number;
  stats?: ResultStat[];
  rank?: number | null;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  children?: ReactNode;
  className?: string;
}

export const ResultOverlay: React.FC<ResultOverlayProps> = ({
  variant,
  title,
  timeMs,
  stats,
  rank,
  message,
  onRetry,
  retryLabel = "Beat Your Record",
  children,
  className,
}) => {
  const titleClass =
    variant === "win"
      ? "win"
      : variant === "lost" || variant === "crashed"
        ? "gameover"
        : "";

  return (
    <div className={`canvas-overlay result-overlay ${className ?? ""}`}>
      <h3 className={`overlay-title ${titleClass}`}>{title}</h3>

      {timeMs !== undefined && (
        <div className="overlay-time">{formatTimeMs(timeMs)}</div>
      )}

      {stats && stats.length > 0 && (
        <div className="overlay-stats">
          {stats.map((stat) => (
            <div key={stat.label} className="overlay-stat">
              <span className="overlay-stat-label">{stat.label}</span>
              <span
                className={`overlay-stat-value${stat.tone ? ` ${stat.tone}` : ""}`}
              >
                {stat.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {rank != null && rank > 0 && (
        <div className="overlay-rank-pill">Rank #{rank} · Today</div>
      )}

      {message && <p className="overlay-subtitle">{message}</p>}

      {children}

      {onRetry && (
        <button className="btn-primary" onClick={onRetry}>
          {retryLabel}{" "}
          <kbd className="keycap overlay-keycap">Space</kbd>
        </button>
      )}
    </div>
  );
};
