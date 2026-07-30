import type { ScoreBand } from '@connected-care/shared';

/** SVG ring gauge for the Peace-of-Mind score, colored by band. */

const BAND_COLOR: Record<ScoreBand, string> = {
  protected: 'var(--color-safe)',
  good: 'var(--color-tier-monitor)',
  needs_attention: 'var(--color-tier-attention)',
  act_now: 'var(--color-tier-emergency)',
};

export function ScoreRing({
  score,
  band,
  label,
  size = 116,
}: {
  score: number;
  band: ScoreBand;
  /** Band label from /v1/meta score_bands — copy lives in the API contract. */
  label: string;
  size?: number;
}) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = (score / 100) * c;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Peace of mind score ${score} of 100 — ${label}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-cream)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={BAND_COLOR[band]}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${filled} ${c - filled}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray 0.6s ease' }}
      />
      <text x="50%" y="47%" textAnchor="middle" fontSize={size * 0.26} fontWeight={800} fill="var(--color-navy)">
        {score}
      </text>
      <text x="50%" y="64%" textAnchor="middle" fontSize={size * 0.095} fontWeight={700} fill={BAND_COLOR[band]}>
        {label}
      </text>
    </svg>
  );
}
