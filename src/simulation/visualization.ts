import type { Point, Portal } from './types';
import { computeGravityAt, type FieldConfig } from './fieldSolver';
import { mag } from './portalTransform';
export const rk4FieldStep = (p: Point, h: number, portals: Portal[], config: FieldConfig): Point => {
  const unit = (q: Point) => { const g = computeGravityAt(q.x, q.y, portals, config); const m = mag(g) || 1; return { x: g.x / m, y: g.y / m }; };
  const k1 = unit(p), k2 = unit({ x: p.x + k1.x * h / 2, y: p.y + k1.y * h / 2 }), k3 = unit({ x: p.x + k2.x * h / 2, y: p.y + k2.y * h / 2 }), k4 = unit({ x: p.x + k3.x * h, y: p.y + k3.y * h });
  return { x: p.x + h * (k1.x + 2*k2.x + 2*k3.x + k4.x) / 6, y: p.y + h * (k1.y + 2*k2.y + 2*k3.y + k4.y) / 6 };
};
