import type { Point, Portal } from './types';
import { PORTAL_APERTURE_RADIUS_EPSILON, PORTAL_EDGE_RADIUS } from './constants';
import { worldPointToPortalLocal } from './portalTransform';

export const getPortalApertureHalfWidth = (portal: Portal) => portal.width / 2;
export const getUsablePortalHalfWidth = (portal: Portal, radius = 0, rimRadius = PORTAL_EDGE_RADIUS, clearance = PORTAL_APERTURE_RADIUS_EPSILON) => portal.width / 2 - radius - rimRadius - clearance;
export const isWithinPortalAperture = (local: { along: number }, portal: Portal, radius = 0) => { const usable = getUsablePortalHalfWidth(portal, radius); return usable >= 0 && Math.abs(local.along) <= usable + 1e-9; };
export const isWithinPortalSplitRenderAperture = (local: { along: number }, portal: Portal, radius = 0) => Math.abs(local.along) <= getPortalApertureHalfWidth(portal) + radius + PORTAL_APERTURE_RADIUS_EPSILON;

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
