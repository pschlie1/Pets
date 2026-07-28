import type { MetricSeries } from '../api/client';
import { Sparkline } from './Sparkline';

/**
 * One metric's 14-day story: latest value, how it compares to the pet's own
 * baseline (delta chip), and the trend with the baseline band. Shared by the
 * pet trends page and the vet report.
 */

function DeltaChip({ series }: { series: MetricSeries }) {
  const latest = series.points[series.points.length - 1];
  const b = series.baseline;
  if (!latest || !b || b.status !== 'established') return null;

  const sigma = b.stdev > 0 ? Math.abs(latest.value - b.mean) / b.stdev : 0;
  const pct = b.mean !== 0 ? Math.round(((latest.value - b.mean) / b.mean) * 100) : 0;

  if (sigma <= 1) {
    return (
      <span className="rounded-full bg-safe-soft px-2 py-0.5 text-[10px] font-bold text-safe">on baseline</span>
    );
  }
  const cls =
    sigma <= 2 ? 'bg-tier-attention-soft text-tier-attention' : 'bg-tier-urgent-soft text-tier-urgent';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${cls}`}>
      {pct > 0 ? '+' : ''}
      {pct}% vs baseline
    </span>
  );
}

export function TrendCard({ label, unit, series }: { label: string; unit: string; series: MetricSeries | null }) {
  const latest = series?.points[series.points.length - 1];
  return (
    <div className="rounded-2xl bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-400">{label}</p>
        {series && <DeltaChip series={series} />}
      </div>
      <p className="text-2xl font-extrabold">
        {latest ? latest.value : '—'} <span className="text-sm font-semibold text-gray-400">{unit}</span>
      </p>
      {series && series.points.length >= 2 ? (
        <Sparkline points={series.points} baseline={series.baseline} interactive unit={unit.split('/')[0]} />
      ) : (
        <p className="text-xs text-gray-400">No data in this window</p>
      )}
      {series?.baseline && (
        <p className="mt-1 text-xs text-gray-400">
          baseline {Math.round(series.baseline.mean * 10) / 10} {unit}
          {series.baseline.status === 'insufficient_data' && ' · still learning'}
        </p>
      )}
    </div>
  );
}
