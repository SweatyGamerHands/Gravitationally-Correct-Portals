import type { Point, Portal } from './types';

export const BASE_G = 800;
const PORTAL_EDGE_FALLOFF_RATIO = 0.2;

export const MAX_FRAME_DT = 1 / 30;

export const getScaledFrameDt = (realFrameDt: number, timeScale: number, maxFrameDt = MAX_FRAME_DT) =>
  Math.min(maxFrameDt, Math.max(0, realFrameDt)) * timeScale;

export const integrateVelocity = (
  velocity: Point,
  acceleration: Point,
  friction: number,
  dt: number,
): Point => {
  const frictionStep = Math.pow(friction, dt * 60);
  return {
    x: velocity.x * frictionStep + acceleration.x * dt,
    y: velocity.y * frictionStep + acceleration.y * dt,
  };
};

export const integratePosition = (position: Point, velocity: Point, dt: number): Point => ({
  x: position.x + velocity.x * dt,
  y: position.y + velocity.y * dt,
});

export const simulateLinearDisplacement = (
  velocity: Point,
  realElapsedSeconds: number,
  timeScale: number,
): Point => ({
  x: velocity.x * realElapsedSeconds * timeScale,
  y: velocity.y * realElapsedSeconds * timeScale,
});
export const PORTAL_APERTURE_RADIUS_EPSILON = 0.001;
export const PORTAL_EDGE_RADIUS = 1;
export const TELEPORT_COOLDOWN_DISTANCE = 8;

export type PortalLocal = {
  normal: number;
  along: number;
};

export const getBaselineG = (vacuum: boolean, gravityMult: number) => (vacuum ? 1100 : BASE_G) * gravityMult;
export const getBaselineG = (_vacuum: boolean, gravityMult: number) => BASE_G * gravityMult;

export const getPortalLocal = (point: Point, portal: Portal): PortalLocal => {
  const dx = point.x - portal.x;
  const dy = point.y - portal.y;
  return {
    normal: dx * portal.normal.x + dy * portal.normal.y,
    along: dx * portal.dir.x + dy * portal.dir.y,
  };
};

export const getPortalApertureHalfWidth = (portal: Portal) => portal.width / 2;

export const isWithinPortalAperture = (local: PortalLocal, portal: Portal, radius = 0) => (
  Math.abs(local.along) <= getPortalApertureHalfWidth(portal) + radius + PORTAL_APERTURE_RADIUS_EPSILON
);

export const getPortalApertureEndpoints = (portal: Portal) => {
  const halfWidth = getPortalApertureHalfWidth(portal);
  return {
    start: {
      x: portal.x - portal.dir.x * halfWidth,
      y: portal.y - portal.dir.y * halfWidth,
    },
    end: {
      x: portal.x + portal.dir.x * halfWidth,
      y: portal.y + portal.dir.y * halfWidth,
    },
  };
};

export const getPortalSegmentCollision = (point: Point, radius: number, portal: Portal, edgeRadius = PORTAL_EDGE_RADIUS) => {
  const local = getPortalLocal(point, portal);
  const halfWidth = getPortalApertureHalfWidth(portal);
  const closestAlong = Math.max(-halfWidth, Math.min(halfWidth, local.along));
  const closest = {
    x: portal.x + portal.dir.x * closestAlong,
    y: portal.y + portal.dir.y * closestAlong,
  };
  const dx = point.x - closest.x;
  const dy = point.y - closest.y;
  const distSq = dx * dx + dy * dy;
  const minDist = radius + edgeRadius;

  // The traversable aperture is not a wall; only the rim/end geometry should resolve as solid.
  if (Math.abs(local.along) < halfWidth && Math.abs(local.normal) <= radius) return null;
  if (distSq >= minDist * minDist) return null;

  const dist = Math.sqrt(distSq) || 0.1;
  return {
    normal: { x: dx / dist, y: dy / dist },
    overlap: minDist - dist,
    closest,
    local,
  };
};

const smoothstep = (t: number) => t * t * (3 - 2 * t);

const getApertureEdgeWeight = (distAlong: number, width: number) => {
  const halfWidth = width / 2;
  const falloffBand = Math.max(width * PORTAL_EDGE_FALLOFF_RATIO, 1);
  const edgeDistance = Math.abs(distAlong) - halfWidth;

  if (edgeDistance <= -falloffBand) return 1;
  if (edgeDistance >= falloffBand) return 0;

  const bandT = (edgeDistance + falloffBand) / (falloffBand * 2);
  return 1 - smoothstep(bandT);
};

export const transformThroughPortal = (vector: Point, entry: Portal, exit: Portal): Point => {
  const along = vector.x * entry.dir.x + vector.y * entry.dir.y;
  const normal = vector.x * entry.normal.x + vector.y * entry.normal.y;
  return {
    x: along * exit.dir.x - normal * exit.normal.x,
    y: along * exit.dir.y - normal * exit.normal.y,
  };
};


export type DragState = {
  id: string | null;
  type: 'ball' | 'portal' | 'handle' | null;
};

type VerletBody = {
  x: number;
  y: number;
  oldX: number;
  oldY: number;
  vx?: number;
  vy?: number;
};

export const getPinnedBallIndex = (dragState: DragState): number => {
  if (dragState.type !== 'ball' || dragState.id === null) return -1;
  const pinnedIdx = Number(dragState.id);
  return Number.isInteger(pinnedIdx) && pinnedIdx >= 0 ? pinnedIdx : -1;
};

export const syncPinnedBallToPointer = <T extends VerletBody>(
  bodies: T[],
  dragState: DragState,
  pointer: Point,
  frameDt?: number,
): number => {
  const pinnedIdx = getPinnedBallIndex(dragState);
  const body = bodies[pinnedIdx];
  if (!body) return -1;

  const prevX = body.x;
  const prevY = body.y;
  body.oldX = prevX;
  body.oldY = prevY;
  body.x = pointer.x;
  body.y = pointer.y;

  if (frameDt !== undefined && frameDt > 0 && body.vx !== undefined && body.vy !== undefined) {
    body.vx = (body.x - prevX) / frameDt;
    body.vy = (body.y - prevY) / frameDt;
  }

  return pinnedIdx;
};

export const computeGravityAt = (
  x: number,
  y: number,
  portals: Portal[],
  config: { vacuum: boolean; gravity: number; correctGravity: boolean; portalPull: number },
): Point => {
  const currentBaseG = getBaselineG(config.vacuum, config.gravity);
  let gx = 0;
  let gy = currentBaseG;
  if (!config.correctGravity || portals.length < 2) return { x: gx, y: gy };
  const ambient = { x: 0, y: currentBaseG };

  portals.forEach((entry, i) => {
    const exit = portals[(i + 1) % 2];
    const local = getPortalLocal({ x, y }, entry);
    const influenceRange = entry.width * 1.25;
    const edgeWeight = getApertureEdgeWeight(distAlong, entry.width);

    if (distNormal > 0 && distNormal < influenceRange && edgeWeight > 0) {
      const leaked = transformThroughPortal(ambient, exit, entry);
      const distWeight = Math.pow(1 - distNormal / influenceRange, 1.5);
    if (local.normal > 0 && local.normal < influenceRange && isWithinPortalAperture(local, entry)) {
      const leaked = transformThroughPortal(ambient, exit, entry);
      const distWeight = Math.pow(1 - local.normal / influenceRange, 1.5);
      const edgeWeight = Math.cos((local.along / getPortalApertureHalfWidth(entry)) * (Math.PI / 2));
      const weight = distWeight * edgeWeight * config.portalPull;
      gx += (leaked.x - ambient.x) * weight;
      gy += (leaked.y - ambient.y) * weight;
    }
  });

  return { x: gx, y: gy };
};

export const getCrossingIntersection = (oldPos: Point, newPos: Point, portal: Portal, radius = 0) => {
  const prevLocal = getPortalLocal(oldPos, portal);
  const currLocal = getPortalLocal(newPos, portal);
  if (Math.sign(prevLocal.normal) === Math.sign(currLocal.normal)) return null;
  const t = Math.abs(prevLocal.normal) / (Math.abs(prevLocal.normal) + Math.abs(currLocal.normal));
  const interX = oldPos.x + (newPos.x - oldPos.x) * t;
  const interY = oldPos.y + (newPos.y - oldPos.y) * t;
  const local = getPortalLocal({ x: interX, y: interY }, portal);
  if (!isWithinPortalAperture(local, portal, radius)) return null;
  return { interX, interY, dotPrev: prevLocal.normal, local };
};
