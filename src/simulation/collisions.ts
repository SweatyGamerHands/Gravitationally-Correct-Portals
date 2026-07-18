import type { Point, Portal } from './types';
import { PORTAL_EDGE_RADIUS } from './constants';
import { getPortalApertureHalfWidth } from './portalTraversal';
import { worldPointToPortalLocal } from './portalTransform';

const SWEEP_EPSILON = 1e-9;

export const getPortalApertureEndpoints = (portal: Portal) => {
  const h = getPortalApertureHalfWidth(portal);
  return { start: { x: portal.x - portal.dir.x * h, y: portal.y - portal.dir.y * h }, end: { x: portal.x + portal.dir.x * h, y: portal.y + portal.dir.y * h } };
};

export type PortalRimCollision = {
  normal: Point;
  overlap: number;
  closest: Point;
  local: ReturnType<typeof worldPointToPortalLocal>;
};

export const getPortalRimCollision = (point: Point, radius: number, portal: Portal, edgeRadius = PORTAL_EDGE_RADIUS): PortalRimCollision | null => {
  const local = worldPointToPortalLocal(point, portal);
  const endpoints = getPortalApertureEndpoints(portal);
  const startDistSq = (point.x - endpoints.start.x) ** 2 + (point.y - endpoints.start.y) ** 2;
  const endDistSq = (point.x - endpoints.end.x) ** 2 + (point.y - endpoints.end.y) ** 2;
  const closest = startDistSq <= endDistSq ? endpoints.start : endpoints.end;
  const dx = point.x - closest.x; const dy = point.y - closest.y;
  const distSq = dx * dx + dy * dy; const minDist = radius + edgeRadius;
  if (distSq >= minDist * minDist) return null;
  const dist = Math.sqrt(distSq);
  const normal = dist > SWEEP_EPSILON
    ? { x: dx / dist, y: dy / dist }
    : { x: portal.normal.x, y: portal.normal.y };
  return { normal, overlap: minDist - dist, closest, local };
};

// Backwards-compatible name retained for callers that treated the portal rim
// as a degenerate segment capsule.
export const getPortalSegmentCollision = getPortalRimCollision;

export type SweptPortalRimCollision = {
  t: number;
  center: Point;
  normal: Point;
  endpoint: Point;
};

const getSweptPointCircleCollision = (
  oldPos: Point,
  newPos: Point,
  endpoint: Point,
  collisionRadius: number,
): SweptPortalRimCollision | null => {
  const moveX = newPos.x - oldPos.x;
  const moveY = newPos.y - oldPos.y;
  const a = moveX * moveX + moveY * moveY;
  if (a <= SWEEP_EPSILON) return null;

  const offsetX = oldPos.x - endpoint.x;
  const offsetY = oldPos.y - endpoint.y;
  const c = offsetX * offsetX + offsetY * offsetY - collisionRadius * collisionRadius;
  let t: number;

  if (c <= 0) {
    t = 0;
  } else {
    const b = 2 * (offsetX * moveX + offsetY * moveY);
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;
    t = (-b - Math.sqrt(discriminant)) / (2 * a);
    if (t < 0 || t > 1) return null;
  }

  const center = { x: oldPos.x + moveX * t, y: oldPos.y + moveY * t };
  const normalX = center.x - endpoint.x;
  const normalY = center.y - endpoint.y;
  const normalLength = Math.hypot(normalX, normalY);
  const normal = normalLength > SWEEP_EPSILON
    ? { x: normalX / normalLength, y: normalY / normalLength }
    : { x: -moveX / Math.sqrt(a), y: -moveY / Math.sqrt(a) };

  // Starting overlapped while separating is handled by the static constraint,
  // not converted into another impact.
  if (moveX * normal.x + moveY * normal.y >= 0) return null;
  return { t, center, normal, endpoint };
};

export const getSweptPortalRimCollision = (
  oldPos: Point,
  newPos: Point,
  radius: number,
  portal: Portal,
  edgeRadius = PORTAL_EDGE_RADIUS,
): SweptPortalRimCollision | null => {
  const endpoints = getPortalApertureEndpoints(portal);
  const collisionRadius = radius + edgeRadius;
  const startHit = getSweptPointCircleCollision(oldPos, newPos, endpoints.start, collisionRadius);
  const endHit = getSweptPointCircleCollision(oldPos, newPos, endpoints.end, collisionRadius);
  if (!startHit) return endHit;
  if (!endHit) return startHit;
  return startHit.t <= endHit.t ? startHit : endHit;
};
