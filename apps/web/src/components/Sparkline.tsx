/**
 * Inline SVG sparkline with a baseline band: the pet's personal normal range
 * (mean ± stdev) drawn behind the trend line, so a deviation is visible at a
 * glance. Single series — the title names it, no legend needed.
 */
export function Sparkline({
  points,
  baseline,
  width = 240,
  height = 56,
  stroke = 'var(--color-charcoal)',
}: {
  points: { days_ago: number; value: number }[];
  baseline: { mean: number; stdev: number } | null;
  width?: number;
  height?: number;
  stroke?: string;
}) {
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

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="14-day trend">
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
    </svg>
  );
}
