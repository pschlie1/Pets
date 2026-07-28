import { describe, expect, it } from 'vitest';
import { pointInPolygon, YARD_GEOMETRIES } from '@connected-care/shared';
import { mulberry32 } from '../../db/seed/rng';
import { nextWanderPoint } from '../../db/seed/generators';

const yard = YARD_GEOMETRIES.hh_2291;

describe('yard geometry invariants', () => {
  it('the yard center is inside the boundary polygon', () => {
    expect(pointInPolygon(yard.center, yard.polygon)).toBe(true);
  });

  it("the S6 emergency breach position is OUTSIDE the fence", () => {
    // Hardcoded in the emergency_boundary_breach injector — the map story
    // depends on this point rendering beyond the boundary.
    expect(pointInPolygon({ lat: 41.9214, lng: -87.6513 }, yard.polygon)).toBe(false);
  });

  it('the safe-return breach position is outside and its return position inside', () => {
    expect(pointInPolygon({ lat: 41.9209, lng: -87.65195 }, yard.polygon)).toBe(false);
    expect(pointInPolygon({ lat: 41.92078, lng: -87.65245 }, yard.polygon)).toBe(true);
  });

  it('seeded GPS wander never leaves the boundary', () => {
    const rng = mulberry32(42);
    let pos = { ...yard.center };
    for (let i = 0; i < 5000; i++) {
      pos = nextWanderPoint(rng, pos, yard);
      expect(pointInPolygon(pos, yard.polygon)).toBe(true);
    }
  });
});
