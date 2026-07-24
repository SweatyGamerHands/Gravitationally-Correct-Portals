import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPERIMENT_PRESETS, createSurpriseExperiment } from '../lab/presets';
import { validateExperimentDocument } from '../lab/snapshotCodec';
import type { ExperimentDocument } from '../lab/types';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

const assertFiniteNumbers = (value: unknown, context: string): void => {
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value), `${context} must be finite`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertFiniteNumbers(item, `${context}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      assertFiniteNumbers(item, `${context}.${key}`);
    }
  }
};

const assertInRange = (
  value: number,
  minimum: number,
  maximum: number,
  context: string,
): void => {
  const epsilon = 1e-9;
  assert.ok(
    value >= minimum - epsilon && value <= maximum + epsilon,
    `${context} (${value}) must be between ${minimum} and ${maximum}`,
  );
};

const assertExperimentInvariants = (
  document: ExperimentDocument,
  width: number,
  height: number,
  context: string,
): void => {
  const validation = validateExperimentDocument(document);
  if (validation.ok === false) {
    assert.fail(`${context} failed schema validation at ${validation.error.path ?? '$'}: ${validation.error.message}`);
  }

  assertFiniteNumbers(document, context);

  const entityIds = [
    ...document.portals.map(portal => portal.id),
    ...document.balls.map(ball => ball.id),
  ];
  assert.equal(
    new Set(entityIds).size,
    entityIds.length,
    `${context} must use a unique id for every portal and ball`,
  );

  assert.equal(
    document.portals.length % 2,
    0,
    `${context} must contain only complete adjacent portal pairs`,
  );
  for (let pairStart = 0; pairStart < document.portals.length; pairStart += 2) {
    const pair = document.portals.slice(pairStart, pairStart + 2);
    assert.equal(pair.length, 2, `${context} pair ${pairStart / 2 + 1} must be adjacent and complete`);
    assert.notEqual(pair[0].id, pair[1].id, `${context} pair ${pairStart / 2 + 1} needs two distinct mouths`);
  }

  for (const portal of document.portals) {
    const portalContext = `${context} portal ${portal.id}`;
    assert.equal(portal.motion.originX, portal.x, `${portalContext} motion origin x must match its initial pose`);
    assert.equal(portal.motion.originY, portal.y, `${portalContext} motion origin y must match its initial pose`);
    assert.equal(
      portal.motion.originAngle,
      portal.angle,
      `${portalContext} motion origin angle must match its initial pose`,
    );

    assertInRange(portal.x, 0, width, `${portalContext} x`);
    assertInRange(portal.y, 0, height, `${portalContext} y`);
    for (const side of [-1, 1]) {
      const endpointX = portal.x + side * Math.cos(portal.angle) * portal.width / 2;
      const endpointY = portal.y + side * Math.sin(portal.angle) * portal.width / 2;
      assertInRange(endpointX, 0, width, `${portalContext} endpoint x`);
      assertInRange(endpointY, 0, height, `${portalContext} endpoint y`);
    }
  }

  for (const ball of document.balls) {
    const ballContext = `${context} ball ${ball.id}`;
    for (const [pose, x, y] of [
      ['initial', ball.x, ball.y],
      ['previous', ball.oldX, ball.oldY],
    ] as const) {
      assertInRange(x - ball.radius, 0, width, `${ballContext} ${pose} left edge`);
      assertInRange(x + ball.radius, 0, width, `${ballContext} ${pose} right edge`);
      assertInRange(y - ball.radius, 0, height, `${ballContext} ${pose} top edge`);
      assertInRange(y + ball.radius, 0, height, `${ballContext} ${pose} bottom edge`);
    }
  }
};

const assertSurpriseSpacing = (
  document: ExperimentDocument,
  width: number,
  context: string,
): void => {
  const portalClearance = Math.min(180, width * 0.25);

  for (let index = 0; index < document.portals.length; index += 1) {
    const first = document.portals[index];
    for (let otherIndex = index + 1; otherIndex < document.portals.length; otherIndex += 1) {
      const second = document.portals[otherIndex];
      assert.ok(
        Math.hypot(first.x - second.x, first.y - second.y) > portalClearance,
        `${context} portals ${first.id} and ${second.id} must not overlap their placement clearance`,
      );
    }
  }

  for (let index = 0; index < document.balls.length; index += 1) {
    const first = document.balls[index];
    for (let otherIndex = index + 1; otherIndex < document.balls.length; otherIndex += 1) {
      const second = document.balls[otherIndex];
      assert.ok(
        Math.hypot(first.x - second.x, first.y - second.y) > first.radius + second.radius + 10,
        `${context} balls ${first.id} and ${second.id} must not overlap`,
      );
    }
    for (const portal of document.portals) {
      assert.ok(
        Math.hypot(first.x - portal.x, first.y - portal.y) > first.radius + 24,
        `${context} ball ${first.id} must not overlap portal ${portal.id}'s placement clearance`,
      );
    }
  }
};

test('the preset catalog contains ten distinct experiments', () => {
  assert.equal(EXPERIMENT_PRESETS.length, 10);
  assert.equal(new Set(EXPERIMENT_PRESETS.map(preset => preset.id)).size, 10);
});

test('every preset creates a valid, paired, in-bounds initial experiment on desktop and mobile', () => {
  for (const viewport of VIEWPORTS) {
    for (const preset of EXPERIMENT_PRESETS) {
      const context = `${preset.id} at ${viewport.name} ${viewport.width}x${viewport.height}`;
      const document = preset.create(viewport.width, viewport.height, `test-${preset.id}`);
      assertExperimentInvariants(document, viewport.width, viewport.height, context);
    }
  }
});

test('Surprise Me is deterministic for one seed and materially changes for another', () => {
  const first = createSurpriseExperiment(1440, 900, 'deterministic-seed');
  const replay = createSurpriseExperiment(1440, 900, 'deterministic-seed');
  const different = createSurpriseExperiment(1440, 900, 'different-seed');

  assert.deepEqual(replay, first);

  const physicalSetup = ({ id: _id, seed: _seed, ...setup }: ExperimentDocument) => setup;
  assert.notDeepEqual(physicalSetup(different), physicalSetup(first));
});

test('Surprise Me stays schema-valid, paired, in bounds, and non-overlapping across seeds', () => {
  for (const viewport of VIEWPORTS) {
    for (let seed = 0; seed < 32; seed += 1) {
      const context = `surprise seed ${seed} at ${viewport.name} ${viewport.width}x${viewport.height}`;
      const document = createSurpriseExperiment(viewport.width, viewport.height, seed);
      assertExperimentInvariants(document, viewport.width, viewport.height, context);
      assertSurpriseSpacing(document, viewport.width, context);
    }
  }
});
