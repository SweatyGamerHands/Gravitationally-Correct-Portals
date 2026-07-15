import type { Point, Portal } from './types';
import { computeGravityAt, type FieldConfig } from './fieldSolver';
import { mag, mapPointThroughPortal, mapVectorThroughPortal, worldPointToPortalLocal } from './portalTransform';
import { canBodyTraverseAperture } from './runtime';

export const rk4FieldStep = (p: Point, h: number, portals: Portal[], config: FieldConfig): Point => {
  const unit = (q: Point) => { const g = computeGravityAt(q.x, q.y, portals, config); const m = mag(g) || 1; return { x: g.x / m, y: g.y / m }; };
  const k1 = unit(p), k2 = unit({ x: p.x + k1.x * h / 2, y: p.y + k1.y * h / 2 }), k3 = unit({ x: p.x + k2.x * h / 2, y: p.y + k2.y * h / 2 }), k4 = unit({ x: p.x + k3.x * h, y: p.y + k3.y * h });
  return { x: p.x + h * (k1.x + 2*k2.x + 2*k3.x + k4.x) / 6, y: p.y + h * (k1.y + 2*k2.y + 2*k3.y + k4.y) / 6 };
};

export function traceStreamlineSegments(seed: Point, step: number, maxSteps: number, portals: Portal[], config: FieldConfig, bounds: { width: number; height: number }): Point[][] {
  const segments: Point[][] = [[seed]]; let p = seed; let guard = 0;
  for (let i = 0; i < maxSteps && guard++ < maxSteps * 3; i++) {
    const next = rk4FieldStep(p, step, portals, config);
    let crossed = false;
    for (let j = 0; j < portals.length; j++) {
      const entry = portals[j], exit = portals[(j + 1) % portals.length];
      const a = worldPointToPortalLocal(p, entry), b = worldPointToPortalLocal(next, entry);
      if (a.normal !== b.normal && Math.sign(a.normal) !== Math.sign(b.normal)) {
        const t = Math.abs(a.normal) / (Math.abs(a.normal) + Math.abs(b.normal));
        const hit = { x: p.x + (next.x - p.x) * t, y: p.y + (next.y - p.y) * t };
        const local = worldPointToPortalLocal(hit, entry);
        if (((config.twoSided ?? true) || a.normal > 0) && canBodyTraverseAperture(local, entry, 0)) {
          segments[segments.length - 1].push(hit);
          const mapped = mapPointThroughPortal(hit, entry, exit);
          const tangent = mapVectorThroughPortal({ x: next.x - p.x, y: next.y - p.y }, entry, exit);
          p = { x: mapped.x + Math.sign(tangent.x * exit.normal.x + tangent.y * exit.normal.y || 1) * exit.normal.x * 0.2, y: mapped.y + Math.sign(tangent.x * exit.normal.x + tangent.y * exit.normal.y || 1) * exit.normal.y * 0.2 };
          segments.push([p]); crossed = true; break;
        }
      }
    }
    if (!crossed) p = next;
    if (p.x < 0 || p.y < 0 || p.x > bounds.width || p.y > bounds.height) break;
    if (!crossed) segments[segments.length - 1].push(p);
  }
  return segments;
}
