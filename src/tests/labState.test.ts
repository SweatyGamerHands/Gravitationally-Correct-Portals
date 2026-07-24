import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canRedoHistory,
  canUndoHistory,
  clearHistory,
  commitHistory,
  createHistory,
  redoHistory,
  undoHistory,
} from '../lab/history';
import { createSeededRandom, hashSeed } from '../lab/seededRandom';
import { fitExperimentToWorld } from '../lab/responsiveExperiment';
import {
  decodeExperimentDocument,
  encodeExperimentDocument,
  validateExperimentDocument,
} from '../lab/snapshotCodec';
import type { ExperimentDocument } from '../lab/types';

const makeDocument = (): ExperimentDocument => ({
  version: 1,
  id: 'experiment-α',
  name: 'Portal orbit 🌀',
  question: 'Can the probe return with a different velocity?',
  seed: 'replay-seed-42',
  simTime: 12.5,
  config: {
    gravity: 1,
    friction: 0.994,
    elasticity: 0.55,
    timeScale: 0.5,
    gridIntensity: 20,
    trailIntensity: 1,
    size: 15,
    mass: 20,
    substeps: 4,
    vacuum: false,
    showGrid: true,
    showFlow: true,
    showStreamlines: true,
    showHeatmap: false,
    debugOverlay: false,
    flowDensity: 15,
    flowScale: 1,
    portalWidth: 100,
    twoSided: false,
    showVelocityVectors: true,
    showAccelerationVectors: false,
    showPortalFrames: true,
    showClearance: true,
    showEnergyChart: true,
  },
  portals: [
    {
      id: 'blue',
      x: 120,
      y: 300,
      angle: Math.PI / 2,
      color: '#00a2ff',
      width: 100,
      twoSided: false,
      motion: {
        enabled: true,
        kind: 'oscillate',
        originX: 120,
        originY: 300,
        originAngle: Math.PI / 2,
        amplitude: 40,
        frequency: 0.5,
        axisAngle: 0,
        phase: 0.25,
        angularAmplitude: 0.2,
      },
    },
    {
      id: 'orange',
      x: 500,
      y: 180,
      angle: -Math.PI / 2,
      color: '#ff8a00',
      width: 100,
      twoSided: true,
      motion: {
        enabled: false,
        kind: 'static',
        originX: 500,
        originY: 180,
        originAngle: -Math.PI / 2,
        amplitude: 0,
        frequency: 0,
        axisAngle: 0,
        phase: 0,
        angularAmplitude: 0,
      },
    },
  ],
  balls: [
    {
      id: 'probe-1',
      label: 'Probe Δv',
      x: 200,
      y: 100,
      oldX: 198,
      oldY: 99,
      vx: 120,
      vy: -40,
      radius: 12,
      mass: 8,
      cooldown: 0,
      color: 'hsl(220, 90%, 65%)',
      trail: [{ x: 190, y: 104 }, { x: 198, y: 99 }],
    },
  ],
});

const encodeRawText = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
};

test('seed hashing has stable golden values and distinguishes seed types', () => {
  assert.equal(hashSeed('portal-lab'), 2473788090);
  assert.equal(hashSeed(42), 2226716308);
  assert.notEqual(hashSeed(42), hashSeed('42'));
});

test('seeded random streams reproduce a stable sequence', () => {
  const first = createSeededRandom('portal-lab');
  const second = createSeededRandom('portal-lab');
  const expected = [475885493, 1218896520, 1880196441, 759179716, 3017609313];

  assert.deepEqual(expected.map(() => first.nextUint32()), expected);
  assert.deepEqual(expected.map(() => second.nextUint32()), expected);
});

test('seeded random helpers stay inside their half-open ranges', () => {
  const random = createSeededRandom(7);
  const values = Array.from({ length: 500 }, () => random.range(-3, 9));
  const integers = Array.from({ length: 500 }, () => random.integer(2, 7));

  assert.ok(values.every(value => value >= -3 && value < 9));
  assert.ok(integers.every(value => Number.isInteger(value) && value >= 2 && value < 7));
  assert.equal(random.pick([]), undefined);
  assert.ok(['blue', 'orange'].includes(random.pick(['blue', 'orange'])!));
  assert.throws(() => random.range(1, 1), RangeError);
  assert.throws(() => random.integer(2, 2), RangeError);
});

test('history commits, undoes, and redoes without mutating earlier states', () => {
  const initial = createHistory('a');
  const withB = commitHistory(initial, 'b');
  const withC = commitHistory(withB, 'c');
  const undone = undoHistory(withC);
  const redone = redoHistory(undone);

  assert.deepEqual(initial, { past: [], present: 'a', future: [] });
  assert.deepEqual(withC, { past: ['a', 'b'], present: 'c', future: [] });
  assert.deepEqual(undone, { past: ['a'], present: 'b', future: ['c'] });
  assert.deepEqual(redone, withC);
  assert.equal(canUndoHistory(initial), false);
  assert.equal(canUndoHistory(withC), true);
  assert.equal(canRedoHistory(undone), true);
});

test('a new commit after undo invalidates the complete redo branch', () => {
  let history = createHistory(0);
  history = commitHistory(history, 1);
  history = commitHistory(history, 2);
  history = commitHistory(history, 3);
  history = undoHistory(undoHistory(history));
  assert.deepEqual(history.future, [2, 3]);

  const branched = commitHistory(history, 99);
  assert.deepEqual(branched, { past: [0, 1], present: 99, future: [] });
  assert.equal(canRedoHistory(branched), false);
});

test('history boundary actions and equivalent commits are no-ops', () => {
  const history = createHistory({ value: 1 });
  assert.equal(undoHistory(history), history);
  assert.equal(redoHistory(history), history);
  assert.equal(commitHistory(history, history.present), history);

  const structurallyEqual = { value: 1 };
  const customNoOp = commitHistory(history, structurallyEqual, (a, b) => a.value === b.value);
  assert.equal(customNoOp, history);
  assert.deepEqual(clearHistory(commitHistory(history, { value: 2 })), {
    past: [],
    present: { value: 2 },
    future: [],
  });
});

test('history does not impose a hidden entry cap', () => {
  let history = createHistory(0);
  for (let value = 1; value <= 2048; value += 1) history = commitHistory(history, value);
  assert.equal(history.past.length, 2048);
  assert.equal(history.present, 2048);
});

test('experiment documents round trip through UTF-8 base64url exactly', () => {
  const document = makeDocument();
  const encoded = encodeExperimentDocument(document);
  assert.equal(encoded.ok, true);
  if (!encoded.ok) return;

  assert.match(encoded.value, /^[A-Za-z0-9_-]+$/u);
  assert.equal(/[+/=]/u.test(encoded.value), false);

  const decoded = decodeExperimentDocument(encoded.value);
  assert.equal(decoded.ok, true);
  if (!decoded.ok) return;
  assert.deepEqual(decoded.value, document);
});

test('snapshot encoding is deterministic and handles data larger than one byte chunk', () => {
  const document = makeDocument();
  document.question = `Unicode payload: ${'🌀重力'.repeat(12_000)}`;
  const first = encodeExperimentDocument(document);
  const second = encodeExperimentDocument(document);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(first.value, second.value);

  const decoded = decodeExperimentDocument(first.value);
  assert.equal(decoded.ok, true);
  if (decoded.ok) assert.equal(decoded.value.question, document.question);
});

test('snapshot decoding reports distinct transport and JSON failures without throwing', () => {
  for (const invalid of ['', 'a', 'abc+', null]) {
    assert.doesNotThrow(() => decodeExperimentDocument(invalid));
    const result = decodeExperimentDocument(invalid);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'invalid-base64url');
  }

  const invalidUtf8 = decodeExperimentDocument('_w');
  assert.equal(invalidUtf8.ok, false);
  if (!invalidUtf8.ok) assert.equal(invalidUtf8.error.code, 'invalid-utf8');

  const invalidJson = decodeExperimentDocument(encodeRawText('not JSON'));
  assert.equal(invalidJson.ok, false);
  if (!invalidJson.ok) assert.equal(invalidJson.error.code, 'invalid-json');
});

test('snapshot validation identifies unsupported versions and precise invalid paths', () => {
  const versionTwo = { ...makeDocument(), version: 2 };
  const unsupported = decodeExperimentDocument(encodeRawText(JSON.stringify(versionTwo)));
  assert.equal(unsupported.ok, false);
  if (!unsupported.ok) {
    assert.equal(unsupported.error.code, 'unsupported-version');
    assert.equal(unsupported.error.path, 'version');
  }

  const badMotion = makeDocument();
  (badMotion.portals[0].motion as { kind: string }).kind = 'teleport-randomly';
  const motionResult = validateExperimentDocument(badMotion);
  assert.equal(motionResult.ok, false);
  if (!motionResult.ok) assert.equal(motionResult.error.path, 'portals[0].motion.kind');

  const badTrail = makeDocument();
  badTrail.balls[0].trail[1].x = Number.NaN;
  const trailResult = encodeExperimentDocument(badTrail);
  assert.equal(trailResult.ok, false);
  if (!trailResult.ok) assert.equal(trailResult.error.path, 'balls[0].trail[1].x');
});

test('snapshot validation rejects duplicate stable ids and unsafe numeric state', () => {
  const duplicate = makeDocument();
  duplicate.balls.push({ ...duplicate.balls[0], label: 'Copy' });
  const duplicateResult = validateExperimentDocument(duplicate);
  assert.equal(duplicateResult.ok, false);
  if (!duplicateResult.ok) {
    assert.equal(duplicateResult.error.code, 'invalid-document');
    assert.equal(duplicateResult.error.path, 'balls');
  }

  const invalidSubsteps = makeDocument();
  invalidSubsteps.config.substeps = 0;
  const substepResult = validateExperimentDocument(invalidSubsteps);
  assert.equal(substepResult.ok, false);
  if (!substepResult.ok) assert.equal(substepResult.error.path, 'config.substeps');

  const negativeTime = makeDocument();
  negativeTime.simTime = -0.1;
  const timeResult = validateExperimentDocument(negativeTime);
  assert.equal(timeResult.ok, false);
  if (!timeResult.ok) assert.equal(timeResult.error.path, 'simTime');
});

test('snapshot validation rejects malformed fields throughout the schema', () => {
  const cases: Array<{
    path: string;
    mutate: (document: ExperimentDocument) => unknown;
  }> = [
    { path: '$', mutate: () => null },
    { path: 'version', mutate: document => ({ ...document, version: '1' }) },
    { path: 'id', mutate: document => ({ ...document, id: '' }) },
    { path: 'name', mutate: document => ({ ...document, name: '' }) },
    { path: 'question', mutate: document => ({ ...document, question: 4 }) },
    { path: 'seed', mutate: document => ({ ...document, seed: Number.POSITIVE_INFINITY }) },
    { path: 'config', mutate: document => ({ ...document, config: null }) },
    { path: 'config.gravity', mutate: document => ({
      ...document,
      config: { ...document.config, gravity: Number.NaN },
    }) },
    { path: 'config.substeps', mutate: document => ({
      ...document,
      config: { ...document.config, substeps: 1.5 },
    }) },
    { path: 'config.size', mutate: document => ({
      ...document,
      config: { ...document.config, size: 0 },
    }) },
    { path: 'config.vacuum', mutate: document => ({
      ...document,
      config: { ...document.config, vacuum: 'no' },
    }) },
    { path: 'portals', mutate: document => ({ ...document, portals: null }) },
    { path: 'balls', mutate: document => ({ ...document, balls: null }) },
    { path: 'portals[0]', mutate: document => ({ ...document, portals: [null] }) },
    { path: 'portals[0].id', mutate: document => {
      document.portals[0].id = '';
      return document;
    } },
    { path: 'portals[0].x', mutate: document => {
      document.portals[0].x = Number.NaN;
      return document;
    } },
    { path: 'portals[0].width', mutate: document => {
      document.portals[0].width = 0;
      return document;
    } },
    { path: 'portals[0].color', mutate: document => {
      (document.portals[0] as { color: unknown }).color = 5;
      return document;
    } },
    { path: 'portals[0].twoSided', mutate: document => {
      (document.portals[0] as { twoSided: unknown }).twoSided = 'yes';
      return document;
    } },
    { path: 'portals[0].motion', mutate: document => {
      (document.portals[0] as { motion: unknown }).motion = null;
      return document;
    } },
    { path: 'portals[0].motion.enabled', mutate: document => {
      (document.portals[0].motion as { enabled: unknown }).enabled = 1;
      return document;
    } },
    { path: 'portals[0].motion.originX', mutate: document => {
      document.portals[0].motion.originX = Number.NaN;
      return document;
    } },
    { path: 'portals[0].motion.frequency', mutate: document => {
      document.portals[0].motion.frequency = -1;
      return document;
    } },
    { path: 'balls[0]', mutate: document => ({ ...document, balls: [null] }) },
    { path: 'balls[0].id', mutate: document => {
      document.balls[0].id = '';
      return document;
    } },
    { path: 'balls[0].label', mutate: document => {
      (document.balls[0] as { label: unknown }).label = 2;
      return document;
    } },
    { path: 'balls[0].color', mutate: document => {
      (document.balls[0] as { color: unknown }).color = false;
      return document;
    } },
    { path: 'balls[0].vx', mutate: document => {
      document.balls[0].vx = Number.POSITIVE_INFINITY;
      return document;
    } },
    { path: 'balls[0].radius', mutate: document => {
      document.balls[0].radius = 0;
      return document;
    } },
    { path: 'balls[0].cooldown', mutate: document => {
      document.balls[0].cooldown = -1;
      return document;
    } },
    { path: 'balls[0].trail', mutate: document => {
      (document.balls[0] as { trail: unknown }).trail = null;
      return document;
    } },
    { path: 'balls[0].trail[0]', mutate: document => {
      (document.balls[0].trail as unknown[])[0] = null;
      return document;
    } },
    { path: 'balls[0].trail[0].y', mutate: document => {
      document.balls[0].trail[0].y = Number.NaN;
      return document;
    } },
  ];

  for (const entry of cases) {
    const result = validateExperimentDocument(entry.mutate(makeDocument()));
    assert.equal(result.ok, false, `expected malformed field ${entry.path} to fail`);
    if (!result.ok) assert.equal(result.error.path, entry.path);
  }

  const duplicatePortal = makeDocument();
  duplicatePortal.portals.push({ ...duplicatePortal.portals[0] });
  const duplicateResult = validateExperimentDocument(duplicatePortal);
  assert.equal(duplicateResult.ok, false);
  if (!duplicateResult.ok) assert.equal(duplicateResult.error.path, 'portals');
});

test('snapshot validation and encoding contain hostile object access failures', () => {
  const hostile = new Proxy({}, {
    get() {
      throw new Error('hostile getter');
    },
  });
  const validation = validateExperimentDocument(hostile);
  assert.equal(validation.ok, false);
  if (!validation.ok) assert.equal(validation.error.code, 'invalid-document');

  const document = makeDocument() as ExperimentDocument & { toJSON?: () => unknown };
  Object.defineProperty(document, 'toJSON', {
    enumerable: false,
    value: () => {
      throw new Error('cannot stringify');
    },
  });
  const encoding = encodeExperimentDocument(document);
  assert.equal(encoding.ok, false);
  if (!encoding.ok) assert.equal(encoding.error.code, 'encode-failed');
});

test('responsive fitting uniformly scales spatial state and centers aspect-ratio margins', () => {
  const document = makeDocument();
  document.world = { width: 1_000, height: 500 };
  document.config.gravity = 10;
  document.config.gridIntensity = 40;
  document.config.size = 20;
  document.config.portalWidth = 120;
  document.portals[0].x = 100;
  document.portals[0].y = 200;
  document.portals[0].width = 120;
  document.portals[0].motion.originX = 80;
  document.portals[0].motion.originY = 180;
  document.portals[0].motion.amplitude = 60;
  document.balls[0] = {
    ...document.balls[0],
    x: 400,
    y: 100,
    oldX: 390,
    oldY: 90,
    vx: 200,
    vy: -40,
    radius: 20,
    trail: [{ x: 350, y: 80 }],
  };

  const fitted = fitExperimentToWorld(document, 500, 500);

  assert.deepEqual(fitted.world, { width: 500, height: 500 });
  assert.equal(fitted.config.gravity, 5);
  assert.equal(fitted.config.gridIntensity, 20);
  assert.equal(fitted.config.size, 10);
  assert.equal(fitted.config.portalWidth, 60);
  assert.deepEqual(
    { x: fitted.portals[0].x, y: fitted.portals[0].y, width: fitted.portals[0].width },
    { x: 50, y: 225, width: 60 },
  );
  assert.deepEqual(
    {
      x: fitted.portals[0].motion.originX,
      y: fitted.portals[0].motion.originY,
      amplitude: fitted.portals[0].motion.amplitude,
    },
    { x: 40, y: 215, amplitude: 30 },
  );
  assert.deepEqual(
    {
      x: fitted.balls[0].x,
      y: fitted.balls[0].y,
      oldX: fitted.balls[0].oldX,
      oldY: fitted.balls[0].oldY,
      vx: fitted.balls[0].vx,
      vy: fitted.balls[0].vy,
      radius: fitted.balls[0].radius,
    },
    { x: 200, y: 175, oldX: 195, oldY: 170, vx: 100, vy: -20, radius: 10 },
  );
  assert.deepEqual(fitted.balls[0].trail, [{ x: 175, y: 165 }]);

  // Dimensionless and time-domain quantities must not be distorted.
  assert.equal(fitted.portals[0].angle, document.portals[0].angle);
  assert.equal(fitted.portals[0].motion.frequency, document.portals[0].motion.frequency);
  assert.equal(fitted.balls[0].mass, document.balls[0].mass);
  assert.equal(document.portals[0].x, 100, 'the source document remains immutable');
  assert.equal(document.balls[0].radius, 20, 'nested source state remains immutable');
});

test('responsive fitting handles missing source dimensions and rejects invalid targets safely', () => {
  const withoutWorld = makeDocument();
  const withTargetWorld = fitExperimentToWorld(withoutWorld, 640, 360);
  assert.deepEqual(withTargetWorld.world, { width: 640, height: 360 });
  assert.equal(withTargetWorld.config, withoutWorld.config);
  assert.equal(withTargetWorld.portals, withoutWorld.portals);
  assert.equal(withTargetWorld.balls, withoutWorld.balls);

  const invalidSource = { ...makeDocument(), world: { width: 0, height: 500 } };
  const recovered = fitExperimentToWorld(invalidSource, 320, 240);
  assert.deepEqual(recovered.world, { width: 320, height: 240 });
  assert.equal(recovered.portals, invalidSource.portals);

  const valid = makeDocument();
  valid.world = { width: 800, height: 600 };
  for (const [width, height] of [
    [0, 600],
    [-1, 600],
    [800, Number.NaN],
    [Number.POSITIVE_INFINITY, 600],
  ]) {
    assert.equal(fitExperimentToWorld(valid, width, height), valid);
  }
});

test('snapshot safety bounds world size and expensive visualization settings', () => {
  const atLimits = makeDocument();
  atLimits.world = { width: 100_000, height: 1 };
  atLimits.config.substeps = 64;
  atLimits.config.flowDensity = 64;
  atLimits.config.portalWidth = 4_000;
  atLimits.portals[0].width = 4_000;
  assert.equal(validateExperimentDocument(atLimits).ok, true);

  const cases: Array<{
    path: string;
    mutate: (document: ExperimentDocument) => void;
  }> = [
    { path: 'world.width', mutate: document => { document.world = { width: 100_001, height: 500 }; } },
    { path: 'world.height', mutate: document => { document.world = { width: 500, height: 0 }; } },
    { path: 'config.substeps', mutate: document => { document.config.substeps = 65; } },
    { path: 'config.flowDensity', mutate: document => { document.config.flowDensity = 65; } },
    { path: 'config.portalWidth', mutate: document => { document.config.portalWidth = 4_001; } },
    { path: 'portals[0].width', mutate: document => { document.portals[0].width = 4_001; } },
  ];

  for (const entry of cases) {
    const document = makeDocument();
    entry.mutate(document);
    const result = validateExperimentDocument(document);
    assert.equal(result.ok, false, `expected ${entry.path} to reject its unsafe value`);
    if (!result.ok) {
      assert.equal(result.error.code, 'invalid-document');
      assert.equal(result.error.path, entry.path);
    }
  }
});

test('snapshot safety enforces portal, body, and per-body trail limits', () => {
  const document = makeDocument();
  document.portals = Array.from({ length: 8 }, (_, index) => ({
    ...document.portals[index % 2],
    id: `mouth-${index}`,
    motion: { ...document.portals[index % 2].motion },
  }));
  document.balls = Array.from({ length: 64 }, (_, index) => ({
    ...document.balls[0],
    id: `body-${index}`,
    trail: Array.from({ length: 80 }, (__, point) => ({ x: point, y: -point })),
  }));
  assert.equal(validateExperimentDocument(document).ok, true, 'all collection maxima are accepted');

  const tooManyPortals = makeDocument();
  tooManyPortals.portals = Array.from({ length: 9 }, (_, index) => ({
    ...tooManyPortals.portals[index % 2],
    id: `mouth-${index}`,
    motion: { ...tooManyPortals.portals[index % 2].motion },
  }));
  const portalResult = validateExperimentDocument(tooManyPortals);
  assert.equal(portalResult.ok, false);
  if (!portalResult.ok) assert.equal(portalResult.error.path, 'portals');

  const tooManyBalls = makeDocument();
  tooManyBalls.balls = Array.from({ length: 65 }, (_, index) => ({
    ...tooManyBalls.balls[0],
    id: `body-${index}`,
    trail: [],
  }));
  const ballResult = validateExperimentDocument(tooManyBalls);
  assert.equal(ballResult.ok, false);
  if (!ballResult.ok) assert.equal(ballResult.error.path, 'balls');

  const tooMuchTrail = makeDocument();
  tooMuchTrail.balls[0].trail = Array.from({ length: 81 }, (_, index) => ({ x: index, y: index }));
  const trailResult = validateExperimentDocument(tooMuchTrail);
  assert.equal(trailResult.ok, false);
  if (!trailResult.ok) assert.equal(trailResult.error.path, 'balls[0].trail');
});

test('snapshot safety rejects oversized text and encoded payloads before loading', () => {
  const maximumQuestion = makeDocument();
  maximumQuestion.question = 'q'.repeat(100_000);
  assert.equal(validateExperimentDocument(maximumQuestion).ok, true);

  const oversizedQuestion = makeDocument();
  oversizedQuestion.question = 'q'.repeat(100_001);
  const questionResult = encodeExperimentDocument(oversizedQuestion);
  assert.equal(questionResult.ok, false);
  if (!questionResult.ok) {
    assert.equal(questionResult.error.code, 'invalid-document');
    assert.equal(questionResult.error.path, 'question');
  }

  const payloadResult = decodeExperimentDocument('A'.repeat(2_000_001));
  assert.equal(payloadResult.ok, false);
  if (!payloadResult.ok) {
    assert.equal(payloadResult.error.code, 'invalid-base64url');
    assert.match(payloadResult.error.message, /too large/u);
  }
});
