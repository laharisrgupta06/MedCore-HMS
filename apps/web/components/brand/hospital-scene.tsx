'use client';

import { useEffect, useId, useRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * MedCore hospital scene: an original, decorative vector illustration with one 16-second loop.
 * An ambulance drives in and stops at the entrance, the doors open and close, a few people walk
 * along the pavement, then the ambulance leaves and the loop starts again. Motion is CSS only
 * (transform and opacity, see the "Hospital scene" section of globals.css); the animation pauses
 * while the scene is off screen and is replaced by a still composition for reduced motion.
 *
 * variant "panel": the central crop (building, entrance, near road), for narrow or tall areas.
 * variant "wide":  the full street, faded at both ends, for wide bands.
 */
const VIEWBOX = { panel: '250 70 600 330', wide: '0 80 960 320' } as const;

export function HospitalScene({
  variant = 'panel',
  className,
}: {
  variant?: keyof typeof VIEWBOX;
  className?: string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const uid = useId().replace(/:/g, '');

  // Pause every animation while the scene is off screen (all share one timeline, so they stay in step).
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) el.toggleAttribute('data-paused', !entry.isIntersecting);
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <svg
      ref={ref}
      viewBox={VIEWBOX[variant]}
      preserveAspectRatio="xMidYMax meet"
      className={cn(
        'mc-scene pointer-events-none block h-auto w-full select-none',
        variant === 'wide' && 'mc-scene-fade',
        className,
      )}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id={`glow-${uid}`}>
          <stop offset="0%" style={{ stopColor: 'var(--color-tomato-600)', stopOpacity: 0.55 }} />
          <stop offset="100%" style={{ stopColor: 'var(--color-tomato-600)', stopOpacity: 0 }} />
        </radialGradient>
        <clipPath id={`doors-${uid}`}>
          <rect x="530" y="276" width="60" height="46" />
        </clipPath>
      </defs>

      {/* Distant buildings */}
      <g className="fill-sage-100">
        <rect x="110" y="248" width="150" height="74" rx="2" />
        <rect x="160" y="226" width="60" height="30" rx="2" />
        <rect x="800" y="236" width="140" height="86" rx="2" />
      </g>

      {/* Hospital */}
      <g className="fill-surface stroke-sage-300" strokeWidth="1.5">
        <rect x="330" y="190" width="140" height="132" />
        <rect x="650" y="170" width="140" height="152" />
        <rect x="470" y="110" width="180" height="212" />
      </g>
      <g className="fill-sage-200">
        <rect x="326" y="186" width="148" height="6" rx="1" />
        <rect x="646" y="166" width="148" height="6" rx="1" />
        <rect x="466" y="106" width="188" height="7" rx="1" />
      </g>
      {/* Windows */}
      <g className="fill-sage-100">
        {[0, 1, 2].map((r) =>
          [0, 1, 2, 3].map((c) => (
            <rect
              key={`l${r}${c}`}
              x={346 + c * 30}
              y={208 + r * 30}
              width="18"
              height="16"
              rx="2"
            />
          )),
        )}
        {[0, 1, 2, 3].map((r) =>
          [0, 1, 2, 3].map((c) => (
            <rect
              key={`r${r}${c}`}
              x={666 + c * 30}
              y={188 + r * 30}
              width="18"
              height="16"
              rx="2"
            />
          )),
        )}
        {[0, 1, 2, 3].map((r) =>
          [0, 1, 2, 3, 4].map((c) => (
            <rect
              key={`t${r}${c}`}
              x={486 + c * 32}
              y={152 + r * 26}
              width="20"
              height="16"
              rx="2"
            />
          )),
        )}
      </g>
      <g className="fill-sage-200">
        <rect x="582" y="178" width="20" height="16" rx="2" />
        <rect x="696" y="218" width="18" height="16" rx="2" />
        <rect x="376" y="238" width="18" height="16" rx="2" />
      </g>
      {/* MedCore mark on the tower */}
      <g>
        <rect x="555" y="118" width="10" height="28" rx="2" className="fill-sage-600" />
        <rect x="546" y="127" width="28" height="10" rx="2" className="fill-sage-600" />
        <circle cx="560" cy="132" r="3.5" className="fill-tomato-600" />
      </g>

      {/* Entrance: canopy, glass doors (slide into the wall) */}
      <rect
        x="524"
        y="272"
        width="72"
        height="50"
        className="fill-sage-50 stroke-sage-300"
        strokeWidth="1.5"
      />
      <rect x="530" y="276" width="60" height="46" className="fill-sage-400" />
      <g clipPath={`url(#doors-${uid})`}>
        <rect
          className="mc-door-l fill-sage-100 stroke-sage-300"
          x="530"
          y="276"
          width="30"
          height="46"
          strokeWidth="1"
        />
        <rect
          className="mc-door-r fill-sage-100 stroke-sage-300"
          x="560"
          y="276"
          width="30"
          height="46"
          strokeWidth="1"
        />
      </g>
      <rect x="500" y="260" width="120" height="8" rx="2" className="fill-sage-400" />
      <rect x="506" y="268" width="3" height="54" className="fill-sage-300" />
      <rect x="611" y="268" width="3" height="54" className="fill-sage-300" />

      {/* Landscaping */}
      <g className="fill-sage-200">
        <rect x="334" y="310" width="160" height="12" rx="6" />
        <rect x="626" y="310" width="160" height="12" rx="6" />
      </g>
      <g>
        {(
          [
            [282, 28],
            [310, 18],
            [822, 26],
            [854, 17],
          ] as const
        ).map(([x, r]) => (
          <g key={x}>
            <rect
              x={x - 1.5}
              y={322 - r - 18}
              width="3"
              height={r + 18}
              className="fill-sage-400"
            />
            <circle cx={x} cy={322 - r - 20} r={r} className="fill-sage-300" opacity="0.8" />
          </g>
        ))}
      </g>
      <g className="fill-sage-400">
        {[240, 740].map((x) => (
          <g key={x}>
            <rect x={x} y="282" width="2" height="40" />
            <rect x={x - 5} y="278" width="12" height="5" rx="2" />
          </g>
        ))}
      </g>

      {/* Pavement and road */}
      <rect x="-40" y="322" width="1040" height="12" className="fill-surface-muted" />
      <rect x="-40" y="334" width="1040" height="2" className="fill-sage-200" />
      <rect x="-40" y="336" width="1040" height="64" className="fill-sage-100" />
      <line
        x1="-40"
        y1="368"
        x2="1000"
        y2="368"
        className="stroke-surface"
        strokeWidth="2"
        strokeDasharray="18 16"
      />

      {/* People on the pavement (feet at y 332) */}
      <g className="mc-walk-c">
        <Person className="fill-sage-600" />
      </g>
      <g className="mc-walk-a">
        <Person className="fill-border-strong" />
      </g>
      <g className="mc-walk-b">
        <Person className="fill-sage-500" />
      </g>
      <g transform="translate(628 332)">
        <Person className="fill-sage-600" still />
      </g>

      {/* Ambulance (wheels on the near lane, y 386) */}
      <g transform="translate(0 386)">
        <g className="mc-amb">
          <ellipse cx="52" cy="1" rx="50" ry="2.5" className="fill-sage-900" opacity="0.08" />
          <ellipse
            className="mc-amb-glow"
            cx="69"
            cy="-47"
            rx="26"
            ry="14"
            fill={`url(#glow-${uid})`}
          />
          <rect
            x="0"
            y="-44"
            width="72"
            height="36"
            rx="4"
            className="fill-surface stroke-sage-400"
            strokeWidth="1.5"
          />
          <path
            d="M72 -36 H88 L100 -22 V-8 H72 Z"
            className="fill-surface stroke-sage-400"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path d="M78 -32 H86.5 L94 -23 H78 Z" className="fill-sage-200" />
          <rect x="0.75" y="-22" width="99" height="4" className="fill-tomato-600" opacity="0.85" />
          <rect x="30" y="-39" width="5" height="14" rx="1" className="fill-tomato-600" />
          <rect x="25.5" y="-34.5" width="14" height="5" rx="1" className="fill-tomato-600" />
          <rect x="62" y="-49" width="14" height="5" rx="2" className="fill-tomato-600" />
          <g className="fill-sage-800">
            <circle cx="22" cy="-6" r="7" />
            <circle cx="82" cy="-6" r="7" />
          </g>
          <g className="fill-sage-100">
            <circle cx="22" cy="-6" r="2.5" />
            <circle cx="82" cy="-6" r="2.5" />
          </g>
        </g>
      </g>
    </svg>
  );
}

/** A simplified figure about 32 units tall, feet at the origin. */
function Person({ className, still = false }: { className: string; still?: boolean }) {
  return (
    <g className={cn(className, !still && 'mc-step')}>
      <circle cx="0" cy="-27" r="4.5" />
      <rect x="-5" y="-21" width="10" height="14" rx="4" />
      <rect
        className={still ? undefined : 'mc-leg-a'}
        x="-4"
        y="-9"
        width="3.2"
        height="9"
        rx="1.5"
      />
      <rect
        className={still ? undefined : 'mc-leg-b'}
        x="0.8"
        y="-9"
        width="3.2"
        height="9"
        rx="1.5"
      />
    </g>
  );
}
