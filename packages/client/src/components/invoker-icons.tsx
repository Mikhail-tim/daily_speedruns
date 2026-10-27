import React, { useId } from "react";
import { OrbType, SpellId, ALL_SPELLS } from "@daily-speedruns/shared";

/**
 * Invoker-icon set.
 *
 * Every icon is original vector art drawn to read at 22 px (combo rail) up to
 * 72 px (active target). Each spell tile is tinted by the orbs in its recipe,
 * so the colour of a tile tells you what to press: blue = Quas, magenta = Wex,
 * orange = Exort, and mixes fade between them.
 */

const ELEMENTS: Record<
  OrbType,
  { light: string; mid: string; deep: string; glow: string }
> = {
  Q: { light: "#bae6fd", mid: "#38bdf8", deep: "#082f49", glow: "#0ea5e9" },
  W: { light: "#f5d0fe", mid: "#d946ef", deep: "#2a0242", glow: "#a855f7" },
  E: { light: "#fed7aa", mid: "#f97316", deep: "#3b0a05", glow: "#ef4444" },
};

function orbMix(recipe: readonly OrbType[]) {
  const counts: Record<OrbType, number> = { Q: 0, W: 0, E: 0 };
  for (const orb of recipe) counts[orb]++;
  // Dominant element decides the tile colour; ties blend.
  const ranked = (Object.keys(counts) as OrbType[]).sort(
    (a, b) => counts[b] - counts[a]
  );
  return { primary: ranked[0], secondary: ranked[1], counts };
}

interface IconProps {
  size?: number | string;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}

/* ------------------------------------------------------------------ orbs */

const OrbBase: React.FC<
  IconProps & { kind: OrbType; glyph: React.ReactNode }
> = ({ kind, glyph, size = 48, className, style, title }) => {
  const uid = useId().replace(/:/g, "");
  const el = ELEMENTS[kind];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      style={style}
      role="img"
      aria-label={title}
    >
      <defs>
        <radialGradient id={`orb-${uid}`} cx="38%" cy="30%" r="72%">
          <stop offset="0%" stopColor={el.light} />
          <stop offset="45%" stopColor={el.mid} />
          <stop offset="100%" stopColor={el.deep} />
        </radialGradient>
        <radialGradient id={`orb-glow-${uid}`} cx="50%" cy="50%" r="50%">
          <stop offset="60%" stopColor={el.glow} stopOpacity="0.55" />
          <stop offset="100%" stopColor={el.glow} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="30" fill={`url(#orb-glow-${uid})`} />
      <circle cx="32" cy="32" r="25" fill={`url(#orb-${uid})`} />
      <circle
        cx="32"
        cy="32"
        r="25"
        stroke={el.light}
        strokeOpacity="0.55"
        strokeWidth="1.5"
      />
      <ellipse
        cx="24"
        cy="20"
        rx="9"
        ry="6"
        fill="#ffffff"
        opacity="0.28"
        transform="rotate(-25 24 20)"
      />
      <g>{glyph}</g>
    </svg>
  );
};

export const QuasIcon: React.FC<IconProps> = (props) => (
  <OrbBase
    kind="Q"
    title="Quas"
    {...props}
    glyph={
      <g stroke="#f0f9ff" strokeWidth="2.4" strokeLinecap="round">
        <path d="M32 18v28M19 25l26 14M45 25L19 39" />
        <path d="M32 18l4 5M32 18l-4 5M32 46l4-5M32 46l-4-5" />
        <circle cx="32" cy="32" r="3.4" fill="#f0f9ff" stroke="none" />
      </g>
    }
  />
);

export const WexIcon: React.FC<IconProps> = (props) => (
  <OrbBase
    kind="W"
    title="Wex"
    {...props}
    glyph={
      <g>
        <path
          d="M35 17L23 35h8l-3 12 13-19h-9l3-11z"
          fill="#fdf4ff"
          stroke="#fdf4ff"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </g>
    }
  />
);

export const ExortIcon: React.FC<IconProps> = (props) => (
  <OrbBase
    kind="E"
    title="Exort"
    {...props}
    glyph={
      <g>
        <path
          d="M33 17c1 6 7 8 7 15 0 5-4 9-9 9s-9-4-9-9c0-4 2-6 4-9 0 3 1 5 3 6 0-5 2-8 4-12z"
          fill="#fff7ed"
        />
        <path
          d="M32 30c1 3 4 4 4 7 0 2-2 4-4 4s-4-2-4-4c0-2 1-3 2-4 0 1 1 2 1 2 0-2 1-3 1-5z"
          fill="#fb923c"
        />
      </g>
    }
  />
);

export const InvokeIcon: React.FC<IconProps> = (props) => {
  const uid = useId().replace(/:/g, "");
  const { size = 48, className, style, title } = props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      style={style}
      role="img"
      aria-label={title ?? "Invoke"}
    >
      <defs>
        <linearGradient id={`inv-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1e1b4b" />
          <stop offset="100%" stopColor="#0b1020" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill={`url(#inv-${uid})`} />
      <rect
        x="1"
        y="1"
        width="62"
        height="62"
        rx="13"
        stroke="#c4b5fd"
        strokeOpacity="0.35"
        strokeWidth="1.5"
      />
      <circle
        cx="32"
        cy="32"
        r="18"
        stroke="#e9d5ff"
        strokeOpacity="0.55"
        strokeWidth="1.5"
        strokeDasharray="5 4"
      />
      <circle cx="32" cy="32" r="10" stroke="#f5d0fe" strokeWidth="1.5" />
      <path
        d="M32 16l4.5 11.5L48 32l-11.5 4.5L32 48l-4.5-11.5L16 32l11.5-4.5z"
        fill="#faf5ff"
        fillOpacity="0.92"
      />
      <circle cx="32" cy="32" r="3" fill="#7c3aed" />
    </svg>
  );
};

/* ---------------------------------------------------------------- spells */

type GlyphProps = { color: string; accent: string };

const GLYPHS: Record<SpellId, (p: GlyphProps) => React.ReactNode> = {
  "cold-snap": ({ color }) => (
    <g stroke={color} strokeWidth="2.6" strokeLinecap="round" fill="none">
      <path d="M32 14v36M17 23l30 18M47 23L17 41" />
      <path d="M28 17l4 4 4-4M28 47l4-4 4 4" />
      <circle cx="32" cy="32" r="4.5" fill={color} stroke="none" />
    </g>
  ),
  "ghost-walk": ({ color }) => (
    <g>
      <path
        d="M32 12c-9 0-15 7-15 16 0 8 3 15 4 21l4-4 4 4 3-4 3 4 4-4 4 4c1-6 4-13 4-21 0-9-6-16-15-16z"
        fill={color}
        fillOpacity="0.92"
      />
      <circle cx="26" cy="29" r="3.4" fill="#0b1020" />
      <circle cx="38" cy="29" r="3.4" fill="#0b1020" />
    </g>
  ),
  "ice-wall": ({ color }) => (
    <g fill={color}>
      <path d="M14 52l7-24 7 24z" fillOpacity="0.75" />
      <path d="M25 52l7-34 7 34z" />
      <path d="M36 52l7-22 7 22z" fillOpacity="0.75" />
      <rect x="12" y="50" width="40" height="4" rx="2" />
    </g>
  ),
  emp: ({ color }) => (
    <g fill="none" stroke={color} strokeLinecap="round">
      <circle cx="32" cy="32" r="17" strokeWidth="2.4" strokeDasharray="6 5" />
      <path
        d="M34 18l-9 16h7l-2 12 11-17h-8z"
        fill={color}
        stroke="none"
      />
    </g>
  ),
  tornado: ({ color }) => (
    <g stroke={color} strokeWidth="2.8" strokeLinecap="round" fill="none">
      <path d="M14 18h36" />
      <path d="M18 27h27" />
      <path d="M23 36h18" />
      <path d="M27 45h10" />
      <path d="M31 53h4" />
    </g>
  ),
  alacrity: ({ color, accent }) => (
    <g>
      <path d="M34 13l-11 19h8l-3 15 13-20h-9z" fill={color} />
      <path
        d="M16 30l6-6 6 6M36 44l6 6 6-6"
        stroke={accent}
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </g>
  ),
  "sun-strike": ({ color }) => (
    <g>
      <circle cx="32" cy="24" r="9" fill={color} />
      <g stroke={color} strokeWidth="2.6" strokeLinecap="round">
        <path d="M32 8v5M18 24h-5M51 24h-5M22 14l3.5 3.5M42 14l-3.5 3.5" />
        <path d="M32 36v18" strokeWidth="3.4" opacity="0.8" />
      </g>
    </g>
  ),
  "forge-spirit": ({ color, accent }) => (
    <g>
      <path
        d="M32 11c2 9 11 12 11 23 0 8-6 14-11 17-5-3-11-9-11-17 0-11 9-14 11-23z"
        fill={color}
      />
      <path
        d="M32 27c1 4 5 6 5 11 0 4-3 7-5 8-2-1-5-4-5-8 0-5 4-7 5-11z"
        fill={accent}
      />
      <circle cx="28" cy="38" r="2" fill="#0b1020" />
      <circle cx="36" cy="38" r="2" fill="#0b1020" />
    </g>
  ),
  "chaos-meteor": ({ color, accent }) => (
    <g>
      <path
        d="M12 12l16 10-6 6zM20 8l14 12-5 5z"
        fill={accent}
        opacity="0.85"
      />
      <circle cx="40" cy="42" r="14" fill={color} />
      <circle cx="40" cy="42" r="8" fill={accent} />
      <circle cx="37" cy="39" r="3.4" fill="#fff7ed" />
    </g>
  ),
  "deafening-blast": ({ color }) => (
    <g fill="none" stroke={color} strokeLinecap="round">
      <circle cx="15" cy="32" r="4" fill={color} stroke="none" />
      <path d="M25 21a15 15 0 010 22" strokeWidth="3" />
      <path d="M35 15a24 24 0 010 34" strokeWidth="3" opacity="0.8" />
      <path d="M45 9a33 33 0 010 46" strokeWidth="3" opacity="0.55" />
    </g>
  ),
};

export const SpellIcon: React.FC<{
  id: SpellId;
  size?: number | string;
  className?: string;
  style?: React.CSSProperties;
}> = ({ id, size = 54, className, style }) => {
  const uid = useId().replace(/:/g, "");
  const spell = ALL_SPELLS[id];
  const { primary, secondary } = orbMix(spell.recipe);
  const a = ELEMENTS[primary];
  const b = ELEMENTS[secondary];
  const draw = GLYPHS[id];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      style={style}
      role="img"
      aria-label={spell.name}
    >
      <defs>
        <linearGradient id={`bg-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={a.deep} />
          <stop offset="100%" stopColor={b.deep} />
        </linearGradient>
        <radialGradient id={`shine-${uid}`} cx="50%" cy="18%" r="70%">
          <stop offset="0%" stopColor={a.mid} stopOpacity="0.45" />
          <stop offset="100%" stopColor={a.mid} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" rx="12" fill={`url(#bg-${uid})`} />
      <rect width="64" height="64" rx="12" fill={`url(#shine-${uid})`} />
      <rect
        x="1"
        y="1"
        width="62"
        height="62"
        rx="11"
        stroke={a.light}
        strokeOpacity="0.4"
        strokeWidth="1.5"
      />
      {draw({ color: "#f8fafc", accent: a.light })}
    </svg>
  );
};

export const ORB_ICONS: Record<OrbType, React.FC<IconProps>> = {
  Q: QuasIcon,
  W: WexIcon,
  E: ExortIcon,
};

export const ORB_NAMES: Record<OrbType, string> = {
  Q: "Quas",
  W: "Wex",
  E: "Exort",
};
