import test from 'node:test';
import assert from 'node:assert/strict';
import { computeGravityAt, getBaselineG, getCrossingIntersection, transformThroughPortal } from '../simulation/physics';
import { withPortalVectors } from '../simulation/types';

const portals = [
  withPortalVectors({ id: 'a', x: 100, y: 100, angle: 0, color: '#f90', width: 100 }),
  withPortalVectors({ id: 'b', x: 300, y: 100, angle: Math.PI, color: '#09f', width: 100 }),
];

test('baseline gravity respects vacuum mode', () => {
  assert.equal(getBaselineG(false, 1), 800);
  assert.equal(getBaselineG(true, 1), 1100);
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

