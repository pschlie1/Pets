import type { HeatmapPet, HeatmapResponse } from '@connected-care/shared';
import type { Projector } from './YardBase';

/**
 * Movement heat map cells over the yard. Opacity scales with sqrt(count/max)
 * so mid-traffic areas stay visible next to the favorite spot, and the fill
 * blends from the cool to the warm end of the heat ramp as traffic rises.
 */
export function YardHeatLayer({
  grid,
  pet,
  project,
}: {
  grid: HeatmapResponse;
  pet: HeatmapPet;
  project: Projector;
}) {
  if (!grid.bbox || pet.max_cell_count === 0) return null;
  const { min_lat, max_lat, min_lng, max_lng } = grid.bbox;
  const latStep = (max_lat - min_lat) / grid.rows;
  const lngStep = (max_lng - min_lng) / grid.cols;

  return (
    <g style={{ mixBlendMode: 'multiply' }}>
      {pet.cells.map((cell) => {
        // Row 0 is the north edge (max_lat), matching the API's grid contract.
        const cellTopLat = max_lat - cell.r * latStep;
        const cellLeftLng = min_lng + cell.c * lngStep;
        const tl = project({ lat: cellTopLat, lng: cellLeftLng });
        const br = project({ lat: cellTopLat - latStep, lng: cellLeftLng + lngStep });
        const intensity = Math.sqrt(cell.count / pet.max_cell_count);
        return (
          <rect
            key={`${cell.r}-${cell.c}`}
            x={tl.x}
            y={tl.y}
            width={br.x - tl.x}
            height={br.y - tl.y}
            rx={1.5}
            fill={intensity > 0.55 ? 'var(--color-heat-high)' : 'var(--color-heat-low)'}
            opacity={0.12 + intensity * 0.55}
          />
        );
      })}
    </g>
  );
}
