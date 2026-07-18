import {
  PORTAL_BACK_PLATE_HALF_THICKNESS,
  PORTAL_COLLISION_EPSILON,
  PORTAL_EDGE_RADIUS,
  TELEPORT_COOLDOWN_SECONDS,
  TRAVERSAL_EPSILON,
} from './constants';
import { getPortalApertureEndpoints, getPortalRimCollision } from './collisions';
import { getLinkedPortal, isWithinPortalAperture, type TraversalBody } from './portalTraversal';
import {
  add,
  dot,
  mapVelocityThroughPortal,
  portalLocalToWorldPoint,
  worldPointToPortalLocal,
} from './portalTransform';
import { withPortalVectors, type Point, type Portal } from './types';

const MOTION_EPSILON = 1e-8;
const EVENT_TIME_EPSILON = 1e-7;
const MAX_MOTION_SUBDIVISIONS = 96;

export type PortalSweepOptions = {
  duration: number;
  twoSided: boolean;
  bounce: number;
};

export type PortalSweepResult = {
  teleported: number;
  blocked: number;
  rimImpacts: number;
};

type PlaneCrossing = {
  t: number;
  pose: Portal;
  along: number;
  fromFront: boolean;
};

type TraversalEvent = PlaneCrossing & {
  kind: 'traversal';
  entryFrom: Portal;
  entryTo: Portal;
  exitFrom: Portal;
  exitTo: Portal;
};

type BlockedEvent = PlaneCrossing & {
  kind: 'blocked';
  entryFrom: Portal;
  entryTo: Portal;
};

type RimEvent = {
  kind: 'rim';
  t: number;
  normal: Point;
  surfaceVelocity: Point;
  portalTo: Portal;
};

type RimHit = Omit<RimEvent, 'portalTo'>;

type PortalMotionEvent = TraversalEvent | BlockedEvent | RimEvent;

const eventPriority = (event: PortalMotionEvent) => {
  if (event.kind === 'rim') return 0;
  if (event.kind === 'blocked') return 1;
  return 2;
};

export const shortestAngleDelta = (from: number, to: number) => (
  Math.atan2(Math.sin(to - from), Math.cos(to - from))
);

// Pointer samples do not provide a continuous portal pose. Interpolate centers
// linearly and orientations over the shortest arc to construct that worldline.
export const interpolatePortalPose = (from: Portal, to: Portal, t: number): Portal => {
  const clampedT = Math.max(0, Math.min(1, t));
  return withPortalVectors({
    id: from.id,
    x: from.x + (to.x - from.x) * clampedT,
    y: from.y + (to.y - from.y) * clampedT,
    angle: from.angle + shortestAngleDelta(from.angle, to.angle) * clampedT,
    color: to.color,
    width: from.width + (to.width - from.width) * clampedT,
  });
};

const portalMoved = (from: Portal, to: Portal) => (
  Math.hypot(to.x - from.x, to.y - from.y) > MOTION_EPSILON
  || Math.abs(shortestAngleDelta(from.angle, to.angle)) > MOTION_EPSILON
  || Math.abs(to.width - from.width) > MOTION_EPSILON
);

const getMotionSubdivisions = (from: Portal, to: Portal) => {
  const angularSteps = Math.ceil(Math.abs(shortestAngleDelta(from.angle, to.angle)) / (Math.PI / 32));
  return Math.min(MAX_MOTION_SUBDIVISIONS, Math.max(4, angularSteps));
};

const signedDistanceAt = (point: Point, from: Portal, to: Portal, t: number, targetNormal = 0) => (
  worldPointToPortalLocal(point, interpolatePortalPose(from, to, t)).normal - targetNormal
);

const bisectPlaneRoot = (
  point: Point,
  from: Portal,
  to: Portal,
  startT: number,
  endT: number,
  startDistance: number,
  targetNormal: number,
) => {
  let low = startT;
  let high = endT;
  const startSign = Math.sign(startDistance);
  for (let iteration = 0; iteration < 36; iteration++) {
    const mid = (low + high) / 2;
    const distance = signedDistanceAt(point, from, to, mid, targetNormal);
    if (Math.abs(distance) <= MOTION_EPSILON) return mid;
    if (Math.sign(distance) === startSign) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
};

const getMovingPortalNormalCrossing = (
  body: Pick<TraversalBody, 'x' | 'y' | 'radius'>,
  from: Portal,
  to: Portal,
  targetNormal: number,
  direction: 'either' | 'increasing',
): PlaneCrossing | null => {
  if (!portalMoved(from, to)) return null;

  const point = { x: body.x, y: body.y };
  const subdivisions = getMotionSubdivisions(from, to);
  let previousT = 0;
  let previousDistance = signedDistanceAt(point, from, to, previousT, targetNormal);

  // Rotation makes signed distance non-linear. Small angular intervals locate
  // each sign change; bisection then recovers an accurate event time.
  for (let step = 1; step <= subdivisions; step++) {
    const currentT = step / subdivisions;
    const currentDistance = signedDistanceAt(point, from, to, currentT, targetNormal);
    const previousNearPlane = Math.abs(previousDistance) <= MOTION_EPSILON;
    const currentNearPlane = Math.abs(currentDistance) <= MOTION_EPSILON;
    const increasingCrossing = previousDistance < -MOTION_EPSILON && currentDistance > MOTION_EPSILON;
    const decreasingCrossing = previousDistance > MOTION_EPSILON && currentDistance < -MOTION_EPSILON;
    const changedSide = increasingCrossing || (direction === 'either' && decreasingCrossing);
    const leftPlane = previousNearPlane && (
      currentDistance > MOTION_EPSILON
      || (direction === 'either' && currentDistance < -MOTION_EPSILON)
    );
    const reachedPlane = currentNearPlane && (
      previousDistance < -MOTION_EPSILON
      || (direction === 'either' && previousDistance > MOTION_EPSILON)
    );

    if (changedSide || leftPlane || reachedPlane) {
      const t = previousNearPlane
        ? previousT
        : currentNearPlane
          ? currentT
          : bisectPlaneRoot(point, from, to, previousT, currentT, previousDistance, targetNormal);
      const pose = interpolatePortalPose(from, to, t);
      const local = worldPointToPortalLocal(point, pose);
      if (isWithinPortalAperture(local, pose, body.radius)) {
        const fromFront = previousNearPlane ? currentDistance < 0 : previousDistance > 0;
        return { t, pose, along: local.along, fromFront };
      }
    }

    previousT = currentT;
    previousDistance = currentDistance;
  }

  return null;
};

export const getMovingPortalPlaneCrossing = (
  body: Pick<TraversalBody, 'x' | 'y' | 'radius'>,
  from: Portal,
  to: Portal,
) => getMovingPortalNormalCrossing(body, from, to, 0, 'either');

export const getMovingPortalBackFaceContact = (
  body: Pick<TraversalBody, 'x' | 'y' | 'radius'>,
  from: Portal,
  to: Portal,
) => {
  const targetNormal = -(body.radius + PORTAL_BACK_PLATE_HALF_THICKNESS);
  const startLocal = worldPointToPortalLocal(body, from);
  const endLocal = worldPointToPortalLocal(body, to);
  const startsPenetratingBackPlate = (
    startLocal.normal >= targetNormal
    && startLocal.normal <= 0
    && endLocal.normal > startLocal.normal + MOTION_EPSILON
    && isWithinPortalAperture(startLocal, from, body.radius)
  );
  if (startsPenetratingBackPlate) {
    return { t: 0, pose: from, along: startLocal.along, fromFront: false };
  }
  return getMovingPortalNormalCrossing(body, from, to, targetNormal, 'increasing');
};

const getPortalPointVelocity = (
  from: Portal,
  to: Portal,
  pose: Portal,
  along: number,
  duration: number,
): Point => {
  const safeDuration = Math.max(duration, 1 / 1000);
  const translation = {
    x: (to.x - from.x) / safeDuration,
    y: (to.y - from.y) / safeDuration,
  };
  const angularVelocity = shortestAngleDelta(from.angle, to.angle) / safeDuration;
  return {
    x: translation.x + angularVelocity * along * pose.normal.x,
    y: translation.y + angularVelocity * along * pose.normal.y,
  };
};

const getMovingPointCircleHit = (
  body: TraversalBody,
  pointFrom: Point,
  pointTo: Point,
  startT: number,
  endT: number,
  duration: number,
): RimHit | null => {
  const moveX = pointTo.x - pointFrom.x;
  const moveY = pointTo.y - pointFrom.y;
  const moveLengthSq = moveX * moveX + moveY * moveY;
  if (moveLengthSq <= MOTION_EPSILON) return null;

  const radius = body.radius + PORTAL_EDGE_RADIUS;
  const offsetX = pointFrom.x - body.x;
  const offsetY = pointFrom.y - body.y;
  const c = offsetX * offsetX + offsetY * offsetY - radius * radius;
  let localT = 0;
  if (c > 0) {
    const b = 2 * (offsetX * moveX + offsetY * moveY);
    const discriminant = b * b - 4 * moveLengthSq * c;
    if (discriminant < 0) return null;
    localT = (-b - Math.sqrt(discriminant)) / (2 * moveLengthSq);
    if (localT < 0 || localT > 1) return null;
  }

  const endpoint = { x: pointFrom.x + moveX * localT, y: pointFrom.y + moveY * localT };
  const normalOffset = { x: body.x - endpoint.x, y: body.y - endpoint.y };
  const normalLength = Math.hypot(normalOffset.x, normalOffset.y);
  const normal = normalLength > MOTION_EPSILON
    ? { x: normalOffset.x / normalLength, y: normalOffset.y / normalLength }
    : { x: -moveX / Math.sqrt(moveLengthSq), y: -moveY / Math.sqrt(moveLengthSq) };
  const segmentDuration = Math.max((endT - startT) * duration, 1 / 1000);
  const surfaceVelocity = { x: moveX / segmentDuration, y: moveY / segmentDuration };
  const relativeNormal = (body.vx - surfaceVelocity.x) * normal.x + (body.vy - surfaceVelocity.y) * normal.y;
  if (relativeNormal >= -MOTION_EPSILON) return null;

  return {
    kind: 'rim',
    t: startT + (endT - startT) * localT,
    normal,
    surfaceVelocity,
  };
};

const getMovingPortalRimEvent = (
  body: TraversalBody,
  from: Portal,
  to: Portal,
  duration: number,
): RimEvent | null => {
  if (!portalMoved(from, to)) return null;
  const subdivisions = getMotionSubdivisions(from, to);
  let selected: RimEvent | null = null;

  for (let step = 0; step < subdivisions; step++) {
    const startT = step / subdivisions;
    const endT = (step + 1) / subdivisions;
    const startEndpoints = getPortalApertureEndpoints(interpolatePortalPose(from, to, startT));
    const endEndpoints = getPortalApertureEndpoints(interpolatePortalPose(from, to, endT));
    for (const [pointFrom, pointTo] of [
      [startEndpoints.start, endEndpoints.start],
      [startEndpoints.end, endEndpoints.end],
    ] as const) {
      const hit = getMovingPointCircleHit(body, pointFrom, pointTo, startT, endT, duration);
      if (hit && (!selected || hit.t < selected.t)) selected = { ...hit, portalTo: to };
    }
  }

  return selected;
};

const selectEarlierEvent = (selected: PortalMotionEvent | null, candidate: PortalMotionEvent | null) => {
  if (!candidate) return selected;
  if (
    !selected
    || candidate.t < selected.t - EVENT_TIME_EPSILON
    || (
      Math.abs(candidate.t - selected.t) <= EVENT_TIME_EPSILON
      && eventPriority(candidate) < eventPriority(selected)
    )
  ) return candidate;
  return selected;
};

const applyTraversal = (body: TraversalBody, event: TraversalEvent, duration: number) => {
  const exitPose = interpolatePortalPose(event.exitFrom, event.exitTo, event.t);
  const entrySurfaceVelocity = getPortalPointVelocity(
    event.entryFrom,
    event.entryTo,
    event.pose,
    event.along,
    duration,
  );
  const exitSurfaceVelocity = getPortalPointVelocity(
    event.exitFrom,
    event.exitTo,
    exitPose,
    event.along,
    duration,
  );
  // Galilean moving-frame transfer: v_out = V_exit + R(v_in - V_entry).
  const relativeVelocity = { x: body.vx - entrySurfaceVelocity.x, y: body.vy - entrySurfaceVelocity.y };
  const mappedRelativeVelocity = mapVelocityThroughPortal(relativeVelocity, event.pose, exitPose);
  const mappedVelocity = add(mappedRelativeVelocity, exitSurfaceVelocity);
  const exitSide = Math.sign(dot(mappedRelativeVelocity, exitPose.normal)) || (event.fromFront ? 1 : -1);
  const mappedCenter = portalLocalToWorldPoint({ along: event.along, normal: 0 }, exitPose);

  body.x = mappedCenter.x + exitPose.normal.x * exitSide * TRAVERSAL_EPSILON;
  body.y = mappedCenter.y + exitPose.normal.y * exitSide * TRAVERSAL_EPSILON;
  body.vx = mappedVelocity.x;
  body.vy = mappedVelocity.y;
  body.oldX = body.x;
  body.oldY = body.y;
  body.cooldown = TELEPORT_COOLDOWN_SECONDS;
  if (body.trail) body.trail.length = 0;
};

const applyBlockedFace = (body: TraversalBody, event: BlockedEvent, duration: number, bounce: number) => {
  const surfaceVelocity = getPortalPointVelocity(
    event.entryFrom,
    event.entryTo,
    event.pose,
    event.along,
    duration,
  );
  const collisionNormal = { x: -event.pose.normal.x, y: -event.pose.normal.y };
  const relativeNormal = (
    (body.vx - surfaceVelocity.x) * collisionNormal.x
    + (body.vy - surfaceVelocity.y) * collisionNormal.y
  );
  if (relativeNormal < 0) {
    const impulse = (1 + Math.max(0, bounce)) * relativeNormal;
    body.vx -= impulse * collisionNormal.x;
    body.vy -= impulse * collisionNormal.y;
  }

  const finalLocal = worldPointToPortalLocal(body, event.entryTo);
  const usableHalfWidth = Math.max(0, event.entryTo.width / 2 - body.radius - PORTAL_EDGE_RADIUS);
  const along = Math.max(-usableHalfWidth, Math.min(usableHalfWidth, finalLocal.along));
  const clearance = body.radius + PORTAL_BACK_PLATE_HALF_THICKNESS + PORTAL_COLLISION_EPSILON;
  const supported = portalLocalToWorldPoint({ along, normal: -clearance }, event.entryTo);
  body.x = supported.x;
  body.y = supported.y;
  body.oldX = body.x;
  body.oldY = body.y;
  if (body.trail) body.trail.length = 0;
};

const applyRimImpact = (body: TraversalBody, event: RimEvent, bounce: number) => {
  const relativeNormal = (
    (body.vx - event.surfaceVelocity.x) * event.normal.x
    + (body.vy - event.surfaceVelocity.y) * event.normal.y
  );
  if (relativeNormal < 0) {
    const impulse = (1 + Math.max(0, bounce)) * relativeNormal;
    body.vx -= impulse * event.normal.x;
    body.vy -= impulse * event.normal.y;
  }

  const overlap = getPortalRimCollision(body, body.radius, event.portalTo);
  if (overlap) {
    body.x += overlap.normal.x * (overlap.overlap + PORTAL_COLLISION_EPSILON);
    body.y += overlap.normal.y * (overlap.overlap + PORTAL_COLLISION_EPSILON);
  }
  body.oldX = body.x;
  body.oldY = body.y;
};

export const resolveMovingPortalSweeps = (
  bodies: TraversalBody[],
  fromPortals: readonly Portal[],
  toPortals: readonly Portal[],
  options: PortalSweepOptions,
): PortalSweepResult => {
  const duration = Math.max(options.duration, 1 / 1000);
  const result = { teleported: 0, blocked: 0, rimImpacts: 0 };

  for (const body of bodies) {
    let selected: PortalMotionEvent | null = null;

    // Resolve one earliest worldsheet event per body and pointer sample. Solid
    // rim/back contacts win ties so an aperture cannot capture through its edge.
    for (let index = 0; index < fromPortals.length; index++) {
      const entryFrom = fromPortals[index];
      const entryTo = toPortals[index];
      if (!entryTo || entryTo.id !== entryFrom.id || !portalMoved(entryFrom, entryTo)) continue;

      selected = selectEarlierEvent(selected, getMovingPortalRimEvent(body, entryFrom, entryTo, duration));
      if (!options.twoSided) {
        const blockedContact = getMovingPortalBackFaceContact(body, entryFrom, entryTo);
        if (blockedContact) {
          selected = selectEarlierEvent(selected, {
            ...blockedContact,
            kind: 'blocked',
            entryFrom,
            entryTo,
          });
        }
      }
      const crossing = getMovingPortalPlaneCrossing(body, entryFrom, entryTo);
      if (!crossing) continue;

      if (!options.twoSided && !crossing.fromFront) {
        continue;
      }

      if ((body.cooldown ?? 0) > 0) continue;
      const exitFrom = getLinkedPortal(fromPortals, index);
      const exitTo = getLinkedPortal(toPortals, index);
      if (!exitFrom || !exitTo || exitFrom.id !== exitTo.id) continue;
      selected = selectEarlierEvent(selected, {
        ...crossing,
        kind: 'traversal',
        entryFrom,
        entryTo,
        exitFrom,
        exitTo,
      });
    }

    if (!selected) continue;
    if (selected.kind === 'traversal') {
      applyTraversal(body, selected, duration);
      result.teleported++;
    } else if (selected.kind === 'blocked') {
      applyBlockedFace(body, selected, duration, options.bounce);
      result.blocked++;
    } else {
      applyRimImpact(body, selected, options.bounce);
      result.rimImpacts++;
    }
  }

  return result;
};
