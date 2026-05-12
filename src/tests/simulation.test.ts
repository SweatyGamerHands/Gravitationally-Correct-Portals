import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeGravityAt,
  getBaselineG,
  getCrossingIntersection,
  getScaledFrameDt,
  integratePosition,
  integrateVelocity,
  simulateLinearDisplacement,
  getPortalLocal,
  getPortalSegmentCollision,
  isWithinPortalAperture,
  transformThroughPortal,
} from '../simulation/physics';
import { computeGravityAt, getBaselineG, getCrossingIntersection, getPinnedBallIndex, syncPinnedBallToPointer, transformThroughPortal } from '../simulation/physics';
import { withPortalVectors } from '../simulation/types';
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
  assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y));
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


test('scaled frame dt applies timeScale linearly', () => {
  assert.equal(getScaledFrameDt(1 / 60, 0.5), 1 / 120);
  assert.equal(getScaledFrameDt(1 / 60, 2), 1 / 30);
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
test('crossing near positive aperture edge includes ball radius overlap', () => {
  const portal = portals[0];
  const radius = 10;
  const edgeX = portal.x + portal.width / 2;

  const overlappingEdge = getCrossingIntersection(
    { x: edgeX + radius - 0.5, y: portal.y - 20 },
    { x: edgeX + radius - 0.5, y: portal.y + 20 },
    portal,
    radius,
  );
  assert.ok(overlappingEdge);

  const outsideEdge = getCrossingIntersection(
    { x: edgeX + radius + 0.5, y: portal.y - 20 },
    { x: edgeX + radius + 0.5, y: portal.y + 20 },
    portal,
    radius,
  );
  assert.equal(outsideEdge, null);
});

test('crossing near negative aperture edge includes ball radius overlap', () => {
  const portal = portals[0];
  const radius = 10;
  const edgeX = portal.x - portal.width / 2;

  const overlappingEdge = getCrossingIntersection(
    { x: edgeX - radius + 0.5, y: portal.y - 20 },
    { x: edgeX - radius + 0.5, y: portal.y + 20 },
    portal,
    radius,
  );
  assert.ok(overlappingEdge);

  const outsideEdge = getCrossingIntersection(
    { x: edgeX - radius - 0.5, y: portal.y - 20 },
    { x: edgeX - radius - 0.5, y: portal.y + 20 },
    portal,
    radius,
  );
  assert.equal(outsideEdge, null);
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

test('back-face approach just outside aperture is not eligible for aperture support or crossing', () => {
  const portal = portals[0];
  const radius = 10;
  const outsideX = portal.x + portal.width / 2 + radius + 0.5;
  const backFacePoint = { x: outsideX, y: portal.y - radius / 2 };
  const local = getPortalLocal(backFacePoint, portal);

test('blocked back support does not stop horizontal velocity before penetration on a vertical portal', () => {
  const portal = withPortalVectors({ id: 'vertical', x: 100, y: 100, angle: Math.PI / 2, color: '#f90', width: 100 });
  const ball = new Ball(111.3, 100, 10, 1);
  ball.oldX = 113.3;
  ball.oldY = 100;

  ball.blockedFaceSupport(portal);

  assert.equal(ball.x, 111.3);
  assert.equal(ball.y, 100);
  assert.equal(ball.x - ball.oldX, -2);
  assert.equal(ball.y - ball.oldY, 0);
});

test('blocked back support preserves horizontal separating velocity on a vertical portal', () => {
  const portal = withPortalVectors({ id: 'vertical', x: 100, y: 100, angle: Math.PI / 2, color: '#f90', width: 100 });
  const ball = new Ball(110, 100, 10, 1);
  ball.oldX = 105;
  ball.oldY = 100;

  ball.blockedFaceSupport(portal);

  assert.equal(ball.x, 111.1);
  assert.equal(ball.y, 100);
  assert.equal(ball.x - ball.oldX, 5);
  assert.equal(ball.y - ball.oldY, 0);
  assert.equal(isWithinPortalAperture(local, portal, radius), false);
  assert.equal(
    getCrossingIntersection(backFacePoint, { x: outsideX, y: portal.y + radius / 2 }, portal, radius),
    null,
  );
test('dragged ball index is parsed only for active ball drags', () => {
  assert.equal(getPinnedBallIndex({ id: '2', type: 'ball' }), 2);
  assert.equal(getPinnedBallIndex({ id: '2', type: 'portal' }), -1);
  assert.equal(getPinnedBallIndex({ id: null, type: 'ball' }), -1);
  assert.equal(getPinnedBallIndex({ id: 'not-a-number', type: 'ball' }), -1);
  assert.equal(getPinnedBallIndex({ id: '1abc', type: 'ball' }), -1);
});

test('dragged ball sync pins ball to pointer while preserving previous position as velocity state', () => {
  const bodies = [
    { x: 10, y: 15, oldX: 8, oldY: 12 },
    { x: 30, y: 35, oldX: 29, oldY: 34 },
  ];

  const pinnedIdx = syncPinnedBallToPointer(bodies, { id: '1', type: 'ball' }, { x: 100, y: 120 });

  assert.equal(pinnedIdx, 1);
  assert.deepEqual(bodies[0], { x: 10, y: 15, oldX: 8, oldY: 12 });
  assert.deepEqual(bodies[1], { x: 100, y: 120, oldX: 30, oldY: 35 });
});

test('dragged ball sync ignores non-ball drags and out-of-range ids', () => {
  const bodies = [{ x: 10, y: 15, oldX: 8, oldY: 12 }];

  assert.equal(syncPinnedBallToPointer(bodies, { id: '0', type: 'handle' }, { x: 100, y: 120 }), -1);
  assert.equal(syncPinnedBallToPointer(bodies, { id: '5', type: 'ball' }, { x: 100, y: 120 }), -1);
  assert.deepEqual(bodies[0], { x: 10, y: 15, oldX: 8, oldY: 12 });
});
