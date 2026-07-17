import type { Point, Portal } from './types';
import { PORTAL_EDGE_RADIUS, TRAVERSAL_EPSILON } from './constants';
import { computeGravityAt, type FieldConfig } from './fieldSolver';
import { dot, mapPointThroughPortal, mapVelocityThroughPortal, normalize, worldPointToPortalLocal } from './portalTransform';
import { getUsablePortalHalfWidth, isWithinPortalAperture } from './portalTraversal';
import type { Ball } from './Ball';

export type StepWorld = FieldConfig & { width: number; height: number; portals: Portal[]; friction: number; bounce: number; twoSided: boolean };
export const NUMERICAL_CLEARANCE = 0.1;
export const portalRimRadius = PORTAL_EDGE_RADIUS;
export const usablePortalHalfWidth = getUsablePortalHalfWidth;
export const canBodyTraverseAperture = (local: { along: number }, portal: Portal, bodyRadius: number) => isWithinPortalAperture(local, portal, bodyRadius);

type Event = { type: 'portal'; t: number; entry: Portal; exit: Portal; point: Point; local: { along: number; normal: number }; fromFront: boolean } | { type: 'wall'; t: number; normal: Point } | { type: 'rim'; t: number; normal: Point; point: Point; portal?: Portal };
const EPS_T = 1e-7;
const OVERLAP_EPS = 1e-5;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function crossingEvent(body: Ball, p0: Point, p1: Point, world: StepWorld, ignore?: { portalId: string; side: number } | null): Event | null {
  let best: Event | null = null;
  for (let i = 0; i < world.portals.length; i++) {
    const entry = world.portals[i], exit = world.portals[(i + 1) % world.portals.length];
    const a = worldPointToPortalLocal(p0, entry), b = worldPointToPortalLocal(p1, entry);
    if (a.normal === b.normal || Math.sign(a.normal) === Math.sign(b.normal)) continue;
    const t = Math.abs(a.normal) / (Math.abs(a.normal) + Math.abs(b.normal));
    if (t < EPS_T) {
      const side = Math.sign(a.normal) || Math.sign(b.normal) || 1;
      if (ignore?.portalId === entry.id && side === ignore.side) continue;
    }
    const point = { x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t };
    const local = worldPointToPortalLocal(point, entry);
    const fromFront = a.normal > 0;
    if (world.twoSided || fromFront) {
      if (!canBodyTraverseAperture(local, entry, body.radius)) continue;
      const ev: Event = { type: 'portal', t, entry, exit, point, local, fromFront };
      if (!best || ev.t < best.t) best = ev;
    } else if (Math.abs(local.along) <= usablePortalHalfWidth(entry, body.radius)) {
      // A one-sided back-face collision is a wall whose outward normal points
      // back toward the blocked side, opposite the portal's front normal.
      const ev: Event = { type: 'rim', t, normal: { x: -entry.normal.x, y: -entry.normal.y }, point, portal: entry };
      if (!best || ev.t < best.t) best = ev;
    }
  }
  return best;
}

function wallEvent(body: Ball, p0: Point, p1: Point, world: StepWorld): Event | null {
  const dx = p1.x - p0.x, dy = p1.y - p0.y; let best: Event | null = null;
  const cand: Event[] = [];
  if (dx < 0) cand.push({ type: 'wall', t: (body.radius - p0.x) / dx, normal: { x: 1, y: 0 } });
  if (dx > 0) cand.push({ type: 'wall', t: (world.width - body.radius - p0.x) / dx, normal: { x: -1, y: 0 } });
  if (dy < 0) cand.push({ type: 'wall', t: (body.radius - p0.y) / dy, normal: { x: 0, y: 1 } });
  if (dy > 0) cand.push({ type: 'wall', t: (world.height - body.radius - p0.y) / dy, normal: { x: 0, y: -1 } });
  for (const ev of cand) if (ev.t >= EPS_T && ev.t <= 1 && (!best || ev.t < best.t)) best = ev;
  return best;
}

function rimEvent(body: Ball, p0: Point, p1: Point, world: StepWorld): Event | null {
  const v = { x: p1.x - p0.x, y: p1.y - p0.y }; let best: Event | null = null;
  for (const portal of world.portals) for (const s of [-1, 1]) {
    const center = { x: portal.x + portal.dir.x * portal.width / 2 * s, y: portal.y + portal.dir.y * portal.width / 2 * s };
    const r = body.radius + PORTAL_EDGE_RADIUS;
    const ox = p0.x - center.x, oy = p0.y - center.y;
    const A = dot(v, v), B = 2 * (ox * v.x + oy * v.y), C = ox * ox + oy * oy - r * r;
    if (C <= 0) {
      const outward = normalize({ x: ox || -v.x || portal.normal.x, y: oy || -v.y || portal.normal.y });
      const incoming = body.vx * outward.x + body.vy * outward.y < 0;
      if (incoming || C < -OVERLAP_EPS) {
        const ev: Event = { type: 'rim', t: 0, normal: outward, point: p0, portal };
        if (!best || ev.t < best.t) best = ev;
      }
      continue;
    }
    const disc = B * B - 4 * A * C; if (A <= 0 || disc < 0) continue;
    const t = (-B - Math.sqrt(disc)) / (2 * A);
    if (t >= EPS_T && t <= 1) {
      const point = { x: p0.x + v.x * t, y: p0.y + v.y * t };
      const normal = normalize({ x: point.x - center.x, y: point.y - center.y });
      const ev: Event = { type: 'rim', t, normal, point, portal };
      if (!best || ev.t < best.t) best = ev;
    }
  }
  return best;
}

const applyAccelerationAndFriction = (body: Ball, dt: number, world: StepWorld) => {
  if (dt <= 0) return;
  const g = computeGravityAt(body.x, body.y, world.portals, world);
  const f = Math.pow(world.friction, dt * 60);
  body.vx = body.vx * f + g.x * dt;
  body.vy = body.vy * f + g.y * dt;
};

const reflectVelocity = (body: Ball, normal: Point, bounce: number) => {
  const vn = body.vx * normal.x + body.vy * normal.y;
  if (vn < 0) { body.vx -= (1 + bounce) * vn * normal.x; body.vy -= (1 + bounce) * vn * normal.y; }
};

export function stepBodyContinuous(body: Ball, fixedDt: number, world: StepWorld) {
  let remaining = fixedDt; let guard = 0; let ignore: { portalId: string; side: number } | null = body.lastExit ?? null;
  body.oldX = body.x; body.oldY = body.y;
  while (remaining > 1e-7 && guard++ < 12) {
    const startV = { x: body.vx, y: body.vy };
    const g = computeGravityAt(body.x, body.y, world.portals, world);
    const predictedV = { x: body.vx * Math.pow(world.friction, remaining * 60) + g.x * remaining, y: body.vy * Math.pow(world.friction, remaining * 60) + g.y * remaining };
    const avgV = { x: (startV.x + predictedV.x) * 0.5, y: (startV.y + predictedV.y) * 0.5 };
    const p0 = { x: body.x, y: body.y }, p1 = { x: body.x + avgV.x * remaining, y: body.y + avgV.y * remaining };
    const events = [crossingEvent(body, p0, p1, world, ignore), rimEvent(body, p0, p1, world), wallEvent(body, p0, p1, world)].filter(Boolean) as Event[];
    const ev = events.sort((a,b)=>a.t-b.t)[0];
    if (!ev) {
      applyAccelerationAndFriction(body, remaining, world);
      body.x += body.vx * remaining;
      body.y += body.vy * remaining;
      break;
    }
    const eventFraction = clamp01(ev.t);
    const dtEvent = remaining * eventFraction;
    applyAccelerationAndFriction(body, dtEvent, world);
    body.x = p0.x + (p1.x - p0.x) * eventFraction;
    body.y = p0.y + (p1.y - p0.y) * eventFraction;
    remaining -= dtEvent;
    if (ev.type === 'portal') {
      body.addTrailPoint(true);
      const mapped = mapPointThroughPortal(ev.point, ev.entry, ev.exit);
      const mv = mapVelocityThroughPortal({ x: body.vx, y: body.vy }, ev.entry, ev.exit);
      body.vx = mv.x; body.vy = mv.y;
      const flowSign = Math.sign(body.vx * ev.exit.normal.x + body.vy * ev.exit.normal.y) || 1;
      body.x = mapped.x + ev.exit.normal.x * flowSign * TRAVERSAL_EPSILON;
      body.y = mapped.y + ev.exit.normal.y * flowSign * TRAVERSAL_EPSILON;
      body.lastExit = { portalId: ev.exit.id, side: Math.sign(flowSign) || 1 };
      body.addTrailPoint(true);
      ignore = body.lastExit;
    } else {
      reflectVelocity(body, ev.normal, world.bounce);
      body.x += ev.normal.x * TRAVERSAL_EPSILON;
      body.y += ev.normal.y * TRAVERSAL_EPSILON;
      body.lastExit = null; ignore = null;
    }
  }
  body.oldX = body.x; body.oldY = body.y;
  body.addTrailPoint(false, fixedDt);
  if (![body.x, body.y, body.vx, body.vy].every(Number.isFinite)) { body.x = body.oldX = world.width/2; body.y = body.oldY = world.height/2; body.vx = body.vy = 0; }
}

export function resolveBallBallCollisions(balls: Ball[], bounce: number, pinnedIdx = -1) {
  for (let i=0;i<balls.length;i++) for (let j=i+1;j<balls.length;j++) {
    const a=balls[i], b=balls[j]; const dx=b.x-a.x, dy=b.y-a.y, d=Math.hypot(dx,dy)||1; const min=a.radius+b.radius; if (d>=min) continue;
    const nx=dx/d, ny=dy/d, overlap=min-d; const wa=i===pinnedIdx?0:(j===pinnedIdx?1:b.mass/(a.mass+b.mass)); const wb=j===pinnedIdx?0:(i===pinnedIdx?1:a.mass/(a.mass+b.mass));
    a.x-=nx*overlap*wa; a.y-=ny*overlap*wa; b.x+=nx*overlap*wb; b.y+=ny*overlap*wb;
    const rvx=a.vx-b.vx, rvy=a.vy-b.vy, vn=rvx*nx+rvy*ny; if (vn>0) { const imp=(1+bounce)*vn; a.vx-=imp*nx*wa; a.vy-=imp*ny*wa; b.vx+=imp*nx*wb; b.vy+=imp*ny*wb; }
  }
}
