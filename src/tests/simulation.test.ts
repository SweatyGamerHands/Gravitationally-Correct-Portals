import test from 'node:test';
import assert from 'node:assert/strict';
import {
  apertureVisibilityWeight,
  computeGravityAt,
  getBaselineG,
  getCrossingIntersection,
  getPinnedBallIndex,
  getPortalLocal,
  getPortalSegmentCollision,
  getScaledFrameDt,
  integratePosition,
  integrateVelocity,
  isWithinPortalAperture,
  simulateLinearDisplacement,
  syncPinnedBallToPointer,
  transformThroughPortal,
  mapPointThroughPortal,
  mapVelocityThroughPortal,
  sampleField,
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

test('portal transform flips normal component', () => {
  const v = transformThroughPortal({ x: 0, y: 10 }, portals[0], portals[1]);
  assert.ok(Math.abs(v.x) < 1e-9);
  assert.ok(Math.abs(v.y - 10) < 1e-9);
});

test('crossing detected within aperture', () => {
  const hit = getCrossingIntersection({ x: 100, y: 50 }, { x: 100, y: 150 }, portals[0]);
  assert.ok(hit);
});

test('gravity compute returns ambient when correction disabled', () => {
  const g = computeGravityAt(100, 100, portals, { vacuum: false, gravity: 1, correctGravity: false, portalPull: 1 });
  assert.equal(g.x, 0);
  assert.equal(g.y, 800);
});

test('gravity compute changes continuously across aperture edge falloff', () => {
  const edgePortals = [
    withPortalVectors({ id: 'entry', x: 100, y: 100, angle: 0, color: '#f90', width: 100 }),
    withPortalVectors({ id: 'exit', x: 300, y: 100, angle: Math.PI / 2, color: '#09f', width: 100 }),
  ];
  const config = { vacuum: false, gravity: 1, correctGravity: true, portalPull: 1 };
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

test('crossing eligibility uses center within aperture and leaves radius overlap to rim collision', () => {
  const portal = portals[0];
  const radius = 10;

  for (const side of [1, -1]) {
    const edgeX = portal.x + side * portal.width / 2;
    const overlappingRim = getCrossingIntersection(
      { x: edgeX + side * (radius - 0.5), y: portal.y - 20 },
      { x: edgeX + side * (radius - 0.5), y: portal.y + 20 },
      portal,
      radius,
    );
    assert.equal(overlappingRim, null);

    const justInside = getCrossingIntersection(
      { x: edgeX - side * (radius + 0.5), y: portal.y - 20 },
      { x: edgeX - side * (radius + 0.5), y: portal.y + 20 },
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

  const grazingHit = getPortalSegmentCollision({ x: edgeX + radius + 0.5, y: portal.y }, radius, portal);
  assert.ok(grazingHit);
  assert.ok(grazingHit.overlap > 0);
  assert.ok(grazingHit.normal.x > 0);

  const clearMiss = getPortalSegmentCollision({ x: edgeX + radius + 2, y: portal.y }, radius, portal);
  assert.equal(clearMiss, null);
});

test('back-face approach outside aperture is not eligible for support or crossing', () => {
  const portal = portals[0];
  const radius = 10;
  const outsideX = portal.x + portal.width / 2 + radius + 0.5;
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
  const ball = new Ball(edgeX + 10.5, portal.y, 10, 1);
  ball.vx = -100;

  ball.constrain(500, 500, [portal], 0.5, true);

  assert.ok(ball.vx > 0);
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

test('field solver returns exact baseline when disabled and converges far away', () => {
  const cfg = { vacuum: false, gravity: 1, correctGravity: true, portalPull: 1, twoSided: true };
  assert.deepEqual(computeGravityAt(0, 0, portals, { ...cfg, correctGravity: false }), { x: 0, y: 800 });
  const far = computeGravityAt(100000, -100000, portals, cfg);
  assert.ok(Math.abs(far.x) < 0.01);
  assert.ok(Math.abs(far.y - 800) < 0.01);
});

test('aperture visibility is smooth and finite at center and endpoints', () => {
  const p = portals[0];
  const center = apertureVisibilityWeight({ x: p.x, y: p.y + 4 }, p, true);
  const edgeA = apertureVisibilityWeight({ x: p.x + p.width / 2 - 0.001, y: p.y + 4 }, p, true);
  const edgeB = apertureVisibilityWeight({ x: p.x + p.width / 2 + 0.001, y: p.y + 4 }, p, true);
  assert.ok(Number.isFinite(center) && Number.isFinite(edgeA) && Number.isFinite(edgeB));
  assert.ok(center > edgeA);
  assert.ok(Math.abs(edgeA - edgeB) < 0.001);
});

test('field recursion is deterministic bounded and two-sided aware', () => {
  const cfg = { vacuum: false, gravity: 1, correctGravity: true, portalPull: 1, twoSided: true, maxDepth: 4, fieldClamp: 1000 };
  const a = sampleField({ x: 100, y: 120 }, portals, cfg);
  const b = sampleField({ x: 100, y: 120 }, portals, cfg);
  assert.deepEqual(a, b);
  assert.ok(speed(a.acceleration) <= 1000 + 1e-9);
  const one = apertureVisibilityWeight({ x: portals[0].x, y: portals[0].y - 20 }, portals[0], false);
  assert.equal(one, 0);
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
