import test from 'node:test';
import assert from 'node:assert/strict';
import { computeGravityAt, getBaselineG, getCrossingIntersection, transformThroughPortal } from '../simulation/physics';
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
