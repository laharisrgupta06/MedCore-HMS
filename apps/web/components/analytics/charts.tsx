'use client';

import type { DayPoint } from '@medcore/types';
import { useId, useState } from 'react';

const W = 640;
const H = 180;
const PAD = { top: 12, right: 8, bottom: 24, left: 40 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
}

const shortDay = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

/**
 * One-series column chart over days (thin bars, 2px gaps, rounded data ends, recessive axis). Hover or
 * focus a bar for its value; the same numbers are in a table under the chart for screen readers and
 * copy. Single series in the design system's sage, so no legend is needed: the title names it.
 */
export function DayBars({
  title,
  points,
  format = (v) => v.toLocaleString('en-IN'),
}: {
  title: string;
  points: DayPoint[];
  format?: (v: number) => string;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const step = innerW / Math.max(points.length, 1);
  const barW = Math.max(1, Math.min(28, step - 2));
  const total = points.reduce((s, p) => s + p.value, 0);
  const h = hover === null ? null : points[hover];
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-label font-medium text-ink-secondary">{title}</span>
        <span className="text-caption text-ink-muted" aria-live="polite">
          {h ? `${shortDay(h.day)}: ${format(h.value)}` : `Total ${format(total)}`}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-labelledby={`${id}-t`}
      >
        <title
          id={`${id}-t`}
        >{`${title}: total ${format(total)} over ${points.length} days`}</title>
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={PAD.top}
          y2={PAD.top}
          className="stroke-border"
          strokeDasharray="2 4"
        />
        <text
          x={PAD.left - 6}
          y={PAD.top + 4}
          textAnchor="end"
          className="fill-ink-muted text-[10px]"
        >
          {format(max)}
        </text>
        <text
          x={PAD.left - 6}
          y={PAD.top + innerH}
          textAnchor="end"
          className="fill-ink-muted text-[10px]"
        >
          0
        </text>
        {points.map((p, i) => {
          const bh = (p.value / max) * innerH;
          const x = PAD.left + i * step + (step - barW) / 2;
          return (
            <g key={p.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* Hit target wider and taller than the bar. */}
              <rect
                x={PAD.left + i * step}
                y={PAD.top}
                width={step}
                height={innerH}
                fill="transparent"
              />
              {bh > 0 && (
                <rect
                  x={x}
                  y={PAD.top + innerH - bh}
                  width={barW}
                  height={bh}
                  rx={Math.min(4, barW / 2)}
                  className={hover === i ? 'fill-sage-800' : 'fill-sage-600'}
                />
              )}
              <title>{`${shortDay(p.day)}: ${format(p.value)}`}</title>
            </g>
          );
        })}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={PAD.top + innerH}
          y2={PAD.top + innerH}
          className="stroke-ink-muted"
        />
        {points.length > 0 && (
          <>
            <text x={PAD.left} y={H - 6} className="fill-ink-muted text-[10px]">
              {shortDay(points[0]!.day)}
            </text>
            <text
              x={W - PAD.right}
              y={H - 6}
              textAnchor="end"
              className="fill-ink-muted text-[10px]"
            >
              {shortDay(points[points.length - 1]!.day)}
            </text>
          </>
        )}
      </svg>
      <details className="text-caption text-ink-muted">
        <summary className="cursor-pointer">Show as table</summary>
        <div className="mt-2 max-h-48 overflow-auto">
          <table className="w-full text-left">
            <thead>
              <tr>
                <th className="py-1 font-medium">Day</th>
                <th className="py-1 text-right font-medium">{title}</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.day}>
                  <td className="py-0.5">{p.day}</td>
                  <td className="py-0.5 text-right tabular-nums">{format(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** Horizontal bars for a ranked list (statuses, departments). Value labels in ink, never series colour. */
export function RankBars({
  rows,
  format = (v) => v.toLocaleString('en-IN'),
}: {
  rows: { label: string; value: number }[];
  format?: (v: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0)
    return <p className="text-body-sm text-ink-muted">No data in this range.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li
          key={r.label}
          className="grid grid-cols-[minmax(6rem,10rem)_1fr_auto] items-center gap-3 text-body-sm"
        >
          <span className="truncate" title={r.label}>
            {r.label}
          </span>
          <span className="h-2 rounded-full bg-surface-muted" aria-hidden="true">
            <span
              className="block h-2 rounded-full bg-sage-600"
              style={{ width: `${(r.value / max) * 100}%` }}
            />
          </span>
          <span className="tabular-nums">{format(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}
