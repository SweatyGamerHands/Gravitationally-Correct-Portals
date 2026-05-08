import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeGravityAt,
  getBaselineG,
  getCrossingIntersection,
  getPortalLocal,
  getPortalSegmentCollision,
  isWithinPortalAperture,
  transformThroughPortal,
} from '../simulation/physics';
import { computeGravityAt, getBaselineG, getCrossingIntersection, getPinnedBallIndex, syncPinnedBallToPointer, transformThroughPortal } from '../simulation/physics';
import { withPortalVectors } from '../simulation/types';

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
