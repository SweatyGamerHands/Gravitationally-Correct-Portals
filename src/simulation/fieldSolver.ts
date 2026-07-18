import type { Point, Portal } from './types';
import { BASE_G, DEFAULT_FIELD_CLAMP, DEFAULT_FIELD_MAX_DEPTH } from './constants';
import { mag, mapAccelerationThroughPortal, mapPointThroughPortal, scale, worldPointToPortalLocal } from './portalTransform';

export type FieldConfig = { vacuum?: boolean; gravity: number; correctGravity?: boolean; portalPull?: number; twoSided?: boolean; maxDepth?: number; fieldClamp?: number };
export type FieldSample = { acceleration: Point; directWeight: number; portalWeight: number; contributions: { portalId: string; depth: number; weight: number; vector: Point }[] };

const smoothstep = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const getBaselineG = (_vacuum: boolean | undefined, gravityMult: number) => BASE_G * gravityMult;

export const apertureVisibilityWeight = (point: Point, portal: Portal, twoSided = true): number => {
  const local = worldPointToPortalLocal(point, portal);
  if (!twoSided && local.normal < 0) return 0;
  const half = portal.width / 2;
  const absN = Math.abs(local.normal);
  const edgeDistance = half - Math.abs(local.along);
  const edgeSoft = Math.max(8, portal.width * 0.12);
  const edge = smoothstep(clamp01((edgeDistance + edgeSoft) / (2 * edgeSoft)));
  const apertureAngle = Math.atan2(half, absN + half * 0.18) / (Math.PI / 2);
  const face = twoSided ? 1 : smoothstep(clamp01(local.normal / Math.max(10, portal.width * 0.18)));
  const rangeFade = 1 / (1 + (absN / Math.max(1, portal.width * 1.8)) ** 2);
  return clamp01(edge * apertureAngle * face * rangeFade);
};

const linkedExit = (portals: Portal[], i: number) => portals[(i + 1) % portals.length];

export const sampleField = (point: Point, portals: Portal[], config: FieldConfig): FieldSample => {
  const base: Point = { x: 0, y: getBaselineG(config.vacuum, config.gravity) };
  if (!config.correctGravity || portals.length < 2 || mag(base) === 0) return { acceleration: base, directWeight: 1, portalWeight: 0, contributions: [] };
  const maxDepth = config.maxDepth ?? DEFAULT_FIELD_MAX_DEPTH;
  const pull = config.portalPull ?? 1;
  const twoSided = config.twoSided ?? true;
  const contributions: FieldSample['contributions'] = [];
  let totalPortalWeight = 0;
  let ax = 0; let ay = 0;
  const visit = (p: Point, vector: Point, depth: number, attenuation: number, path: string[]) => {
    if (depth >= maxDepth) return;
    portals.forEach((entry, i) => {
      if (path.at(-1) === entry.id) return;
      const w = apertureVisibilityWeight(p, entry, twoSided) * attenuation * pull;
      if (w <= 1e-5) return;
      const exit = linkedExit(portals, i);
      const transported = mapAccelerationThroughPortal(vector, exit, entry);
      const branchWeight = w * (0.62 ** depth);
      contributions.push({ portalId: entry.id, depth: depth + 1, weight: branchWeight, vector: transported });
      totalPortalWeight += branchWeight;
      ax += transported.x * branchWeight;
      ay += transported.y * branchWeight;
      if (depth + 1 < maxDepth && !path.includes(exit.id)) visit(mapPointThroughPortal(p, entry, exit), transported, depth + 1, attenuation * w * 0.5, [...path, entry.id, exit.id]);
    });
  };
  visit(point, base, 0, 1, []);
  const portalOcclusion = clamp01(totalPortalWeight);
  const directWeight = 1 - portalOcclusion;
  const denom = directWeight + totalPortalWeight || 1;
  let acceleration = { x: (base.x * directWeight + ax) / denom, y: (base.y * directWeight + ay) / denom };
  const m = mag(acceleration); const max = Math.max(config.fieldClamp ?? DEFAULT_FIELD_CLAMP, mag(base));
  if (m > max) acceleration = scale(acceleration, max / m);
  return { acceleration, directWeight: directWeight / denom, portalWeight: totalPortalWeight / denom, contributions };
};

export const computeGravityAt = (x: number, y: number, portals: Portal[], config: FieldConfig): Point => sampleField({ x, y }, portals, config).acceleration;
