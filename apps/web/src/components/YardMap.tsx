import type { ContainmentPetStatus, YardGeometry } from '@connected-care/shared';
import { YardBase, type Projector } from './YardBase';

/** Live view: each collared pet's current position and containment state. */

export function PetMarkers({
  pets,
  project,
}: {
  pets: ContainmentPetStatus[];
  project: Projector;
}) {
  return (
    <>
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
    </>
  );
}

export function YardMap({ boundary, pets }: { boundary: YardGeometry; pets: ContainmentPetStatus[] }) {
  return (
    <YardBase boundary={boundary} extraPoints={pets.flatMap((p) => (p.last_position ? [p.last_position] : []))}>
      {(project) => <PetMarkers pets={pets} project={project} />}
    </YardBase>
  );
}
