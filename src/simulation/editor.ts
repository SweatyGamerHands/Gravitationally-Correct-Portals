import { withPortalVectors, type Point, type Portal } from './types';

export const MAX_BALLS = 64;
const SPAWN_GAP = 8;

type CircularBody = Pick<Point, 'x' | 'y'> & { radius: number };

export const findAvailableBallSpawn = (
  bodies: readonly CircularBody[],
  width: number,
  height: number,
  radius: number,
): Point | null => {
  if (width <= radius * 2 || height <= radius * 2 || radius <= 0) return null;

  const margin = radius + 4;
  const spacing = radius * 2 + SPAWN_GAP;
  const minY = Math.min(Math.max(margin, 72), height - margin);
  const maxY = Math.max(minY, Math.min(height * 0.32, height - margin));
  const usableWidth = width - margin * 2;
  const columns = Math.max(1, Math.floor(usableWidth / spacing) + 1);
  const columnStep = columns > 1 ? usableWidth / (columns - 1) : 0;
  const rows = Math.max(1, Math.floor((maxY - minY) / spacing) + 1);

  const columnOrder = Array.from({ length: columns }, (_, column) => column)
    .sort((a, b) => Math.abs(a - (columns - 1) / 2) - Math.abs(b - (columns - 1) / 2));

  for (let row = 0; row < rows; row++) {
    for (const column of columnOrder) {
      const candidate = {
        x: columns > 1 ? margin + column * columnStep : width / 2,
        y: minY + row * spacing,
      };
      const clear = bodies.every(body => (
        Math.hypot(candidate.x - body.x, candidate.y - body.y)
        >= radius + body.radius + SPAWN_GAP
      ));
      if (clear) return candidate;
    }
  }

  return null;
};

export const movePortalForEditor = (
  portals: readonly Portal[],
  portalId: string,
  mode: 'portal' | 'handle',
  point: Point,
): Portal[] => portals.map(portal => {
  if (portal.id !== portalId) return portal;

  if (mode === 'portal') {
    return withPortalVectors({ ...portal, x: point.x, y: point.y });
  }

  const angle = Math.atan2(point.y - portal.y, point.x - portal.x) - Math.PI / 2;
  return withPortalVectors({ ...portal, angle });
});
