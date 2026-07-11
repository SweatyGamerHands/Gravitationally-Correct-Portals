import type { Point, Portal } from './types';
import { PORTAL_EDGE_RADIUS } from './constants';
import { getPortalApertureHalfWidth } from './portalTraversal';
import { worldPointToPortalLocal } from './portalTransform';

export const getPortalApertureEndpoints = (portal: Portal) => {
  const h = getPortalApertureHalfWidth(portal);
  return { start: { x: portal.x - portal.dir.x * h, y: portal.y - portal.dir.y * h }, end: { x: portal.x + portal.dir.x * h, y: portal.y + portal.dir.y * h } };
};

export const getPortalSegmentCollision = (point: Point, radius: number, portal: Portal, edgeRadius = PORTAL_EDGE_RADIUS) => {
  const local = worldPointToPortalLocal(point, portal);
  const halfWidth = getPortalApertureHalfWidth(portal);
  const closestAlong = Math.max(-halfWidth, Math.min(halfWidth, local.along));
  const closest = { x: portal.x + portal.dir.x * closestAlong, y: portal.y + portal.dir.y * closestAlong };
  const dx = point.x - closest.x; const dy = point.y - closest.y;
  const distSq = dx * dx + dy * dy; const minDist = radius + edgeRadius;
  if (Math.abs(local.along) < halfWidth && Math.abs(local.normal) <= radius) return null;
  if (distSq >= minDist * minDist) return null;
  const dist = Math.sqrt(distSq) || 0.1;
  return { normal: { x: dx / dist, y: dy / dist }, overlap: minDist - dist, closest, local };
};
