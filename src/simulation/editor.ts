import { PORTAL_COLLISION_EPSILON, PORTAL_EDGE_RADIUS } from './constants';
import { worldPointToPortalLocal } from './portalTransform';
import { withPortalVectors, type Point, type Portal } from './types';

export const MAX_BALLS = 64;
const SPAWN_GAP = 8;

type CircularBody = Pick<Point, 'x' | 'y'> & { radius: number };

export type EditableBody = CircularBody & {
  oldX: number;
  oldY: number;
  vx?: number;
  vy?: number;
  trail?: Point[];
};

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

export const separateBodyFromEditedPortal = (body: EditableBody, portal: Portal): boolean => {
  const local = worldPointToPortalLocal(body, portal);
  const usableHalfWidth = portal.width / 2 - body.radius - PORTAL_EDGE_RADIUS;
  const clearance = body.radius + PORTAL_EDGE_RADIUS + PORTAL_COLLISION_EPSILON;

  if (usableHalfWidth < 0 || Math.abs(local.along) > usableHalfWidth || Math.abs(local.normal) >= clearance) {
    return false;
  }

  const normalVelocity = (body.vx ?? 0) * portal.normal.x + (body.vy ?? 0) * portal.normal.y;
  const side = Math.sign(local.normal) || -Math.sign(normalVelocity) || 1;
  const correction = side * clearance - local.normal;
  body.x += portal.normal.x * correction;
  body.y += portal.normal.y * correction;

  if (body.vx !== undefined && body.vy !== undefined && normalVelocity * side < 0) {
    body.vx -= normalVelocity * portal.normal.x;
    body.vy -= normalVelocity * portal.normal.y;
  }

  body.oldX = body.x;
  body.oldY = body.y;
  if (body.trail) body.trail.length = 0;
  return true;
};
