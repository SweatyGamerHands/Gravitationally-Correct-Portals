import type { Point, Portal } from './types';
import { BASE_G, DEFAULT_FIELD_DERIVATIVE_STEP, PORTAL_EDGE_RADIUS } from './constants';
import { mapPointThroughPortal, worldPointToPortalLocal } from './portalTransform';
import { getLinkedPortal } from './portalTraversal';

export type FieldConfig = {
  vacuum?: boolean;
  gravity: number;
  derivativeStep?: number;
};

export type PotentialContribution = {
  portalId: string;
  depth: number;
  weight: number;
  potential: number;
  mappedPoint: Point;
};

export type FieldSample = {
  acceleration: Point;
  potential: number;
  directWeight: number;
  portalWeight: number;
  contributions: PotentialContribution[];
};

type PotentialSample = Omit<FieldSample, 'acceleration'>;

const MIN_APERTURE_WEIGHT = 1e-8;

const smoothstep = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export const getBaselineG = (_vacuum: boolean | undefined, gravityMult: number) => BASE_G * gravityMult;

/**
 * Smooth coupling to a finite aperture. Gravity is reciprocal even when matter
 * traversal is one-sided, so this weight intentionally has no sidedness flag.
 * The inner opening reaches unit coupling at the seam; that makes matched
 * points on a portal pair share one passive-mouth potential.
 */
export const apertureVisibilityWeight = (point: Point, portal: Portal): number => {
  const local = worldPointToPortalLocal(point, portal);
  const halfWidth = Math.max(0, portal.width / 2);
  if (halfWidth === 0) return 0;

  // Keep the whole physically traversable opening at unit coupling. The only
  // seam taper occupies the solid endpoint-cap region and its exterior.
  const innerEdge = Math.max(0, halfWidth - Math.min(PORTAL_EDGE_RADIUS, halfWidth * 0.5));
  const outerEdge = halfWidth + Math.max(12, portal.width * 0.15);
  const absAlong = Math.abs(local.along);
  const edgeWeight = absAlong <= innerEdge
    ? 1
    : 1 - smoothstep(clamp01((absAlong - innerEdge) / Math.max(1e-9, outerEdge - innerEdge)));

  const normalRange = Math.max(1, portal.width * 1.8);
  const normalWeight = 1 / (1 + (Math.abs(local.normal) / normalRange) ** 2);
  return clamp01(edgeWeight * normalWeight);
};

const baselinePotentialAt = (point: Point, config: FieldConfig) => (
  -getBaselineG(config.vacuum, config.gravity) * point.y
);

/**
 * The canonical field is built from a scalar potential, not by blending force
 * vectors. Each visible mouth pulls the field toward the symmetric average of
 * the local ambient potential and its linked image potential. Direct and linked
 * potentials are normalized so a pair imposes one passive potential at its seam.
 * Taking -grad(phi) retains the additional edge/range terms required for a
 * conservative field; omitting those terms is what allowed free-energy loops.
 */
const samplePotential = (
  point: Point,
  portals: readonly Portal[],
  config: FieldConfig,
  captureContributions: boolean,
): PotentialSample => {
  const directPotential = baselinePotentialAt(point, config);
  const baseAcceleration = getBaselineG(config.vacuum, config.gravity);
  if (portals.length < 2 || baseAcceleration === 0) {
    return {
      potential: directPotential,
      directWeight: 1,
      portalWeight: 0,
      contributions: [],
    };
  }

  const contributions: PotentialContribution[] = [];
  const mouthSamples: PotentialContribution[] = [];

  portals.forEach((entry, index) => {
    const exit = getLinkedPortal(portals, index);
    if (!exit) return;

    const weight = apertureVisibilityWeight(point, entry);
    if (weight <= MIN_APERTURE_WEIGHT) return;

    const mappedPoint = mapPointThroughPortal(point, entry, exit);
    const sharedLinkedPotential = (
      baselinePotentialAt(point, config)
      + baselinePotentialAt(mappedPoint, config)
    ) / 2;

    mouthSamples.push({
      portalId: entry.id,
      depth: 1,
      weight,
      potential: sharedLinkedPotential,
      mappedPoint,
    });
  });

  let directWeight = mouthSamples.reduce((product, sample) => product * (1 - sample.weight), 1);
  let effectiveSamples = mouthSamples.map((sample, sampleIndex) => ({
    ...sample,
    weight: sample.weight * mouthSamples.reduce(
      (product, other, otherIndex) => product * (sampleIndex === otherIndex ? 1 : 1 - other.weight),
      1,
    ),
  }));

  // Two exactly overlapping seams are not a regular manifold point. Keep the
  // result finite and symmetric by averaging every equally dominant seam.
  if (directWeight + effectiveSamples.reduce((sum, sample) => sum + sample.weight, 0) <= MIN_APERTURE_WEIGHT) {
    const strongestWeight = Math.max(...mouthSamples.map(sample => sample.weight));
    effectiveSamples = mouthSamples.map(sample => ({
      ...sample,
      weight: Math.abs(sample.weight - strongestWeight) <= MIN_APERTURE_WEIGHT ? 1 : 0,
    }));
    directWeight = 0;
  }

  let weightedPotential = directPotential * directWeight;
  let totalWeight = directWeight;
  let portalWeight = 0;
  effectiveSamples.forEach(contribution => {
    weightedPotential += contribution.potential * contribution.weight;
    totalWeight += contribution.weight;
    portalWeight += contribution.weight;
  });

  if (captureContributions) {
    contributions.push(...effectiveSamples.filter(contribution => contribution.weight > MIN_APERTURE_WEIGHT));
  }

  return {
    potential: weightedPotential / totalWeight,
    directWeight: directWeight / totalWeight,
    portalWeight: portalWeight / totalWeight,
    contributions,
  };
};

export const computePotentialAt = (
  x: number,
  y: number,
  portals: readonly Portal[],
  config: FieldConfig,
) => samplePotential({ x, y }, portals, config, false).potential;

const computeAccelerationAt = (point: Point, portals: readonly Portal[], config: FieldConfig): Point => {
  const baselineG = getBaselineG(config.vacuum, config.gravity);
  if (portals.length < 2 || baselineG === 0) {
    return { x: 0, y: baselineG };
  }

  const h = Math.max(0.05, config.derivativeStep ?? DEFAULT_FIELD_DERIVATIVE_STEP);
  const left = computePotentialAt(point.x - h, point.y, portals, config);
  const right = computePotentialAt(point.x + h, point.y, portals, config);
  const up = computePotentialAt(point.x, point.y - h, portals, config);
  const down = computePotentialAt(point.x, point.y + h, portals, config);

  return {
    x: -(right - left) / (2 * h),
    y: -(down - up) / (2 * h),
  };
};

export const sampleField = (point: Point, portals: readonly Portal[], config: FieldConfig): FieldSample => ({
  ...samplePotential(point, portals, config, true),
  acceleration: computeAccelerationAt(point, portals, config),
});

export const computeGravityAt = (
  x: number,
  y: number,
  portals: readonly Portal[],
  config: FieldConfig,
): Point => computeAccelerationAt({ x, y }, portals, config);
