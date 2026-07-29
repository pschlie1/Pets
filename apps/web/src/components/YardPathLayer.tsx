import type { DayHistoryPet } from '@connected-care/shared';
import type { Projector } from './YardBase';

/**
 * One day's movement path, revealed up to `upTo` (fraction of the day's points,
 * 0..1 — driven by the time scrubber). Start and end are marked, boundary
 * breaches show where the dog crossed, and the dog's marker sits at the
 * scrub position.
 */
export function YardPathLayer({
  pet,
  upTo,
  project,
}: {
  pet: DayHistoryPet;
  upTo: number;
  project: Projector;
}) {
  const count = Math.max(1, Math.round(pet.points.length * Math.min(Math.max(upTo, 0), 1)));
  const shown = pet.points.slice(0, count);
  if (shown.length === 0) return null;

  const coords = shown.map((p) => project(p));
  const path = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const head = coords[coords.length - 1];
  const start = coords[0];
  const done = count >= pet.points.length;

  return (
    <g>
      {/* Older movement fades so the recent trail reads clearly. */}
      <polyline
        points={path}
        fill="none"
        stroke="var(--color-heat-path)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.45}
      />
      <circle cx={start.x} cy={start.y} r={4} fill="var(--color-heat-path)" opacity={0.7} />
      <text x={start.x + 6} y={start.y - 5} fontSize={11} aria-hidden>
        🌅
      </text>

      {pet.events.map((e, i) => {
        if (!e.position) return null;
        const { x, y } = project(e.position);
        return (
          <g key={i}>
            <circle
              cx={x}
              cy={y}
              r={7}
              fill={e.kind === 'breach' ? 'var(--color-tier-emergency)' : 'var(--color-safe)'}
              opacity={0.25}
            />
            <text x={x} y={y + 4} textAnchor="middle" fontSize={11} aria-hidden>
              {e.kind === 'breach' ? '⛔' : '↩️'}
            </text>
          </g>
        );
      })}

      {/* The dog at the scrub position (moon marker once the day is complete). */}
      <circle cx={head.x} cy={head.y} r={11} fill="var(--color-brand)" stroke="var(--color-navy)" strokeWidth={2} />
      <text x={head.x} y={head.y + 4.5} textAnchor="middle" fontSize={12} aria-hidden>
        {done ? '🌙' : '🐶'}
      </text>
    </g>
  );
}
