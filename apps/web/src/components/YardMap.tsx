import type { ContainmentPetStatus, LatLng, YardGeometry } from '@connected-care/shared';

/**
 * Stylized live yard map. Lat/lng are projected to local meters around the
 * yard center (correct aspect ratio at Chicago's latitude), then the padded
 * bounding box of the boundary polygon is scaled into a fixed viewBox.
 * The dashed brand-yellow ring is the invisible fence wire.
 */

const VIEW_W = 400;
const VIEW_H = 300;

function makeProjector(yard: YardGeometry, extraPoints: LatLng[]) {
  const cosLat = Math.cos((yard.center.lat * Math.PI) / 180);
  const toMeters = (p: LatLng) => ({
    x: (p.lng - yard.center.lng) * 111320 * cosLat,
    y: (yard.center.lat - p.lat) * 110574,
  });

  // Include pet positions in the fit so a breached pet outside the fence
  // pulls the view out instead of rendering off-canvas.
  const pts = [...yard.polygon, ...extraPoints].map(toMeters);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = 0.22;
  const spanX = (maxX - minX) * (1 + pad * 2);
  const spanY = (maxY - minY) * (1 + pad * 2);
  const scale = Math.min(VIEW_W / spanX, VIEW_H / spanY);
  const originX = minX - (maxX - minX) * pad;
  const originY = minY - (maxY - minY) * pad;
  const offsetX = (VIEW_W - spanX * scale) / 2;
  const offsetY = (VIEW_H - spanY * scale) / 2;

  return (p: LatLng) => {
    const m = toMeters(p);
    return { x: (m.x - originX) * scale + offsetX, y: (m.y - originY) * scale + offsetY };
  };
}

export function YardMap({ boundary, pets }: { boundary: YardGeometry; pets: ContainmentPetStatus[] }) {
  const project = makeProjector(
    boundary,
    pets.flatMap((p) => (p.last_position ? [p.last_position] : [])),
  );
  const polyPoints = boundary.polygon.map((v) => {
    const { x, y } = project(v);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const gate = project(boundary.polygon[0]);

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="w-full rounded-2xl bg-yard-ground shadow-inner"
      role="img"
      aria-label={boundary.label}
    >
      {/* Safe zone */}
      <polygon
        points={polyPoints.join(' ')}
        fill="var(--color-yard-grass)"
        stroke="none"
        opacity={0.9}
      />
      {/* The invisible fence wire — dashed brand yellow */}
      <polygon
        points={polyPoints.join(' ')}
        fill="none"
        stroke="var(--color-brand-dark)"
        strokeWidth={3}
        strokeDasharray="10 6"
        strokeLinejoin="round"
      />
      {/* Boundary transmitter at the first vertex (nearest the house) */}
      <circle cx={gate.x} cy={gate.y} r={6} fill="var(--color-navy)" />
      <circle cx={gate.x} cy={gate.y} r={10} fill="none" stroke="var(--color-navy)" strokeWidth={1} opacity={0.35} />

      {/* Decoration at fixed spots relative to the yard */}
      <text x={gate.x - 8} y={gate.y - 14} fontSize={22} aria-hidden>
        🏠
      </text>
      <text x={VIEW_W * 0.68} y={VIEW_H * 0.32} fontSize={20} aria-hidden>
        🌳
      </text>
      <text x={VIEW_W * 0.24} y={VIEW_H * 0.72} fontSize={18} aria-hidden>
        🌳
      </text>

      {pets.map((pet, idx) => {
        if (!pet.last_position) return null;
        const { x, y } = project(pet.last_position);
        const ghost = pet.containment_state === 'signal_lost';
        const breach = pet.containment_state === 'breach';
        const ring = breach
          ? 'var(--color-tier-emergency)'
          : ghost
            ? 'var(--color-tier-info)'
            : 'var(--color-navy)';
        // Nudge labels apart if two pets overlap
        const labelY = y + 30 + (idx % 2) * 4;
        return (
          <g key={pet.pet_id} opacity={ghost ? 0.45 : 1}>
            {breach && (
              <circle cx={x} cy={y} r={16} fill="var(--color-tier-emergency)" opacity={0.25}>
                <animate attributeName="r" values="14;22;14" dur="1.6s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.35;0.05;0.35" dur="1.6s" repeatCount="indefinite" />
              </circle>
            )}
            <circle cx={x} cy={y} r={13} fill="var(--color-brand)" stroke={ring} strokeWidth={2.5} />
            <text x={x} y={y + 5} textAnchor="middle" fontSize={14} aria-hidden>
              🐶
            </text>
            {ghost && (
              <text x={x + 11} y={y - 8} fontSize={11} fontWeight={800} fill="var(--color-tier-info)">
                ?
              </text>
            )}
            <text
              x={x}
              y={labelY}
              textAnchor="middle"
              fontSize={11}
              fontWeight={800}
              fill={breach ? 'var(--color-tier-emergency)' : 'var(--color-navy)'}
            >
              {pet.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
