import React from "react";
import { SpellId } from "@daily-speedruns/shared";

interface IconProps {
  size?: number | string;
  className?: string;
  style?: React.CSSProperties;
}

export const QuasIcon: React.FC<IconProps> = ({ size = 48, className, style }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={style}
  >
    <defs>
      <radialGradient id="quas-glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#cffafe" />
        <stop offset="40%" stopColor="#38bdf8" />
        <stop offset="85%" stopColor="#0284c7" />
        <stop offset="100%" stopColor="#0369a1" />
      </radialGradient>
      <filter id="quas-blur" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="3" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>
    </defs>
    <circle cx="32" cy="32" r="28" fill="#082f49" stroke="#38bdf8" strokeWidth="2" />
    <circle cx="32" cy="32" r="24" fill="url(#quas-glow)" filter="url(#quas-blur)" />
    {/* Ice Crystal Shards */}
    <path
      d="M32 14L36 26L48 30L38 36L40 48L32 40L24 48L26 36L16 30L28 26Z"
      fill="#ffffff"
      opacity="0.85"
    />
    <circle cx="28" cy="26" r="3" fill="#ffffff" opacity="0.9" />
  </svg>
);

export const WexIcon: React.FC<IconProps> = ({ size = 48, className, style }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={style}
  >
    <defs>
      <radialGradient id="wex-glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#fdf4ff" />
        <stop offset="35%" stopColor="#e879f9" />
        <stop offset="80%" stopColor="#c026d3" />
        <stop offset="100%" stopColor="#701a75" />
      </radialGradient>
      <filter id="wex-blur" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="3" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>
    </defs>
    <circle cx="32" cy="32" r="28" fill="#3b0764" stroke="#e879f9" strokeWidth="2" />
    <circle cx="32" cy="32" r="24" fill="url(#wex-glow)" filter="url(#wex-blur)" />
    {/* Storm Lightning Bolt */}
    <path
      d="M35 12L20 32H32L27 52L44 28H31L35 12Z"
      fill="#ffffff"
      opacity="0.9"
    />
    <circle cx="36" cy="24" r="2.5" fill="#ffffff" opacity="0.95" />
  </svg>
);

export const ExortIcon: React.FC<IconProps> = ({ size = 48, className, style }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={style}
  >
    <defs>
      <radialGradient id="exort-glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#fffbeb" />
        <stop offset="35%" stopColor="#f59e0b" />
        <stop offset="75%" stopColor="#dc2626" />
        <stop offset="100%" stopColor="#7f1d1d" />
      </radialGradient>
      <filter id="exort-blur" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="3" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>
    </defs>
    <circle cx="32" cy="32" r="28" fill="#450a0a" stroke="#fbbf24" strokeWidth="2" />
    <circle cx="32" cy="32" r="24" fill="url(#exort-glow)" filter="url(#exort-blur)" />
    {/* Blazing Flame Core */}
    <path
      d="M32 14C32 14 39 23 39 30C39 34 36 38 32 46C28 38 25 34 25 30C25 23 32 14 32 14Z"
      fill="#ffffff"
      opacity="0.9"
    />
    <path
      d="M32 26C32 26 36 32 36 35C36 37 34 40 32 44C30 40 28 37 28 35C28 32 32 26 32 26Z"
      fill="#fef08a"
    />
  </svg>
);

export const InvokeIcon: React.FC<IconProps> = ({ size = 48, className, style }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={style}
  >
    <defs>
      <radialGradient id="invoke-glow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#fef08a" />
        <stop offset="45%" stopColor="#a855f7" />
        <stop offset="90%" stopColor="#3b0764" />
      </radialGradient>
    </defs>
    <rect x="4" y="4" width="56" height="56" rx="10" fill="#1e1035" stroke="#c084fc" strokeWidth="2" />
    <circle cx="32" cy="32" r="22" fill="url(#invoke-glow)" opacity="0.6" />
    {/* Arcane Ring & Runes */}
    <circle cx="32" cy="32" r="18" stroke="#fef08a" strokeWidth="2" strokeDasharray="6 3" />
    <circle cx="32" cy="32" r="10" stroke="#fef08a" strokeWidth="1.5" />
    <path d="M32 14V50M14 32H50" stroke="#ffffff" strokeWidth="2" opacity="0.8" />
    <polygon points="32,20 42,32 32,44 22,32" fill="#fef08a" opacity="0.85" />
  </svg>
);

export const SpellIcon: React.FC<{ id: SpellId; size?: number | string; className?: string }> = ({
  id,
  size = 54,
  className,
}) => {
  switch (id) {
    case "cold-snap":
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={className}>
          <rect width="64" height="64" rx="8" fill="#082f49" stroke="#38bdf8" strokeWidth="2" />
          <path d="M22 18H42L48 28L32 50L16 28L22 18Z" fill="#38bdf8" opacity="0.35" />
          <path d="M32 14L38 28L52 32L40 40L42 54L32 44L22 54L24 40L12 32L26 28L32 14Z" fill="#bae6fd" />
          <circle cx="32" cy="32" r="5" fill="#ffffff" />
        </svg>
      );
    case "ghost-walk":
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={className}>
          <rect width="64" height="64" rx="8" fill="#1e1b4b" stroke="#818cf8" strokeWidth="2" />
          <path
            d="M32 14C24 14 18 20 18 28C18 36 22 46 22 52L27 48L32 52L37 48L42 52C42 46 46 36 46 28C46 20 40 14 32 14Z"
            fill="#a5b4fc"
            opacity="0.85"
          />
          <circle cx="27" cy="27" r="3.5" fill="#c7d2fe" />
          <circle cx="37" cy="27" r="3.5" fill="#c7d2fe" />
          <circle cx="27" cy="27" r="1.5" fill="#1e1b4b" />
          <circle cx="37" cy="27" r="1.5" fill="#1e1b4b" />
        </svg>
      );
    case "ice-wall":
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={className}>
          <rect width="64" height="64" rx="8" fill="#0c4a6e" stroke="#0284c7" strokeWidth="2" />
          {/* Jagged Ice Spikes */}
          <path d="M12 52L18 24L24 52L32 16L40 52L46 22L52 52Z" fill="#7dd3fc" />
          <path d="M16 52L22 32L28 52L32 24L36 52L42 30L48 52Z" fill="#ffffff" opacity="0.9" />
          <rect x="8" y="50" width="48" height="6" fill="#38bdf8" />
        </svg>
      );
    case "emp":
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={className}>
          <rect width="64" height="64" rx="8" fill="#3b0764" stroke="#d946ef" strokeWidth="2" />
          <circle cx="32" cy="32" r="22" stroke="#f0abfc" strokeWidth="2" strokeDasharray="4 4" />
          <circle cx="32" cy="32" r="14" fill="#c026d3" opacity="0.7" />
          <circle cx="32" cy="32" r="6" fill="#ffffff" />
          <path d="M32 10V20M32 44V54M10 32H20M44 32H54" stroke="#f5d0fe" strokeWidth="3" strokeLinecap="round" />
        </svg>
      );
    case "tornado":
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={className}>
          <rect width="64" height="64" rx="8" fill="#1e293b" stroke="#38bdf8" strokeWidth="2" />
          {/* Swirling funnel */}
          <path d="M14 16H50L44 24H20L14 16Z" fill="#bae6fd" />
          <path d="M18 26H46L41 33H23L18 26Z" fill="#7dd3fc" />
          <path d="M23 35H41L37 42H27L23 35Z" fill="#38bdf8" />
          <path d="M28 44H36L34 52H30L28 44Z" fill="#ffffff" />
        </svg>
      );
    case "alacrity":
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={className}>
          <rect width="64" height="64" rx="8" fill="#4a044e" stroke="#e879f9" strokeWidth="2" />
          {/* Twin Energy Blades */}
          <path d="M20 50L30 14L34 18L26 52L20 50Z" fill="#f472b6" />
          <path d="M44 50L34 14L30 18L38 52L44 50Z" fill="#fb7185" />
          <polygon points="32,20 36,32 32,44 28,32" fill="#ffffff" />
        </svg>
      );
    case "sun-strike":
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={className}>
          <rect width="64" height="64" rx="8" fill="#450a0a" stroke="#fbbf24" strokeWidth="2" />
          {/* Blinding Ray from heaven */}
          <polygon points="32,6 40,42 24,42" fill="#fef08a" />
          <polygon points="32,14 36,44 28,44" fill="#ffffff" />
          <ellipse cx="32" cy="46" rx="18" ry="6" fill="#f59e0b" />
          <ellipse cx="32" cy="46" rx="12" ry="4" fill="#ffffff" />
        </svg>
      );
    case "forge-spirit":
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={className}>
          <rect width="64" height="64" rx="8" fill="#311108" stroke="#ea580c" strokeWidth="2" />
          {/* Fiery Elemental Visage */}
          <path
            d="M32 12C38 20 46 26 46 36C46 44 40 50 32 52C24 50 18 44 18 36C18 26 26 20 32 12Z"
            fill="#f97316"
          />
          <path
            d="M32 24C35 28 39 32 39 38C39 42 36 46 32 47C28 46 25 42 25 38C25 32 29 28 32 24Z"
            fill="#fde047"
          />
          <circle cx="28" cy="34" r="2.5" fill="#ffffff" />
          <circle cx="36" cy="34" r="2.5" fill="#ffffff" />
        </svg>
      );
    case "chaos-meteor":
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={className}>
          <rect width="64" height="64" rx="8" fill="#2e0808" stroke="#ef4444" strokeWidth="2" />
          {/* Flaming asteroid descending */}
          <path d="M12 12L38 38L32 44L6 18Z" fill="#f97316" opacity="0.6" />
          <path d="M18 8L44 34L38 40L12 14Z" fill="#fbbf24" opacity="0.8" />
          <circle cx="42" cy="42" r="14" fill="#dc2626" />
          <circle cx="42" cy="42" r="10" fill="#f97316" />
          <circle cx="40" cy="40" r="5" fill="#fef08a" />
        </svg>
      );
    case "deafening-blast":
      return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={className}>
          <rect width="64" height="64" rx="8" fill="#1c1917" stroke="#eab308" strokeWidth="2" />
          {/* Expanding concentric sonic wave arcs */}
          <path d="M16 16C26 24 26 40 16 48" stroke="#38bdf8" strokeWidth="4" strokeLinecap="round" />
          <path d="M26 12C40 22 40 42 26 52" stroke="#d946ef" strokeWidth="4" strokeLinecap="round" />
          <path d="M36 8C54 20 54 44 36 56" stroke="#f97316" strokeWidth="4" strokeLinecap="round" />
          <circle cx="12" cy="32" r="4" fill="#ffffff" />
        </svg>
      );
  }
};
