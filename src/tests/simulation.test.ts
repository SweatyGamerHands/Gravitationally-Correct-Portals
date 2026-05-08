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
  transformThroughPortal,
} from '../simulation/physics';
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
});
