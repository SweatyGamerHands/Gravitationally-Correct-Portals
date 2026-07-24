import type { Point, Portal } from './types';
import { PORTAL_APERTURE_RADIUS_EPSILON, PORTAL_EDGE_RADIUS, TRAVERSAL_EPSILON } from './constants';
import { mapPointThroughPortal, mapResidualDisplacementThroughPortal, mapVelocityThroughPortal, worldPointToPortalLocal } from './portalTransform';

export const getPortalApertureHalfWidth = (portal: Portal) => portal.width / 2;
export const isWithinPortalAperture = (local: { along: number }, portal: Portal, radius = 0) => {
  const usableHalfWidth = getPortalApertureHalfWidth(portal) - radius - PORTAL_EDGE_RADIUS;
  return usableHalfWidth >= 0 && Math.abs(local.along) <= usableHalfWidth + PORTAL_APERTURE_RADIUS_EPSILON;
};

// Portals are stored as adjacent reciprocal pairs: [A, B, C, D] means
// A <-> B and C <-> D. An unpaired final portal is intentionally inert.
export const getLinkedPortal = (portals: readonly Portal[], index: number): Portal | null => {
  const linkedIndex = index % 2 === 0 ? index + 1 : index - 1;
  return portals[linkedIndex] ?? null;
};

export const getCrossingIntersection = (oldPos: Point, newPos: Point, portal: Portal, radius = 0) => {
  const prevLocal = worldPointToPortalLocal(oldPos, portal);
  const currLocal = worldPointToPortalLocal(newPos, portal);
  if (Math.sign(prevLocal.normal) === Math.sign(currLocal.normal) || prevLocal.normal === currLocal.normal) return null;
  const t = Math.abs(prevLocal.normal) / (Math.abs(prevLocal.normal) + Math.abs(currLocal.normal));
  const interX = oldPos.x + (newPos.x - oldPos.x) * t;
  const interY = oldPos.y + (newPos.y - oldPos.y) * t;
  const local = worldPointToPortalLocal({ x: interX, y: interY }, portal);
  if (!isWithinPortalAperture(local, portal, radius)) return null;
  return { t, interX, interY, dotPrev: prevLocal.normal, local };
};

export type TraversalBody = {
  id?: string;
  label?: string;
  x: number;
  y: number;
  oldX: number;
  oldY: number;
  vx: number;
  vy: number;
  radius: number;
  trail?: Point[];
  trailSampleElapsed?: number;
  cooldown?: number;
};
export const teleportBodyAtCrossing = (body: TraversalBody, entry: Portal, exit: Portal, crossing: Point, proposed: Point) => {
  const mappedCrossing = mapPointThroughPortal(crossing, entry, exit);
  const residual = { x: proposed.x - crossing.x, y: proposed.y - crossing.y };
  const mappedResidual = mapResidualDisplacementThroughPortal(residual, entry, exit);
  const mappedVelocity = mapVelocityThroughPortal({ x: body.vx, y: body.vy }, entry, exit);
  const flowSign = Math.sign(mappedVelocity.x * exit.normal.x + mappedVelocity.y * exit.normal.y) || 1;
  body.x = mappedCrossing.x + mappedResidual.x + exit.normal.x * flowSign * TRAVERSAL_EPSILON;
  body.y = mappedCrossing.y + mappedResidual.y + exit.normal.y * flowSign * TRAVERSAL_EPSILON;
  body.vx = mappedVelocity.x; body.vy = mappedVelocity.y;
  body.oldX = body.x; body.oldY = body.y;
  if (body.trail) body.trail = [];
  if (body.trailSampleElapsed !== undefined) body.trailSampleElapsed = 0;
};
