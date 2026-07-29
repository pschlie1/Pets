import { useRef, useState } from 'react';

/**
 * Inline SVG sparkline with a baseline band: the pet's personal normal range
 * (mean ± stdev) drawn behind the trend line, so a deviation is visible at a
 * glance. Single series — the title names it, no legend needed.
 * `interactive` adds a nearest-point hover tooltip (value + how many days ago).
 */
export function Sparkline({
  points,
  baseline,
  width = 240,
  height = 56,
  stroke = 'var(--color-navy)',
  interactive = false,
  unit = '',
}: {
  points: { days_ago: number; value: number }[];
  baseline: { mean: number; stdev: number } | null;
  width?: number;
  height?: number;
  stroke?: string;
  interactive?: boolean;
  unit?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  if (points.length < 2) {
    return <div className="text-xs text-gray-400">Not enough data yet</div>;
  }
  const values = points.map((p) => p.value);
  const lo = Math.min(...values, baseline ? baseline.mean - baseline.stdev : Infinity);
  const hi = Math.max(...values, baseline ? baseline.mean + baseline.stdev : -Infinity);
  const pad = (hi - lo) * 0.15 || 1;
  const min = lo - pad;
  const max = hi + pad;

  const x = (i: number) => (i / (points.length - 1)) * (width - 8) + 4;
  const y = (v: number) => height - 4 - ((v - min) / (max - min)) * (height - 8);

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];

  const onMove = (e: React.MouseEvent) => {
    if (!interactive || !svgRef.current) return;
    // clientX relative to the svg box — offsetX would be relative to whichever
    // child element the pointer happens to be over.
    const rect = svgRef.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const step = (width - 8) / (points.length - 1);
    setHover(Math.min(Math.max(Math.round((px - 4) / step), 0), points.length - 1));
  };

  const hovered = hover !== null ? points[hover] : null;

  return (
    <div className="relative inline-block" onMouseLeave={() => setHover(null)}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="14-day trend"
        onMouseMove={onMove}
      >
        {baseline && (
          <rect
            x={0}
            y={y(baseline.mean + baseline.stdev)}
            width={width}
            height={Math.max(y(baseline.mean - baseline.stdev) - y(baseline.mean + baseline.stdev), 2)}
            fill="var(--color-brand)"
            opacity={0.25}
            rx={3}
          />
        )}
        <path d={path} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={x(points.length - 1)} cy={y(last.value)} r={4} fill={stroke} stroke="#fff" strokeWidth={2} />
        {hovered && hover !== null && (
          <>
            <line
              x1={x(hover)}
              y1={2}
              x2={x(hover)}
              y2={height - 2}
              stroke="var(--color-navy)"
              strokeWidth={1}
              opacity={0.3}
            />
            <circle cx={x(hover)} cy={y(hovered.value)} r={4.5} fill="var(--color-brand)" stroke={stroke} strokeWidth={2} />
          </>
        )}
      </svg>
      {hovered && hover !== null && (
        <div
          className="pointer-events-none absolute -top-7 rounded-full bg-navy px-2 py-0.5 text-[10px] font-bold whitespace-nowrap text-white"
          style={{
            left: Math.min(Math.max(x(hover), 30), width - 30),
            transform: 'translateX(-50%)',
          }}
        >
          {hovered.value} {unit} · {hovered.days_ago === 0 ? 'today' : `${hovered.days_ago}d ago`}
        </div>
      )}
    </div>
  );
}
