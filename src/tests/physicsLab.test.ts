import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advancePortalsWithMotion,
  evaluatePortalMotion,
  interpolatePortalPose,
  resolveMovingPortalSweeps,
  type PhysicsEvent,
  type PortalMotionSpec,
} from '../simulation/physics';
import { Ball } from '../simulation/Ball';
import { withPortalVectors } from '../simulation/types';

const nearly = (actual: number, expected: number, epsilon = 1e-8) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} not near ${expected}`);
};

const makePair = (entryTwoSided?: boolean) => [
  withPortalVectors({
    id: 'entry',
    x: 100,
    y: 100,
    angle: 0,
    color: '#f90',
    width: 100,
    twoSided: entryTwoSided,
  }),
  withPortalVectors({
    id: 'exit',
    x: 300,
    y: 100,
    angle: Math.PI,
    color: '#09f',
    width: 100,
  }),
];

const makeReverseCrossingBall = (id: string) => {
  const ball = new Ball(100, 120, 5, 1, id, `Probe ${id}`);
  ball.oldX = 100;
  ball.oldY = 80;
  ball.vy = 40;
  return ball;
};

test('ball identity, color, and elapsed-time trail sampling are deterministic', () => {
  const fine = new Ball(0, 0, 5, 1, 'deterministic-probe', 'Probe');
  const coarse = new Ball(0, 0, 5, 1, 'deterministic-probe', 'Probe');
  fine.vx = 60;
  coarse.vx = 60;

  for (let step = 0; step < 120; step++) fine.update(1, () => ({ x: 0, y: 0 }), 1 / 120);
  for (let step = 0; step < 60; step++) coarse.update(1, () => ({ x: 0, y: 0 }), 1 / 60);

  assert.equal(fine.id, 'deterministic-probe');
  assert.equal(fine.label, 'Probe');
  assert.equal(fine.color, coarse.color);
  assert.equal(fine.trail.length, 60);
  assert.deepEqual(fine.trail, coarse.trail);

  const legacyConstructor = new Ball(0, 0, 5, 1);
  assert.match(legacyConstructor.id, /^ball-\d+$/);
  assert.match(legacyConstructor.label, /^Ball \d+$/);
});

test('per-mouth sidedness overrides and falls back to the experiment default', () => {
  const fallbackEvent = makeReverseCrossingBall('fallback').checkCrossing(makePair(), false, 0.5);
  assert.equal(fallbackEvent?.type, 'back-plate-impact');

  const enabledEvent = makeReverseCrossingBall('override-on').checkCrossing(makePair(true), false, 0.5);
  assert.equal(enabledEvent?.type, 'traversal');
  assert.deepEqual(enabledEvent?.portalIds, { entry: 'entry', exit: 'exit' });

  const disabledEvent = makeReverseCrossingBall('override-off').checkCrossing(makePair(false), true, 0.5);
  assert.equal(disabledEvent?.type, 'back-plate-impact');

  const [from] = makePair(true);
  const to = withPortalVectors({ ...from, x: 140 });
  assert.equal(interpolatePortalPose(from, to, 0.5).twoSided, true);
});

test('static traversal and solid-contact events contain laboratory facts', () => {
  const traversalBall = new Ball(100, 120, 5, 1, 'traveler', 'Traveler');
  traversalBall.oldY = 80;
  traversalBall.vy = 120;
  const traversal = traversalBall.checkCrossing(makePair(true), false, 0.4);

  assert.equal(traversal?.type, 'traversal');
  assert.equal(traversal?.bodyId, 'traveler');
  assert.equal(traversal?.beforeSpeed, 120);
  assert.equal(traversal?.afterSpeed, 120);
  assert.match(traversal?.explanation.message ?? '', /Traveler crossed entry/);
  assert.equal(traversal?.explanation.facts.matterMode, 'two-sided');
  assert.deepEqual(traversal?.position, { x: 100, y: 100 });

  const [rim, linked] = makePair(true);
  const rimBall = new Ball(rim.x + rim.width / 2 - 0.5, rim.y + 40, 10, 1, 'rim-probe');
  rimBall.oldX = rimBall.x;
  rimBall.oldY = rim.y - 40;
  rimBall.vy = 9600;
  const rimEvent = rimBall.checkCrossing([rim, linked], true, 0.5);
  assert.equal(rimEvent?.type, 'rim-impact');
  assert.equal(rimEvent?.bodyId, 'rim-probe');
  assert.equal(rimEvent?.portalIds.entry, 'entry');
  assert.equal(typeof rimEvent?.explanation.facts.normalX, 'number');
});

test('portal motion is periodic, origin-stable, and preserves mouth fields', () => {
  const portal = withPortalVectors({
    id: 'moving',
    x: 999,
    y: 888,
    angle: 2,
    color: '#abc',
    width: 135,
    twoSided: true,
  });
  const linear: PortalMotionSpec = {
    enabled: true,
    kind: 'linear',
    originX: 20,
    originY: 30,
    originAngle: 0.4,
    amplitude: 50,
    frequency: 2,
    axisAngle: Math.PI / 3,
    phase: 0.37,
    angularAmplitude: 0.8,
  };

  const atOrigin = evaluatePortalMotion(portal, linear, 0);
  assert.deepEqual(
    { x: atOrigin.x, y: atOrigin.y, angle: atOrigin.angle },
    { x: 20, y: 30, angle: 0.4 },
  );
  assert.equal(atOrigin.id, portal.id);
  assert.equal(atOrigin.color, portal.color);
  assert.equal(atOrigin.width, portal.width);
  assert.equal(atOrigin.twoSided, true);

  const first = evaluatePortalMotion(portal, linear, 0.125);
  const onePeriodLater = evaluatePortalMotion(portal, linear, 0.625);
  nearly(first.x, onePeriodLater.x);
  nearly(first.y, onePeriodLater.y);
  nearly(first.angle, onePeriodLater.angle);

  const reevaluatedFromAnimatedPose = evaluatePortalMotion(first, linear, 0.125);
  nearly(reevaluatedFromAnimatedPose.x, first.x);
  nearly(reevaluatedFromAnimatedPose.y, first.y);

  const circular = { ...linear, kind: 'circular' as const, frequency: 1 };
  const circularA = evaluatePortalMotion(portal, circular, 0.2);
  const circularB = evaluatePortalMotion(portal, circular, 1.2);
  nearly(circularA.x, circularB.x);
  nearly(circularA.y, circularB.y);

  const oscillate = { ...linear, kind: 'oscillate' as const, amplitude: 0, frequency: 1 };
  const angled = evaluatePortalMotion(portal, oscillate, 0.25);
  assert.notEqual(angled.angle, oscillate.originAngle);

  const stationary = withPortalVectors({ ...portal, id: 'stationary' });
  const advanced = advancePortalsWithMotion([portal, stationary], { moving: linear }, 0.125);
  assert.notEqual(advanced[0], portal);
  assert.equal(advanced[1], stationary);
});

test('moving sweep emits an event without changing its aggregate result shape', () => {
  const pair = makePair(false);
  const from = [withPortalVectors({ ...pair[0], y: 120 }), pair[1]];
  const to = [withPortalVectors({ ...pair[0], y: 80 }), pair[1]];
  const ball = new Ball(100, 100, 5, 1, 'sweep-probe', 'Sweep probe');
  const events: PhysicsEvent[] = [];

  const result = resolveMovingPortalSweeps([ball], from, to, {
    duration: 1,
    twoSided: true,
    bounce: 0.5,
    onEvent: event => events.push(event),
  });

  assert.deepEqual(result, { teleported: 0, blocked: 1, rimImpacts: 0 });
  assert.deepEqual(Object.keys(result).sort(), ['blocked', 'rimImpacts', 'teleported']);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'back-plate-impact');
  assert.equal(events[0].bodyId, 'sweep-probe');
  assert.equal(events[0].portalIds.entry, 'entry');
  assert.equal(events[0].explanation.facts.movingPortal, true);
});
