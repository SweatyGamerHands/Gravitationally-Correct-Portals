import type { Point, Portal } from './types';

export type PortalLocal = { along: number; normal: number };

export const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Point, s: number): Point => ({ x: a.x * s, y: a.y * s });
export const mag = (a: Point) => Math.hypot(a.x, a.y);
export const normalize = (a: Point): Point => { const m = mag(a) || 1; return { x: a.x / m, y: a.y / m }; };

export const worldPointToPortalLocal = (point: Point, portal: Portal): PortalLocal => {
  const d = sub(point, portal);
  return { along: dot(d, portal.dir), normal: dot(d, portal.normal) };
};

export const portalLocalToWorldPoint = (local: PortalLocal, portal: Portal): Point => ({
  x: portal.x + local.along * portal.dir.x + local.normal * portal.normal.x,
  y: portal.y + local.along * portal.dir.y + local.normal * portal.normal.y,
});

export const mapPortalLocal = (local: PortalLocal): PortalLocal => ({ along: local.along, normal: -local.normal });

export const mapPointThroughPortal = (point: Point, entry: Portal, exit: Portal): Point =>
  portalLocalToWorldPoint(mapPortalLocal(worldPointToPortalLocal(point, entry)), exit);

export const mapVectorThroughPortal = (vector: Point, entry: Portal, exit: Portal): Point => {
  const along = dot(vector, entry.dir);
  const normal = dot(vector, entry.normal);
  return { x: along * exit.dir.x - normal * exit.normal.x, y: along * exit.dir.y - normal * exit.normal.y };
};

export const mapVelocityThroughPortal = mapVectorThroughPortal;
export const mapAccelerationThroughPortal = mapVectorThroughPortal;
export const mapResidualDisplacementThroughPortal = mapVectorThroughPortal;
export const mapApertureCoordinate = (along: number) => along;

export const inversePortalTransform = (point: Point, exit: Portal, entry: Portal): Point =>
  mapPointThroughPortal(point, exit, entry);
