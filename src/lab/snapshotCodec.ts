import type {
  ExperimentDocument,
  LabConfig,
  PortalMotionKind,
  PortalMotionSpec,
  SerializableBall,
  SerializablePoint,
  SerializablePortal,
  SerializableWorld,
} from './types';

export type SnapshotErrorCode =
  | 'invalid-base64url'
  | 'invalid-utf8'
  | 'invalid-json'
  | 'invalid-document'
  | 'unsupported-version'
  | 'encode-failed';

export type SnapshotError = {
  code: SnapshotErrorCode;
  message: string;
  path?: string;
};

export type SnapshotResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SnapshotError };

const isFailure = <T>(result: SnapshotResult<T>): result is { ok: false; error: SnapshotError } => (
  result.ok === false
);

const success = <T>(value: T): SnapshotResult<T> => ({ ok: true, value });

const failure = <T>(
  code: SnapshotErrorCode,
  message: string,
  path?: string,
): SnapshotResult<T> => ({ ok: false, error: { code, message, ...(path ? { path } : {}) } });

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const isFiniteNumber = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value)
);

const MAX_ENCODED_CHARS = 2_000_000;
const MAX_TEXT_CHARS = 100_000;
const MAX_SHORT_TEXT_CHARS = 256;
const MAX_COORDINATE = 10_000_000;
const MAX_PORTALS = 8;
const MAX_BALLS = 64;
const MAX_TRAIL_POINTS = 80;

const isNumberInRange = (value: unknown, minimum: number, maximum: number): value is number => (
  isFiniteNumber(value) && value >= minimum && value <= maximum
);

const isBoundedString = (value: unknown, maximum = MAX_SHORT_TEXT_CHARS): value is string => (
  typeof value === 'string' && value.length <= maximum
);

const invalidField = <T>(path: string, expectation: string): SnapshotResult<T> => (
  failure('invalid-document', `${path} ${expectation}.`, path)
);

const validatePoint = (value: unknown, path: string): SnapshotResult<SerializablePoint> => {
  if (!isRecord(value)) return invalidField(path, 'must be an object');
  if (!isNumberInRange(value.x, -MAX_COORDINATE, MAX_COORDINATE)) return invalidField(`${path}.x`, 'is outside the supported world range');
  if (!isNumberInRange(value.y, -MAX_COORDINATE, MAX_COORDINATE)) return invalidField(`${path}.y`, 'is outside the supported world range');
  return success(value as SerializablePoint);
};

const validateWorld = (value: unknown): SnapshotResult<SerializableWorld> => {
  if (!isRecord(value)) return invalidField('world', 'must be an object');
  for (const field of ['width', 'height'] as const) {
    if (!isNumberInRange(value[field], 1, 100_000)) {
      return invalidField(`world.${field}`, 'must be between 1 and 100000');
    }
  }
  return success(value as SerializableWorld);
};

const CONFIG_NUMBER_FIELDS: readonly (keyof LabConfig)[] = [
  'gravity',
  'friction',
  'elasticity',
  'timeScale',
  'gridIntensity',
  'trailIntensity',
  'size',
  'mass',
  'substeps',
  'flowDensity',
  'flowScale',
  'portalWidth',
];

const CONFIG_BOOLEAN_FIELDS: readonly (keyof LabConfig)[] = [
  'vacuum',
  'showGrid',
  'showFlow',
  'showStreamlines',
  'showHeatmap',
  'debugOverlay',
  'twoSided',
  'showVelocityVectors',
  'showAccelerationVectors',
  'showPortalFrames',
  'showClearance',
  'showEnergyChart',
];

const CONFIG_LIMITS: Partial<Record<keyof LabConfig, readonly [number, number]>> = {
  gravity: [-20, 20],
  friction: [0, 1],
  elasticity: [0, 1.5],
  timeScale: [0.01, 4],
  gridIntensity: [0, 200],
  trailIntensity: [0, 5],
  size: [3, 200],
  mass: [0.1, 10_000],
  substeps: [1, 64],
  flowDensity: [4, 64],
  flowScale: [0.05, 10],
  portalWidth: [10, 4_000],
};

const validateConfig = (value: unknown): SnapshotResult<LabConfig> => {
  if (!isRecord(value)) return invalidField('config', 'must be an object');

  for (const field of CONFIG_NUMBER_FIELDS) {
    if (!isFiniteNumber(value[field])) {
      return invalidField(`config.${field}`, 'must be a finite number');
    }
    const limits = CONFIG_LIMITS[field];
    if (limits && !isNumberInRange(value[field], limits[0], limits[1])) {
      return invalidField(`config.${field}`, `must be between ${limits[0]} and ${limits[1]}`);
    }
  }
  if (!Number.isInteger(value.substeps) || (value.substeps as number) < 1) {
    return invalidField('config.substeps', 'must be a positive integer');
  }
  for (const field of CONFIG_BOOLEAN_FIELDS) {
    if (typeof value[field] !== 'boolean') {
      return invalidField(`config.${field}`, 'must be a boolean');
    }
  }

  return success(value as LabConfig);
};

const MOTION_KINDS: readonly PortalMotionKind[] = ['static', 'linear', 'circular', 'oscillate'];
const MOTION_NUMBER_FIELDS: readonly (keyof PortalMotionSpec)[] = [
  'originX',
  'originY',
  'originAngle',
  'amplitude',
  'frequency',
  'axisAngle',
  'phase',
  'angularAmplitude',
];

const validateMotion = (value: unknown, path: string): SnapshotResult<PortalMotionSpec> => {
  if (!isRecord(value)) return invalidField(path, 'must be an object');
  if (typeof value.enabled !== 'boolean') {
    return invalidField(`${path}.enabled`, 'must be a boolean');
  }
  if (typeof value.kind !== 'string' || !MOTION_KINDS.includes(value.kind as PortalMotionKind)) {
    return invalidField(`${path}.kind`, `must be one of ${MOTION_KINDS.join(', ')}`);
  }
  for (const field of MOTION_NUMBER_FIELDS) {
    if (!isFiniteNumber(value[field])) {
      return invalidField(`${path}.${field}`, 'must be a finite number');
    }
  }
  const motionLimits: Partial<Record<keyof PortalMotionSpec, readonly [number, number]>> = {
    originX: [-MAX_COORDINATE, MAX_COORDINATE],
    originY: [-MAX_COORDINATE, MAX_COORDINATE],
    originAngle: [-1_000_000, 1_000_000],
    amplitude: [0, 2_000],
    frequency: [0, 20],
    axisAngle: [-1_000_000, 1_000_000],
    phase: [-1_000_000, 1_000_000],
    angularAmplitude: [0, Math.PI * 4],
  };
  for (const field of MOTION_NUMBER_FIELDS) {
    const limits = motionLimits[field];
    if (limits && !isNumberInRange(value[field], limits[0], limits[1])) {
      return invalidField(`${path}.${field}`, `must be between ${limits[0]} and ${limits[1]}`);
    }
  }
  return success(value as PortalMotionSpec);
};

const validatePortal = (value: unknown, path: string): SnapshotResult<SerializablePortal> => {
  if (!isRecord(value)) return invalidField(path, 'must be an object');
  if (!isBoundedString(value.id) || value.id.length === 0) {
    return invalidField(`${path}.id`, 'must be a non-empty string');
  }
  if (!isNumberInRange(value.x, -MAX_COORDINATE, MAX_COORDINATE)) return invalidField(`${path}.x`, 'is outside the supported world range');
  if (!isNumberInRange(value.y, -MAX_COORDINATE, MAX_COORDINATE)) return invalidField(`${path}.y`, 'is outside the supported world range');
  if (!isNumberInRange(value.angle, -1_000_000, 1_000_000)) return invalidField(`${path}.angle`, 'is outside the supported angular range');
  if (!isNumberInRange(value.width, 10, 4_000)) return invalidField(`${path}.width`, 'must be between 10 and 4000');
  if (!isBoundedString(value.color, 128)) return invalidField(`${path}.color`, 'must be a short string');
  if (typeof value.twoSided !== 'boolean') {
    return invalidField(`${path}.twoSided`, 'must be a boolean');
  }
  const motion = validateMotion(value.motion, `${path}.motion`);
  if (isFailure(motion)) return motion;
  return success(value as SerializablePortal);
};

const validateBall = (value: unknown, path: string): SnapshotResult<SerializableBall> => {
  if (!isRecord(value)) return invalidField(path, 'must be an object');
  if (!isBoundedString(value.id) || value.id.length === 0) {
    return invalidField(`${path}.id`, 'must be a non-empty string');
  }
  if (!isBoundedString(value.label)) return invalidField(`${path}.label`, 'must be a short string');
  if (!isBoundedString(value.color, 128)) return invalidField(`${path}.color`, 'must be a short string');

  for (const field of [
    'x', 'y', 'oldX', 'oldY', 'vx', 'vy', 'radius', 'mass', 'cooldown',
  ] as const) {
    if (!isFiniteNumber(value[field])) {
      return invalidField(`${path}.${field}`, 'must be a finite number');
    }
  }
  for (const field of ['x', 'y', 'oldX', 'oldY', 'vx', 'vy'] as const) {
    if (!isNumberInRange(value[field], -MAX_COORDINATE, MAX_COORDINATE)) return invalidField(`${path}.${field}`, 'is outside the supported world range');
  }
  if (!isNumberInRange(value.radius, 1, 1_000)) return invalidField(`${path}.radius`, 'must be between 1 and 1000');
  if (!isNumberInRange(value.mass, 0.01, 1_000_000)) return invalidField(`${path}.mass`, 'must be between 0.01 and 1000000');
  if (!isNumberInRange(value.cooldown, 0, 60)) return invalidField(`${path}.cooldown`, 'must be between 0 and 60');
  if (!Array.isArray(value.trail)) return invalidField(`${path}.trail`, 'must be an array');
  if (value.trail.length > MAX_TRAIL_POINTS) return invalidField(`${path}.trail`, `must contain at most ${MAX_TRAIL_POINTS} points`);
  for (let index = 0; index < value.trail.length; index += 1) {
    const point = validatePoint(value.trail[index], `${path}.trail[${index}]`);
    if (isFailure(point)) return point;
  }
  return success(value as SerializableBall);
};

const findDuplicateId = (values: readonly { id: string }[]): string | undefined => {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) return value.id;
    seen.add(value.id);
  }
  return undefined;
};

/** Validate untrusted parsed data before it enters the simulation. */
export const validateExperimentDocument = (value: unknown): SnapshotResult<ExperimentDocument> => {
  try {
    if (!isRecord(value)) return invalidField('$', 'must be an object');
    if (value.version !== 1) {
      if (typeof value.version === 'number' && Number.isFinite(value.version)) {
        return failure(
          'unsupported-version',
          `Unsupported experiment version ${value.version}; this build supports version 1.`,
          'version',
        );
      }
      return invalidField('version', 'must be the number 1');
    }
    for (const field of ['id', 'name'] as const) {
      if (!isBoundedString(value[field]) || value[field].length === 0) {
        return invalidField(field, 'must be a non-empty string');
      }
    }
    if (!isBoundedString(value.question, MAX_TEXT_CHARS)) return invalidField('question', `must be a string of at most ${MAX_TEXT_CHARS} characters`);
    if (
      (typeof value.seed !== 'string' || value.seed.length > MAX_SHORT_TEXT_CHARS)
      && !(typeof value.seed === 'number' && Number.isFinite(value.seed))
    ) {
      return invalidField('seed', 'must be a string or finite number');
    }
    if (!isNumberInRange(value.simTime, 0, 1_000_000_000)) {
      return invalidField('simTime', 'must be between 0 and 1000000000');
    }
    if (value.world !== undefined) {
      const world = validateWorld(value.world);
      if (isFailure(world)) return world;
    }

    const config = validateConfig(value.config);
    if (isFailure(config)) return config;
    if (!Array.isArray(value.portals)) return invalidField('portals', 'must be an array');
    if (!Array.isArray(value.balls)) return invalidField('balls', 'must be an array');
    if (value.portals.length > MAX_PORTALS) return invalidField('portals', `must contain at most ${MAX_PORTALS} mouths`);
    if (value.balls.length > MAX_BALLS) return invalidField('balls', `must contain at most ${MAX_BALLS} bodies`);

    for (let index = 0; index < value.portals.length; index += 1) {
      const portal = validatePortal(value.portals[index], `portals[${index}]`);
      if (isFailure(portal)) return portal;
    }
    for (let index = 0; index < value.balls.length; index += 1) {
      const ball = validateBall(value.balls[index], `balls[${index}]`);
      if (isFailure(ball)) return ball;
    }
    if (value.portals.length % 2 !== 0) {
      return invalidField('portals', 'must contain complete adjacent mouth pairs');
    }

    const duplicatePortal = findDuplicateId(value.portals as SerializablePortal[]);
    if (duplicatePortal) {
      return failure('invalid-document', `Duplicate portal id "${duplicatePortal}".`, 'portals');
    }
    const duplicateBall = findDuplicateId(value.balls as SerializableBall[]);
    if (duplicateBall) {
      return failure('invalid-document', `Duplicate ball id "${duplicateBall}".`, 'balls');
    }

    return success(value as ExperimentDocument);
  } catch {
    return failure('invalid-document', 'The experiment document could not be inspected safely.');
  }
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

/** Encode a validated document as UTF-8 base64url without relying on Node Buffer. */
export const encodeExperimentDocument = (value: unknown): SnapshotResult<string> => {
  const validation = validateExperimentDocument(value);
  if (isFailure(validation)) return validation;

  try {
    const json = JSON.stringify(validation.value);
    const base64 = bytesToBase64(new TextEncoder().encode(json));
    const encoded = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
    if (encoded.length > MAX_ENCODED_CHARS) {
      return failure('encode-failed', 'The experiment is too large to share safely.');
    }
    return success(encoded);
  } catch {
    return failure('encode-failed', 'The experiment could not be encoded.');
  }
};

/** Decode and validate an untrusted base64url experiment. This function never throws. */
export const decodeExperimentDocument = (encoded: unknown): SnapshotResult<ExperimentDocument> => {
  if (typeof encoded !== 'string' || encoded.length === 0) {
    return failure('invalid-base64url', 'The experiment code must be a non-empty base64url string.');
  }
  if (encoded.length > MAX_ENCODED_CHARS) {
    return failure('invalid-base64url', 'The experiment code is too large to load safely.');
  }
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded) || encoded.length % 4 === 1) {
    return failure('invalid-base64url', 'The experiment code contains invalid base64url data.');
  }

  let json: string;
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const bytes = base64ToBytes(padded);
    json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return failure('invalid-utf8', 'The experiment code is not valid UTF-8 data.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    return failure('invalid-json', 'The experiment code does not contain valid JSON.');
  }

  return validateExperimentDocument(parsed);
};
