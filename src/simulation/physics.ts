import type { Point, Portal } from './types';

export const BASE_G = 800;
const PORTAL_EDGE_FALLOFF_RATIO = 0.2;

export const getBaselineG = (vacuum: boolean, gravityMult: number) => (vacuum ? 1100 : BASE_G) * gravityMult;

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
    const dx = x - entry.x;
    const dy = y - entry.y;
    const distNormal = dx * entry.normal.x + dy * entry.normal.y;
    const distAlong = dx * entry.dir.x + dy * entry.dir.y;
    const influenceRange = entry.width * 1.25;
    const edgeWeight = getApertureEdgeWeight(distAlong, entry.width);

    if (distNormal > 0 && distNormal < influenceRange && edgeWeight > 0) {
      const leaked = transformThroughPortal(ambient, exit, entry);
      const distWeight = Math.pow(1 - distNormal / influenceRange, 1.5);
      const weight = distWeight * edgeWeight * config.portalPull;
      gx += (leaked.x - ambient.x) * weight;
      gy += (leaked.y - ambient.y) * weight;
    }
  });

  return { x: gx, y: gy };
};

export const getCrossingIntersection = (oldPos: Point, newPos: Point, portal: Portal) => {
  const dotPrev = (oldPos.x - portal.x) * portal.normal.x + (oldPos.y - portal.y) * portal.normal.y;
  const dotCurr = (newPos.x - portal.x) * portal.normal.x + (newPos.y - portal.y) * portal.normal.y;
  if (Math.sign(dotPrev) === Math.sign(dotCurr)) return null;
  const t = Math.abs(dotPrev) / (Math.abs(dotPrev) + Math.abs(dotCurr));
  const interX = oldPos.x + (newPos.x - oldPos.x) * t;
  const interY = oldPos.y + (newPos.y - oldPos.y) * t;
  const distAlong = (interX - portal.x) * portal.dir.x + (interY - portal.y) * portal.dir.y;
  if (Math.abs(distAlong) > portal.width / 2) return null;
  return { interX, interY, dotPrev };
};
