import React from "react";

export type PlaceholderView = "archive" | "seasons" | "runs" | "rules";

interface ArenaPlaceholderProps {
  view: PlaceholderView;
  onBack: () => void;
}

const VIEW_COPY: Record<
  PlaceholderView,
  { index: string; label: string; title: string; description: string }
> = {
  archive: {
    index: "02",
    label: "Archive",
    title: "Archive",
    description:
      "Every past daily challenge, leaderboard, and verified replay. Browse by day.",
  },
  seasons: {
    index: "03",
    label: "Seasons",
    title: "Seasons",
    description:
      "Cumulative standings across the current season and every season before it.",
  },
  runs: {
    index: "04",
    label: "My runs",
    title: "My runs",
    description:
      "Your personal history, best times, streaks, and category stats.",
  },
  rules: {
    index: "05",
    label: "Rules",
    title: "Rules",
    description:
      "One deterministic challenge per UTC day. One replay-verified leaderboard.",
  },
};

const RECENT_DAYS = [
  { day: "20", game: "Wordle", time: "00:09.840" },
  { day: "19", game: "Snake", time: "00:41.200" },
  { day: "18", game: "reCAPTCHA", time: "00:18.119" },
  { day: "17", game: "Typing", time: "00:52.774" },
];

const SEASON_ROWS = [
  { rank: "01", name: "KeyMaster99", points: "1,842", days: "21" },
  { rank: "02", name: "mogged", points: "1,711", days: "20" },
  { rank: "03", name: "EulerSpeed", points: "1,644", days: "21" },
  { rank: "04", name: "WordWizard", points: "1,502", days: "19" },
  { rank: "05", name: "PixelPilot", points: "1,438", days: "18" },
];

export const ArenaPlaceholder: React.FC<ArenaPlaceholderProps> = ({
  view,
  onBack,
}) => {
  const copy = VIEW_COPY[view];

  return (
    <section className="arena-placeholder">
      <div className="arena-event-head">
        <div className="arena-event-title">
          <span className="arena-event-kicker">
            Section {copy.index} / {copy.label}
          </span>
          <h1 className="arena-event-name">{copy.title}</h1>
          <div className="arena-event-sub">
            <span className="arena-target-tag">Preview</span>
            <p className="arena-event-desc">{copy.description}</p>
          </div>
        </div>

        <button className="arena-back-btn" type="button" onClick={onBack}>
          Back to today
        </button>
      </div>

      <div className="arena-placeholder-panel">
        {view === "archive" && (
          <>
            <div className="arena-calendar">
              <div className="arena-calendar-head">
                <span>October 2026</span>
                <span>20 / 21 played</span>
              </div>
              <div className="arena-calendar-grid arena-calendar-weekdays">
                {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
                  <span key={`${day}-${index}`}>{day}</span>
                ))}
              </div>
              <div className="arena-calendar-grid">
                {Array.from({ length: 31 }, (_, index) => {
                  const day = index + 1;
                  const played = day < 21;
                  return (
                    <span
                      key={day}
                      className={`arena-calendar-day ${
                        played ? "played" : ""
                      } ${day === 21 ? "today" : ""}`}
                    >
                      {day}
                    </span>
                  );
                })}
              </div>
            </div>

            <div className="arena-mini-list">
              <div className="arena-mini-head">
                <span>Recent challenges</span>
                <span>Best</span>
              </div>
              {RECENT_DAYS.map((entry) => (
                <div className="arena-mini-row" key={entry.day}>
                  <span className="arena-mini-date">Oct {entry.day}</span>
                  <span>{entry.game}</span>
                  <span className="arena-mini-time">{entry.time}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {view === "seasons" && (
          <>
            <div className="arena-season-summary">
              <div>
                <span>Current season</span>
                <strong>Season 01</strong>
              </div>
              <div>
                <span>Days left</span>
                <strong>12</strong>
              </div>
              <div>
                <span>Your rank</span>
                <strong>#34</strong>
              </div>
              <div>
                <span>Points</span>
                <strong>1,208</strong>
              </div>
            </div>

            <div className="arena-mini-list">
              <div className="arena-mini-head">
                <span>Standings</span>
                <span>Points</span>
              </div>
              {SEASON_ROWS.map((row) => (
                <div className="arena-mini-row" key={row.rank}>
                  <span className="arena-mini-date">{row.rank}</span>
                  <span>{row.name}</span>
                  <span className="arena-mini-time">{row.points}</span>
                </div>
              ))}
              <div className="arena-mini-row is-you">
                <span className="arena-mini-date">34</span>
                <span>You</span>
                <span className="arena-mini-time">1,208</span>
              </div>
            </div>
          </>
        )}

        {view === "runs" && (
          <>
            <div className="arena-run-stats-grid">
              <div>
                <span>Best today</span>
                <strong>—</strong>
              </div>
              <div>
                <span>Verified runs</span>
                <strong>0</strong>
              </div>
              <div>
                <span>Current streak</span>
                <strong>4 days</strong>
              </div>
              <div>
                <span>Season rank</span>
                <strong>#34</strong>
              </div>
            </div>

            <div className="arena-mini-list">
              <div className="arena-mini-head">
                <span>Recent runs</span>
                <span>Time</span>
              </div>
              {RECENT_DAYS.map((entry) => (
                <div className="arena-mini-row" key={entry.day}>
                  <span className="arena-mini-date">Oct {entry.day}</span>
                  <span>{entry.game}</span>
                  <span className="arena-mini-time">{entry.time}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {view === "rules" && (
          <div className="arena-rules-list">
            <div>
              <span>01</span>
              <p>
                One deterministic challenge is published for every UTC day.
                Everyone plays the same seed.
              </p>
            </div>
            <div>
              <span>02</span>
              <p>
                The client records timestamped inputs. The edge server replays
                them against the authoritative seed.
              </p>
            </div>
            <div>
              <span>03</span>
              <p>
                Only runs that reproduce a valid result are stored on the
                leaderboard. Replay-verified is not the same as bot-proof.
              </p>
            </div>
            <div>
              <span>04</span>
              <p>
                Writes are protected by a local runner token. Never share your
                token or run as another identity.
              </p>
            </div>
            <div>
              <span>05</span>
              <p>
                The next feed replaces this one at 00:00 UTC. Seasons accumulate
                daily points across challenges.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
