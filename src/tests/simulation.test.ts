import test from 'node:test';
import assert from 'node:assert/strict';
import {
  apertureVisibilityWeight,
  computeGravityAt,
  computePotentialAt,
  DEFAULT_TWO_SIDED,
  findAvailableBallSpawn,
  getBaselineG,
  getCrossingIntersection,
  getLinkedPortal,
  getMovingPortalBackFaceContact,
  getMovingPortalPlaneCrossing,
  getPinnedBallIndex,
  getPortalLocal,
  getPortalSegmentCollision,
  getSweptPortalRimCollision,
  getScaledFrameDt,
  integratePosition,
  integrateVelocity,
  isWithinPortalAperture,
  simulateLinearDisplacement,
  syncPinnedBallToPointer,
  transformThroughPortal,
  mapPointThroughPortal,
  mapVelocityThroughPortal,
  MAX_BALLS,
  PORTAL_EDGE_RADIUS,
  interpolatePortalPose,
  movePortalForEditor,
  resolveMovingPortalSweeps,
  sampleField,
  shortestAngleDelta,
} from '../simulation/physics';
import { withPortalVectors, type Point } from '../simulation/types';
import { Ball } from '../simulation/Ball';

const portals = [
  withPortalVectors({ id: 'a', x: 100, y: 100, angle: 0, color: '#f90', width: 100 }),
  withPortalVectors({ id: 'b', x: 300, y: 100, angle: Math.PI, color: '#09f', width: 100 }),
];

test('baseline gravity ignores vacuum mode', () => {
  assert.equal(getBaselineG(false, 1), 800);
  assert.equal(getBaselineG(true, 1), 800);
});

test('portals default to one-sided entry', () => {
  assert.equal(DEFAULT_TWO_SIDED, false);
});

test('portal transform flips normal component', () => {
  const v = transformThroughPortal({ x: 0, y: 10 }, portals[0], portals[1]);
  assert.ok(Math.abs(v.x) < 1e-9);
  assert.ok(Math.abs(v.y - 10) < 1e-9);
});

test('crossing detected within aperture', () => {
  const hit = getCrossingIntersection({ x: 100, y: 50 }, { x: 100, y: 150 }, portals[0]);
  assert.ok(hit);
});

test('gravity compute returns ambient without a linked portal pair', () => {
  const g = computeGravityAt(100, 100, [portals[0]], { vacuum: false, gravity: 1 });
  assert.equal(g.x, 0);
  assert.equal(g.y, 800);
});

test('gravity compute changes continuously across aperture edge falloff', () => {
  const edgePortals = [
    withPortalVectors({ id: 'entry', x: 100, y: 100, angle: 0, color: '#f90', width: 100 }),
    withPortalVectors({ id: 'exit', x: 300, y: 100, angle: Math.PI / 2, color: '#09f', width: 100 }),
  ];
  const config = { vacuum: false, gravity: 1 };
  const halfWidth = edgePortals[0].width / 2;
  const epsilon = 0.001;
  const inside = computeGravityAt(100 + halfWidth - epsilon, 120, edgePortals, config);
  const outside = computeGravityAt(100 + halfWidth + epsilon, 120, edgePortals, config);
  const delta = Math.hypot(outside.x - inside.x, outside.y - inside.y);

  assert.ok(delta < 1, `expected no gravity jump at aperture edge, got ${delta}`);
  assert.notEqual(inside.x, 0);
  assert.notEqual(outside.x, 0);
});

test('scaled frame dt applies timeScale linearly and clamps real dt before scaling', () => {
  assert.equal(getScaledFrameDt(1 / 60, 0.5), 1 / 120);
  assert.equal(getScaledFrameDt(1 / 60, 2), 1 / 30);
  assert.equal(getScaledFrameDt(1, 2), 1 / 15);
  assert.equal(getScaledFrameDt(-1, 1), 0);
});

test('timeScale controls displacement predictably over equal real time', () => {
  const velocity = { x: 120, y: -40 };
  const slow = simulateLinearDisplacement(velocity, 1, 0.5);
  const normal = simulateLinearDisplacement(velocity, 1, 1);
  const fast = simulateLinearDisplacement(velocity, 1, 2);

  assert.ok(Math.abs(slow.x - normal.x * 0.5) < 1e-9);
  assert.ok(Math.abs(slow.y - normal.y * 0.5) < 1e-9);
  assert.ok(Math.abs(fast.x - normal.x * 2) < 1e-9);
  assert.ok(Math.abs(fast.y - normal.y * 2) < 1e-9);
});

test('explicit velocity integration uses seconds for velocity and acceleration', () => {
  const dt = getScaledFrameDt(1 / 60, 2);
  const nextVelocity = integrateVelocity({ x: 60, y: 0 }, { x: 0, y: 120 }, 1, dt);
  const nextPosition = integratePosition({ x: 0, y: 0 }, nextVelocity, dt);

  assert.equal(nextVelocity.x, 60);
  assert.equal(nextVelocity.y, 4);
  assert.ok(Math.abs(nextPosition.x - 2) < 1e-9);
  assert.ok(Math.abs(nextPosition.y - 2 / 15) < 1e-9);
});

test('crossing eligibility requires the full ball to clear the solid rim', () => {
  const portal = portals[0];
  const radius = 10;

  for (const side of [1, -1]) {
    const edgeX = portal.x + side * portal.width / 2;
    const overlappingRim = getCrossingIntersection(
      { x: edgeX + side * (radius + PORTAL_EDGE_RADIUS - 0.5), y: portal.y - 20 },
      { x: edgeX + side * (radius + PORTAL_EDGE_RADIUS - 0.5), y: portal.y + 20 },
      portal,
      radius,
    );
    assert.equal(overlappingRim, null);

    const justInside = getCrossingIntersection(
      { x: edgeX - side * (radius + PORTAL_EDGE_RADIUS + 0.5), y: portal.y - 20 },
      { x: edgeX - side * (radius + PORTAL_EDGE_RADIUS + 0.5), y: portal.y + 20 },
      portal,
      radius,
    );
    assert.ok(justInside);
  }
});

test('grazing an aperture endcap collides with portal edge capsule', () => {
  const portal = portals[0];
  const radius = 10;
  const edgeX = portal.x + portal.width / 2;

  const grazingHit = getPortalSegmentCollision({ x: edgeX + radius + PORTAL_EDGE_RADIUS - 0.5, y: portal.y }, radius, portal);
  assert.ok(grazingHit);
  assert.ok(grazingHit.overlap > 0);
  assert.ok(grazingHit.normal.x > 0);

  const clearMiss = getPortalSegmentCollision({ x: edgeX + radius + PORTAL_EDGE_RADIUS + 1, y: portal.y }, radius, portal);
  assert.equal(clearMiss, null);
});

test('swept rim collision detects a ball that tunnels past an endpoint', () => {
  const portal = portals[0];
  const edgeX = portal.x + portal.width / 2;
  const hit = getSweptPortalRimCollision(
    { x: edgeX - 0.5, y: portal.y - 40 },
    { x: edgeX - 0.5, y: portal.y + 40 },
    10,
    portal,
  );

  assert.ok(hit);
  assert.ok(hit.t > 0 && hit.t < 1);
  assert.ok(hit.normal.y < 0);
});

test('back-face approach outside aperture is not eligible for support or crossing', () => {
  const portal = portals[0];
  const radius = 10;
  const outsideX = portal.x + portal.width / 2 + radius + PORTAL_EDGE_RADIUS + 0.5;
  const backFacePoint = { x: outsideX, y: portal.y - radius / 2 };
  const local = getPortalLocal(backFacePoint, portal);

  assert.equal(isWithinPortalAperture(local, portal, radius), false);
  assert.equal(
    getCrossingIntersection(backFacePoint, { x: outsideX, y: portal.y + radius / 2 }, portal, radius),
    null,
  );
});

test('blocked back support does not stop tangential velocity before penetration', () => {
  const portal = withPortalVectors({ id: 'vertical', x: 100, y: 100, angle: Math.PI / 2, color: '#f90', width: 100 });
  const ball = new Ball(111.3, 100, 10, 1);
  ball.vx = -2;
  ball.vy = 0;

  ball.blockedFaceSupport(portal);

  assert.equal(ball.x, 111.3);
  assert.equal(ball.y, 100);
  assert.equal(ball.vx, -2);
  assert.equal(ball.vy, 0);
});

test('blocked back support preserves separating tangential velocity on penetration', () => {
  const portal = withPortalVectors({ id: 'vertical', x: 100, y: 100, angle: Math.PI / 2, color: '#f90', width: 100 });
  const ball = new Ball(110, 100, 10, 1);
  ball.vx = 5;
  ball.vy = 0;

  ball.blockedFaceSupport(portal);

  assert.equal(ball.x, 111.1);
  assert.equal(ball.y, 100);
  assert.equal(ball.vx, 5);
  assert.equal(ball.vy, 0);
});


test('zero explicit velocity stays zero even when old position is stale', () => {
  const ball = new Ball(10, 10, 5, 1);
  ball.oldX = 0;
  ball.oldY = 0;

  ball.update(1, () => ({ x: 0, y: 0 }), 1 / 60);

  assert.equal(ball.vx, 0);
  assert.equal(ball.vy, 0);
  assert.equal(ball.x, 10);
  assert.equal(ball.y, 10);
});

test('wall collision updates explicit velocity', () => {
  const ball = new Ball(50, 98, 10, 1);
  ball.vy = 120;

  ball.constrain(100, 100, [], 0.5, true);

  assert.equal(ball.y, 90);
  assert.equal(ball.vy, -60);
});

test('endpoint collision updates explicit velocity', () => {
  const portal = portals[0];
  const edgeX = portal.x + portal.width / 2;
  const ball = new Ball(edgeX + 10 + PORTAL_EDGE_RADIUS - 0.5, portal.y, 10, 1);
  ball.vx = -100;

  ball.constrain(500, 500, [portal], 0.5, true);

  assert.ok(ball.vx > 0);
});

test('exact endpoint overlap has a stable fallback normal', () => {
  const portal = portals[0];
  const edgeX = portal.x + portal.width / 2;
  const ball = new Ball(edgeX, portal.y, 10, 1);
  ball.vy = 100;

  ball.constrain(500, 500, [portal], 0.5, true);

  assert.ok(ball.y < portal.y);
  assert.equal(ball.vy, -50);
});

test('blocked face impact updates explicit velocity with configured bounce', () => {
  const portal = portals[0];
  const ball = new Ball(portal.x, portal.y - 1, 10, 1);
  ball.vy = 120;

  ball.blockedFaceImpact(portal, -1, 0.5);

  assert.equal(ball.vy, -60);
});

test('teleport cooldown is time based across substep counts', () => {
  const a = new Ball(0, 0, 5, 1);
  const b = new Ball(0, 0, 5, 1);
  a.cooldown = 1 / 30;
  b.cooldown = 1 / 30;

  a.update(1, () => ({ x: 0, y: 0 }), 1 / 30);
  for (let i = 0; i < 12; i++) b.update(1, () => ({ x: 0, y: 0 }), 1 / 360);

  nearly(a.cooldown, 0);
  nearly(b.cooldown, 0);
});

test('crossing selection chooses earliest portal hit regardless of array order', () => {
  const far = withPortalVectors({ id: 'far', x: 100, y: 100, angle: 0, color: '#f90', width: 100 });
  const near = withPortalVectors({ id: 'near', x: 100, y: 70, angle: 0, color: '#09f', width: 100 });
  const farExit = withPortalVectors({ id: 'far-exit', x: 300, y: 100, angle: Math.PI, color: '#f90', width: 100 });
  const nearExit = withPortalVectors({ id: 'near-exit', x: 300, y: 70, angle: Math.PI, color: '#09f', width: 100 });
  const ball = new Ball(100, 40, 5, 1);
  ball.oldX = 100;
  ball.oldY = 40;
  ball.x = 100;
  ball.y = 120;
  ball.vy = 9600;

  ball.checkCrossing([far, farExit, near, nearExit], true, 0.5);

  assert.ok(Math.abs(ball.x - nearExit.x) < 2);
});

test('adjacent portal pairs link reciprocally', () => {
  const four = [
    withPortalVectors({ id: 'a', x: 0, y: 0, angle: 0, color: '#f90', width: 100 }),
    withPortalVectors({ id: 'b', x: 100, y: 0, angle: Math.PI, color: '#09f', width: 100 }),
    withPortalVectors({ id: 'c', x: 200, y: 0, angle: 0, color: '#f90', width: 100 }),
    withPortalVectors({ id: 'd', x: 300, y: 0, angle: Math.PI, color: '#09f', width: 100 }),
  ];

  assert.equal(getLinkedPortal(four, 0)?.id, 'b');
  assert.equal(getLinkedPortal(four, 1)?.id, 'a');
  assert.equal(getLinkedPortal(four, 2)?.id, 'd');
  assert.equal(getLinkedPortal(four, 3)?.id, 'c');
});

test('runtime portal event resolution prevents high-speed rim tunneling', () => {
  const portal = portals[0];
  const edgeX = portal.x + portal.width / 2;
  const ball = new Ball(edgeX - 0.5, portal.y - 40, 10, 1);
  ball.oldX = ball.x;
  ball.oldY = ball.y;
  ball.y = portal.y + 40;
  ball.vy = 9600;

  ball.checkCrossing(portals, true, 0.5);

  assert.ok(ball.y < portal.y);
  assert.ok(ball.vy < 0);
  assert.equal(ball.cooldown, 0);
});

test('dual rendering clips both portal slices to the physically emerged half', () => {
  const ball = new Ball(100, 105, 10, 1);
  const rects: Array<{ y: number; height: number }> = [];
  const ctx = {
    getTransform: () => ({}),
    save: () => undefined,
    beginPath: () => undefined,
    translate: () => undefined,
    rotate: () => undefined,
    rect: (_x: number, y: number, _width: number, height: number) => rects.push({ y, height }),
    clip: () => undefined,
    setTransform: () => undefined,
    restore: () => undefined,
  } as unknown as CanvasRenderingContext2D;
  ball.renderBody = () => undefined;

  ball.renderDual(ctx, portals[0], portals[1], 5, 0);
  assert.deepEqual(rects, [{ y: 0, height: 2000 }, { y: 0, height: 2000 }]);

  rects.length = 0;
  ball.renderDual(ctx, portals[0], portals[1], -5, 0);
  assert.deepEqual(rects, [{ y: -2000, height: 2000 }, { y: -2000, height: 2000 }]);
});

test('rim-overlapping balls are not dual-rendered as successful traversals', () => {
  const portal = portals[0];
  const ball = new Ball(portal.x + portal.width / 2 - 0.5, portal.y + 2, 10, 1);
  let bodyDraws = 0;
  let dualDraws = 0;
  ball.renderBody = () => { bodyDraws++; };
  ball.renderDual = () => { dualDraws++; };
  ball.drawTrail = () => undefined;

  ball.draw({} as CanvasRenderingContext2D, 1, portals, true);

  assert.equal(bodyDraws, 1);
  assert.equal(dualDraws, 0);
});

test('a moving one-sided portal teleports a stationary body swept from its front', () => {
  const entryFrom = withPortalVectors({ ...portals[0], y: 80 });
  const entryTo = withPortalVectors({ ...portals[0], y: 120 });
  const ball = new Ball(100, 100, 5, 1);
  ball.trail = [{ x: 100, y: 100 }];

  const result = resolveMovingPortalSweeps(
    [ball],
    [entryFrom, portals[1]],
    [entryTo, portals[1]],
    { duration: 1, twoSided: false, bounce: 0.5 },
  );

  assert.deepEqual(result, { teleported: 1, blocked: 0, rimImpacts: 0 });
  nearly(ball.x, portals[1].x);
  nearly(ball.y, portals[1].y - 0.75);
  nearly(ball.vx, 0);
  nearly(ball.vy, -40);
  assert.equal(ball.cooldown, 1 / 30);
  assert.deepEqual(ball.trail, []);
  assert.deepEqual({ x: ball.oldX, y: ball.oldY }, { x: ball.x, y: ball.y });
});

test('a one-sided portal back sweep pushes instead of teleporting', () => {
  const entryFrom = withPortalVectors({ ...portals[0], y: 120 });
  const entryTo = withPortalVectors({ ...portals[0], y: 80 });
  const ball = new Ball(100, 100, 10, 1);
  const contact = getMovingPortalBackFaceContact(ball, entryFrom, entryTo);

  assert.ok(contact);
  nearly(contact.t, 0.2225, 1e-6);

  const result = resolveMovingPortalSweeps(
    [ball],
    [entryFrom, portals[1]],
    [entryTo, portals[1]],
    { duration: 1, twoSided: false, bounce: 0.5 },
  );

  assert.deepEqual(result, { teleported: 0, blocked: 1, rimImpacts: 0 });
  nearly(ball.x, 100);
  nearly(ball.y, 68.899);
  nearly(ball.vx, 0);
  nearly(ball.vy, -60);
  assert.equal(ball.cooldown, 0);
});

test('an already intersecting one-sided back plate cannot phase through a body', () => {
  const entryFrom = withPortalVectors({ ...portals[0], y: 100 });
  const entryTo = withPortalVectors({ ...portals[0], y: 90 });
  const ball = new Ball(100, 100, 10, 1);

  const contact = getMovingPortalBackFaceContact(ball, entryFrom, entryTo);
  assert.ok(contact);
  assert.equal(contact.t, 0);
  const result = resolveMovingPortalSweeps(
    [ball],
    [entryFrom, portals[1]],
    [entryTo, portals[1]],
    { duration: 1, twoSided: false, bounce: 0.5 },
  );

  assert.equal(result.blocked, 1);
  nearly(ball.y, 78.899);
  assert.ok(ball.vy < 0);
});

test('two-sided mode permits the same reverse moving-mouth traversal', () => {
  const entryFrom = withPortalVectors({ ...portals[0], y: 120 });
  const entryTo = withPortalVectors({ ...portals[0], y: 80 });
  const ball = new Ball(100, 100, 5, 1);

  const result = resolveMovingPortalSweeps(
    [ball],
    [entryFrom, portals[1]],
    [entryTo, portals[1]],
    { duration: 1, twoSided: true, bounce: 0.5 },
  );

  assert.deepEqual(result, { teleported: 1, blocked: 0, rimImpacts: 0 });
  nearly(ball.x, portals[1].x);
  nearly(ball.y, portals[1].y + 0.75);
  nearly(ball.vy, 40);
});

test('portal editor movement is immutable and rebuilds its coordinate frame', () => {
  const original = portals[0];
  const moved = movePortalForEditor(portals, original.id, 'portal', { x: 150, y: 175 });
  assert.equal(original.x, 100);
  assert.deepEqual({ x: moved[0].x, y: moved[0].y }, { x: 150, y: 175 });
  assert.deepEqual(moved[0].handle, {
    x: moved[0].x + moved[0].normal.x * 60,
    y: moved[0].y + moved[0].normal.y * 60,
  });
  assert.equal(moved[1], portals[1]);

  const rotated = movePortalForEditor(moved, original.id, 'handle', { x: 210, y: 175 });
  nearly(rotated[0].angle, -Math.PI / 2);
  nearly(rotated[0].normal.x, 1);
  nearly(rotated[0].normal.y, 0);
});

test('portal rotation sweeps the aperture and uses the shortest angular path', () => {
  const entryFrom = withPortalVectors({ ...portals[0], angle: 0 });
  const entryTo = withPortalVectors({ ...portals[0], angle: Math.PI / 2 });
  const crossing = getMovingPortalPlaneCrossing(
    { x: 110, y: 110, radius: 5 },
    entryFrom,
    entryTo,
  );

  assert.ok(crossing);
  nearly(crossing.t, 0.5, 1e-6);
  nearly(crossing.pose.angle, Math.PI / 4, 1e-6);
  nearly(crossing.along, Math.sqrt(200), 1e-6);
  assert.equal(crossing.fromFront, true);
  nearly(shortestAngleDelta(Math.PI - 0.1, -Math.PI + 0.1), 0.2);

  const halfway = interpolatePortalPose(entryFrom, entryTo, 0.5);
  nearly(halfway.angle, Math.PI / 4);
  assert.deepEqual(halfway.handle, {
    x: halfway.x + halfway.normal.x * 60,
    y: halfway.y + halfway.normal.y * 60,
  });
});

test('common entry and exit mouth motion cancels in the mapped body velocity', () => {
  const from = [
    withPortalVectors({ ...portals[0], y: 80 }),
    withPortalVectors({ ...portals[1], y: 80 }),
  ];
  const to = [
    withPortalVectors({ ...portals[0], y: 120 }),
    withPortalVectors({ ...portals[1], y: 120 }),
  ];
  const ball = new Ball(100, 100, 5, 1);

  const result = resolveMovingPortalSweeps([ball], from, to, {
    duration: 1,
    twoSided: false,
    bounce: 0.5,
  });

  assert.equal(result.teleported, 1);
  nearly(ball.vx, 0);
  nearly(ball.vy, 0);
  // Mapping happens at the crossing-time exit pose (y=100); the mouth then
  // continues its kinematic motion without dragging the emerged body.
  nearly(ball.y, 99.25);
});

test('a moving solid rim strikes a body when the aperture slides tangentially', () => {
  const entryFrom = withPortalVectors({ id: 'rim-a', x: 0, y: 100, angle: 0, color: '#f90', width: 100 });
  const entryTo = withPortalVectors({ ...entryFrom, x: 60 });
  const exit = withPortalVectors({ id: 'rim-b', x: 300, y: 300, angle: Math.PI, color: '#09f', width: 100 });
  const ball = new Ball(80, 100, 5, 1);

  const result = resolveMovingPortalSweeps(
    [ball],
    [entryFrom, exit],
    [entryTo, exit],
    { duration: 1, twoSided: true, bounce: 0.5 },
  );

  assert.deepEqual(result, { teleported: 0, blocked: 0, rimImpacts: 1 });
  nearly(ball.vx, 90);
  nearly(ball.vy, 0);
});

test('a moving rim blocks a near-edge plane sweep that lacks full-body clearance', () => {
  const entryFrom = withPortalVectors({ ...portals[0], y: 80 });
  const entryTo = withPortalVectors({ ...portals[0], y: 120 });
  const ball = new Ball(137, 100, 10, 1);

  assert.equal(getMovingPortalPlaneCrossing(ball, entryFrom, entryTo), null);
  const result = resolveMovingPortalSweeps(
    [ball],
    [entryFrom, portals[1]],
    [entryTo, portals[1]],
    { duration: 1, twoSided: true, bounce: 0.5 },
  );

  assert.deepEqual(result, { teleported: 0, blocked: 0, rimImpacts: 1 });
  assert.equal(ball.cooldown, 0);
  assert.ok(Math.hypot(ball.vx, ball.vy) > 0);
});

test('teleport cooldown suppresses a repeated moving-mouth traversal', () => {
  const entryFrom = withPortalVectors({ ...portals[0], y: 80 });
  const entryTo = withPortalVectors({ ...portals[0], y: 120 });
  const ball = new Ball(100, 100, 5, 1);
  ball.cooldown = 0.01;

  const result = resolveMovingPortalSweeps(
    [ball],
    [entryFrom, portals[1]],
    [entryTo, portals[1]],
    { duration: 1, twoSided: false, bounce: 0.5 },
  );

  assert.deepEqual(result, { teleported: 0, blocked: 0, rimImpacts: 0 });
  assert.deepEqual({ x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy }, { x: 100, y: 100, vx: 0, vy: 0 });
});

test('a portal sweep teleports every aperture-clear body in a pile exactly once', () => {
  const entryFrom = withPortalVectors({ ...portals[0], y: 80 });
  const entryTo = withPortalVectors({ ...portals[0], y: 120 });
  const balls = Array.from({ length: 7 }, (_, index) => new Ball(70 + index * 10, 100, 3, 1));

  const result = resolveMovingPortalSweeps(
    balls,
    [entryFrom, portals[1]],
    [entryTo, portals[1]],
    { duration: 0.1, twoSided: false, bounce: 0.5 },
  );

  assert.deepEqual(result, { teleported: 7, blocked: 0, rimImpacts: 0 });
  assert.equal(new Set(balls.map(ball => ball.x.toFixed(6))).size, balls.length);
  balls.forEach(ball => {
    assert.ok(Number.isFinite(ball.x) && Number.isFinite(ball.y));
    assert.equal(ball.cooldown, 1 / 30);
  });
});

test('rapid ball creation uses separated launch slots and respects the safety cap', () => {
  const bodies: Array<{ x: number; y: number; radius: number }> = [];
  for (let i = 0; i < 24; i++) {
    const spawn = findAvailableBallSpawn(bodies, 474, 632, 15);
    assert.ok(spawn);
    bodies.push({ ...spawn, radius: 15 });
  }

  for (let i = 0; i < bodies.length; i++) {
    assert.ok(bodies[i].x >= bodies[i].radius && bodies[i].x <= 474 - bodies[i].radius);
    assert.ok(bodies[i].y >= bodies[i].radius && bodies[i].y <= 632 - bodies[i].radius);
    for (let j = i + 1; j < bodies.length; j++) {
      assert.ok(Math.hypot(bodies[i].x - bodies[j].x, bodies[i].y - bodies[j].y) >= 38);
    }
  }

  assert.equal(MAX_BALLS, 64);
  assert.equal(findAvailableBallSpawn([], 20, 20, 15), null);
});

test('dragged ball index is parsed only for active ball drags', () => {
  assert.equal(getPinnedBallIndex({ id: '2', type: 'ball' }), 2);
  assert.equal(getPinnedBallIndex({ id: '2', type: 'portal' }), -1);
  assert.equal(getPinnedBallIndex({ id: null, type: 'ball' }), -1);
  assert.equal(getPinnedBallIndex({ id: 'not-a-number', type: 'ball' }), -1);
  assert.equal(getPinnedBallIndex({ id: '1abc', type: 'ball' }), -1);
});

test('dragged ball sync pins ball to pointer while preserving velocity state', () => {
  const bodies = [
    { x: 10, y: 15, oldX: 8, oldY: 12 },
    { x: 30, y: 35, oldX: 29, oldY: 34 },
  ];

  const pinnedIdx = syncPinnedBallToPointer(bodies, { id: '1', type: 'ball' }, { x: 100, y: 120 });

  assert.equal(pinnedIdx, 1);
  assert.deepEqual(bodies[0], { x: 10, y: 15, oldX: 8, oldY: 12 });
  assert.deepEqual(bodies[1], { x: 100, y: 120, oldX: 30, oldY: 35 });
});

test('dragged ball sync computes explicit velocity for velocity-based bodies', () => {
  const bodies = [{ x: 30, y: 35, oldX: 29, oldY: 34, vx: 0, vy: 0 }];

  const pinnedIdx = syncPinnedBallToPointer(bodies, { id: '0', type: 'ball' }, { x: 90, y: 95 }, 0.5);

  assert.equal(pinnedIdx, 0);
  assert.deepEqual(bodies[0], { x: 90, y: 95, oldX: 30, oldY: 35, vx: 120, vy: 120 });
});

test('dragged ball sync ignores non-ball drags and out-of-range ids', () => {
  const bodies = [{ x: 10, y: 15, oldX: 8, oldY: 12 }];

  assert.equal(syncPinnedBallToPointer(bodies, { id: '0', type: 'handle' }, { x: 100, y: 120 }), -1);
  assert.equal(syncPinnedBallToPointer(bodies, { id: '5', type: 'ball' }, { x: 100, y: 120 }), -1);
  assert.deepEqual(bodies[0], { x: 10, y: 15, oldX: 8, oldY: 12 });
});


const nearly = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} not near ${b}`);
const speed = (p: Point) => Math.hypot(p.x, p.y);

test('canonical portal point and vector round trips at several angles', () => {
  const angles = [0, Math.PI / 2, Math.PI, 0.37, -1.9];
  for (const a of angles) {
    const entry = withPortalVectors({ id: 'e', x: 20, y: -30, angle: a, color: '#f90', width: 80 });
    const exit = withPortalVectors({ id: 'x', x: 210, y: 140, angle: a + 1.234, color: '#09f', width: 80 });
    const p = { x: entry.x + entry.dir.x * 17 + entry.normal.x * 22, y: entry.y + entry.dir.y * 17 + entry.normal.y * 22 };
    const v = { x: 123, y: -45 };
    const p2 = mapPointThroughPortal(mapPointThroughPortal(p, entry, exit), exit, entry);
    const v2 = mapVelocityThroughPortal(mapVelocityThroughPortal(v, entry, exit), exit, entry);
    nearly(p2.x, p.x); nearly(p2.y, p.y); nearly(v2.x, v.x); nearly(v2.y, v.y); nearly(speed(v2), speed(v));
  }
});

test('canonical portal transform preserves tangent and inverts normal', () => {
  const entry = withPortalVectors({ id: 'e', x: 0, y: 0, angle: 0.4, color: '#f90', width: 100 });
  const exit = withPortalVectors({ id: 'x', x: 100, y: 50, angle: -1.1, color: '#09f', width: 100 });
  const localPoint = { x: entry.x + entry.dir.x * 30 + entry.normal.x * 12, y: entry.y + entry.dir.y * 30 + entry.normal.y * 12 };
  const mapped = getPortalLocal(mapPointThroughPortal(localPoint, entry, exit), exit);
  nearly(mapped.along, 30); nearly(mapped.normal, -12);
  const mappedNormal = mapVelocityThroughPortal(entry.normal, entry, exit);
  nearly(mappedNormal.x, -exit.normal.x); nearly(mappedNormal.y, -exit.normal.y);
});

test('field solver returns exact baseline without a pair and converges far away', () => {
  const cfg = { vacuum: false, gravity: 1 };
  assert.deepEqual(computeGravityAt(0, 0, [], cfg), { x: 0, y: 800 });
  const far = computeGravityAt(100000, -100000, portals, cfg);
  assert.ok(Math.abs(far.x) < 0.01);
  assert.ok(Math.abs(far.y - 800) < 0.01);
});

test('aperture coupling is smooth and finite at center and endpoints', () => {
  const p = portals[0];
  const center = apertureVisibilityWeight({ x: p.x, y: p.y + 4 }, p);
  const edgeA = apertureVisibilityWeight({ x: p.x + p.width / 2 - 0.001, y: p.y + 4 }, p);
  const edgeB = apertureVisibilityWeight({ x: p.x + p.width / 2 + 0.001, y: p.y + 4 }, p);
  assert.ok(Number.isFinite(center) && Number.isFinite(edgeA) && Number.isFinite(edgeB));
  assert.ok(center > edgeA);
  assert.ok(Math.abs(edgeA - edgeB) < 0.001);
});

test('matter sidedness does not make gravitational coupling one-way', () => {
  const portal = portals[0];
  const front = apertureVisibilityWeight({ x: portal.x, y: portal.y + 20 }, portal);
  const behind = apertureVisibilityWeight({ x: portal.x, y: portal.y - 20 }, portal);

  assert.ok(front > 0);
  nearly(front, behind);
});

test('matched passive mouths share one potential despite their height difference', () => {
  const loopPortals = [
    withPortalVectors({ id: 'lower', x: 400, y: 500, angle: Math.PI, color: '#f90', width: 140 }),
    withPortalVectors({ id: 'upper', x: 400, y: 100, angle: 0, color: '#09f', width: 140 }),
  ];
  const config = { gravity: 1 };

  for (const along of [-30, 0, 30]) {
    const lowerPoint = {
      x: loopPortals[0].x + loopPortals[0].dir.x * along,
      y: loopPortals[0].y + loopPortals[0].dir.y * along,
    };
    const upperPoint = mapPointThroughPortal(lowerPoint, loopPortals[0], loopPortals[1]);
    nearly(
      computePotentialAt(lowerPoint.x, lowerPoint.y, loopPortals, config),
      computePotentialAt(upperPoint.x, upperPoint.y, loopPortals, config),
      1e-7,
    );
  }
});

test('seam potential remains matched for close, rotated mouths', () => {
  const rotatedPortals = [
    withPortalVectors({ id: 'a', x: 200, y: 300, angle: 0.4, color: '#f90', width: 180 }),
    withPortalVectors({ id: 'b', x: 260, y: 380, angle: 2.2, color: '#09f', width: 180 }),
  ];
  const config = { gravity: 1 };

  for (const along of [-80, -20, 0, 20, 80]) {
    const entryPoint = {
      x: rotatedPortals[0].x + rotatedPortals[0].dir.x * along,
      y: rotatedPortals[0].y + rotatedPortals[0].dir.y * along,
    };
    const exitPoint = mapPointThroughPortal(entryPoint, rotatedPortals[0], rotatedPortals[1]);
    nearly(
      computePotentialAt(entryPoint.x, entryPoint.y, rotatedPortals, config),
      computePotentialAt(exitPoint.x, exitPoint.y, rotatedPortals, config),
      1e-7,
    );
  }
});

test('gravity vectors transform consistently across the matched seam', () => {
  const rotatedPortals = [
    withPortalVectors({ id: 'a', x: 200, y: 300, angle: 0.4, color: '#f90', width: 180 }),
    withPortalVectors({ id: 'b', x: 260, y: 380, angle: 2.2, color: '#09f', width: 180 }),
  ];
  const config = { gravity: 1 };

  for (const along of [-70, 0, 70]) {
    const entryPoint = {
      x: rotatedPortals[0].x + rotatedPortals[0].dir.x * along,
      y: rotatedPortals[0].y + rotatedPortals[0].dir.y * along,
    };
    const exitPoint = mapPointThroughPortal(entryPoint, rotatedPortals[0], rotatedPortals[1]);
    const entryGravity = computeGravityAt(entryPoint.x, entryPoint.y, rotatedPortals, config);
    const expectedExitGravity = transformThroughPortal(entryGravity, rotatedPortals[0], rotatedPortals[1]);
    const exitGravity = computeGravityAt(exitPoint.x, exitPoint.y, rotatedPortals, config);

    assert.ok(
      Math.hypot(exitGravity.x - expectedExitGravity.x, exitGravity.y - expectedExitGravity.y) < 1.5,
      'linked seam gravity should use the same portal-frame transform as matter',
    );
  }
});

test('canonical gravity supplies zero net work to an infinite-fall path', () => {
  const loopPortals = [
    withPortalVectors({ id: 'lower', x: 400, y: 500, angle: Math.PI, color: '#f90', width: 140 }),
    withPortalVectors({ id: 'upper', x: 400, y: 100, angle: 0, color: '#09f', width: 140 }),
  ];
  const config = { gravity: 1 };
  const steps = 400;
  const dy = (loopPortals[0].y - loopPortals[1].y) / steps;
  let specificWork = 0;

  for (let index = 0; index < steps; index++) {
    const y = loopPortals[1].y + (index + 0.5) * dy;
    const gravity = computeGravityAt(loopPortals[0].x, y, loopPortals, config);
    specificWork += gravity.y * dy;
  }

  assert.ok(computeGravityAt(400, 250, loopPortals, config).y < 0, 'field should oppose free fall within the loop');
  assert.ok(computeGravityAt(400, 125, loopPortals, config).y > 0, 'ambient direction should remain near the seam');
  assert.ok(Math.abs(specificWork) < 1, `expected zero loop work, got ${specificWork}`);
});

test('repeated passive portal loops do not produce unbounded acceleration', () => {
  const loopPortals = [
    withPortalVectors({ id: 'lower', x: 400, y: 500, angle: Math.PI, color: '#f90', width: 140 }),
    withPortalVectors({ id: 'upper', x: 400, y: 100, angle: 0, color: '#09f', width: 140 }),
  ];
  const config = { gravity: 1 };
  const ball = new Ball(400, 110, 5, 1);
  ball.vy = 500;
  const crossingSpeeds: number[] = [];
  const dt = 1 / 1440;

  for (let step = 0; step < 1440 * 20 && crossingSpeeds.length < 10; step++) {
    ball.update(1, (x, y) => computeGravityAt(x, y, loopPortals, config), dt);
    const proposedY = ball.y;
    ball.checkCrossing(loopPortals, false, 0.55);
    if (ball.y < proposedY - 200) crossingSpeeds.push(Math.hypot(ball.vx, ball.vy));
  }

  assert.equal(crossingSpeeds.length, 10);
  assert.ok(
    crossingSpeeds.at(-1)! <= crossingSpeeds[0] + 0.1,
    `loop speed drifted from ${crossingSpeeds[0]} to ${crossingSpeeds.at(-1)}`,
  );
});

test('field sampling is deterministic, normalized, and finite', () => {
  const cfg = { vacuum: false, gravity: 1 };
  const a = sampleField({ x: 100, y: 120 }, portals, cfg);
  const b = sampleField({ x: 100, y: 120 }, portals, cfg);
  assert.deepEqual(a, b);
  nearly(a.directWeight + a.portalWeight, 1);
  assert.ok(Number.isFinite(a.potential));
  assert.ok(Number.isFinite(a.acceleration.x));
  assert.ok(Number.isFinite(a.acceleration.y));
});

test('multiple portal pairs contribute named shared-seam potentials', () => {
  const multiPairPortals = [
    withPortalVectors({ id: 'a', x: 0, y: 0, angle: 0, color: '#f90', width: 200 }),
    withPortalVectors({ id: 'b', x: 100, y: 0, angle: Math.PI, color: '#09f', width: 200 }),
    withPortalVectors({ id: 'c', x: 100, y: -20, angle: 0, color: '#f90', width: 200 }),
    withPortalVectors({ id: 'd', x: 200, y: -20, angle: Math.PI / 2, color: '#09f', width: 200 }),
  ];
  const sample = sampleField(
    { x: 0, y: 20 },
    multiPairPortals,
    { gravity: 1 },
  );
  const firstPair = sample.contributions.find(contribution => contribution.portalId === 'a');
  const secondPair = sample.contributions.find(contribution => contribution.portalId === 'c');

  assert.ok(firstPair);
  assert.ok(secondPair);
  assert.ok(sample.contributions.every(contribution => contribution.depth === 1));
  assert.ok(Number.isFinite(secondPair.potential));
  assert.ok(Number.isFinite(secondPair.mappedPoint.x));
  assert.ok(Number.isFinite(secondPair.mappedPoint.y));
});

test('zero gravity high speed portal crossing preserves speed', () => {
  const body = new Ball(100, 40, 5, 1);
  body.vx = 0; body.vy = 1800; body.oldX = body.x; body.oldY = body.y;
  const newPos = { x: body.x, y: body.y + body.vy * (1 / 30) };
  const hit = getCrossingIntersection({ x: body.x, y: body.y }, newPos, portals[0], body.radius);
  assert.ok(hit);
  body.x = newPos.x; body.y = newPos.y;
  body.teleport(portals[0], portals[1], hit.interX, hit.interY);
  nearly(Math.hypot(body.vx, body.vy), 1800);
});

test('fixed step integration is invariant to render frame grouping', () => {
  const run = (frames: number[]) => {
    let pos = { x: 0, y: 0 }; let vel = { x: 10, y: 0 }; let acc = 0; const dt = 1 / 120;
    for (const frame of frames) { acc += frame; while (acc >= dt - 1e-12) { vel = integrateVelocity(vel, { x: 0, y: 800 }, 1, dt); pos = integratePosition(pos, vel, dt); acc -= dt; } }
    return { pos, vel };
  };
  const a = run(Array(60).fill(1 / 60));
  const b = run(Array(30).fill(1 / 30));
  const c = run(Array(120).fill(1 / 120));
  nearly(a.pos.y, b.pos.y); nearly(a.pos.y, c.pos.y); nearly(a.vel.y, b.vel.y); nearly(a.vel.y, c.vel.y);
});
