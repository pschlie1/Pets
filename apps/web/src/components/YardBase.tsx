import type { ReactNode } from 'react';
import type { LatLng, YardGeometry } from '@connected-care/shared';

/**
 * Shared stylized yard rendering. Lat/lng are projected to local meters around
 * the yard center (correct aspect ratio at Chicago's latitude), then the padded
 * bounding box of the boundary polygon is scaled into a fixed viewBox. The
 * dashed brand-yellow ring is the invisible fence wire. Views (live markers,
 * heat map, day path) render on top through the render-prop child.
 */

export const VIEW_W = 400;
export const VIEW_H = 300;

export type Projector = (p: LatLng) => { x: number; y: number };

export function makeProjector(yard: YardGeometry, extraPoints: LatLng[]): Projector {
  const cosLat = Math.cos((yard.center.lat * Math.PI) / 180);
  const toMeters = (p: LatLng) => ({
    x: (p.lng - yard.center.lng) * 111320 * cosLat,
    y: (yard.center.lat - p.lat) * 110574,
  });

  // Include extra points (pet positions, breach spots) in the fit so anything
  // outside the fence pulls the view out instead of rendering off-canvas.
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

export function YardBase({
  boundary,
  extraPoints = [],
  ariaLabel,
  children,
}: {
  boundary: YardGeometry;
  extraPoints?: LatLng[];
  ariaLabel?: string;
  children: (project: Projector) => ReactNode;
}) {
  const project = makeProjector(boundary, extraPoints);
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
      aria-label={ariaLabel ?? boundary.label}
    >
      {/* Safe zone */}
      <polygon points={polyPoints.join(' ')} fill="var(--color-yard-grass)" stroke="none" opacity={0.9} />
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

      {children(project)}
    </svg>
  );
}
