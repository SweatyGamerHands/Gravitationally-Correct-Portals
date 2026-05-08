import type { Point, Portal } from './types';

export const BASE_G = 800;
export const getBaselineG = (vacuum: boolean, gravityMult: number) => (vacuum ? 1100 : BASE_G) * gravityMult;

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
): number => {
  const pinnedIdx = getPinnedBallIndex(dragState);
  const body = bodies[pinnedIdx];
  if (!body) return -1;

  body.oldX = body.x;
  body.oldY = body.y;
  body.x = pointer.x;
  body.y = pointer.y;

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
    const dx = x - entry.x;
    const dy = y - entry.y;
    const distNormal = dx * entry.normal.x + dy * entry.normal.y;
    const distAlong = dx * entry.dir.x + dy * entry.dir.y;
    const influenceRange = entry.width * 1.25;

    if (distNormal > 0 && distNormal < influenceRange && Math.abs(distAlong) < entry.width / 2) {
      const leaked = transformThroughPortal(ambient, exit, entry);
      const distWeight = Math.pow(1 - distNormal / influenceRange, 1.5);
      const edgeWeight = Math.cos((distAlong / (entry.width / 2)) * (Math.PI / 2));
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
