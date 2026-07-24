export type Point = { x: number; y: number };

export type Portal = {
  id: string;
  x: number;
  y: number;
  angle: number;
  color: string;
  width: number;
  /** Overrides the experiment-wide matter traversal mode for this mouth. */
  twoSided?: boolean;
  dir: Point;
  normal: Point;
  handle: Point;
};

export const withPortalVectors = (p: Omit<Portal, 'dir' | 'normal' | 'handle'>): Portal => {
  const dir = { x: Math.cos(p.angle), y: Math.sin(p.angle) };
  const normal = { x: -Math.sin(p.angle), y: Math.cos(p.angle) };
  return { ...p, dir, normal, handle: { x: p.x + normal.x * 60, y: p.y + normal.y * 60 } };
};

export const isPortalTwoSided = (portal: Pick<Portal, 'twoSided'>, fallback: boolean) => (
  portal.twoSided ?? fallback
);
