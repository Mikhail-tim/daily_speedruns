import React, { ReactNode } from "react";

export interface HudStat {
  label: string;
  value: ReactNode;
  align?: "left" | "center" | "right";
  tone?: "default" | "highlight" | "danger" | "timer";
}

interface GameHudProps {
  stats: HudStat[];
}

export const GameHud: React.FC<GameHudProps> = ({ stats }) => (
  <div className="game-hud">
    {stats.map((stat, index) => (
      <div
        key={`${stat.label}-${index}`}
        className="hud-stat"
        style={stat.align ? { textAlign: stat.align } : undefined}
      >
        <span className="hud-label">{stat.label}</span>
        <span
          className={`hud-value${
            stat.tone && stat.tone !== "default" ? ` ${stat.tone}` : ""
          }`}
        >
          {stat.value}
        </span>
      </div>
    ))}
  </div>
);
