import { withPortalVectors, type Portal } from './types';

export type PortalMotionKind = 'static' | 'linear' | 'circular' | 'oscillate';

/**
 * Structural mirror of the laboratory motion settings. Frequencies are cycles
 * per simulation second, phases and angles are radians, and amplitudes use
 * world-space pixels (except angularAmplitude, which uses radians).
 */
export type PortalMotionSpec = {
  enabled: boolean;
  kind: PortalMotionKind;
  originX: number;
  originY: number;
  originAngle: number;
  amplitude: number;
  frequency: number;
  axisAngle: number;
  phase: number;
  angularAmplitude: number;
};

const finiteOr = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;

const rebuildPortalPose = (portal: Portal, x: number, y: number, angle: number): Portal => {
  const { dir: _dir, normal: _normal, handle: _handle, ...persistent } = portal;
  return withPortalVectors({ ...persistent, x, y, angle });
};

/** Evaluates a pose from the spec's immutable origin; prior evaluated poses are never accumulated. */
export const evaluatePortalMotion = (
  portal: Portal,
  spec: PortalMotionSpec,
  simulationTime: number,
): Portal => {
  const originX = finiteOr(spec.originX, portal.x);
  const originY = finiteOr(spec.originY, portal.y);
  const originAngle = finiteOr(spec.originAngle, portal.angle);
  const time = Math.max(0, finiteOr(simulationTime, 0));
  if (!spec.enabled || spec.kind === 'static' || time === 0) {
    return rebuildPortalPose(portal, originX, originY, originAngle);
  }

  const amplitude = finiteOr(spec.amplitude, 0);
  const phase = finiteOr(spec.phase, 0);
  const axisAngle = finiteOr(spec.axisAngle, 0);
  const angularAmplitude = finiteOr(spec.angularAmplitude, 0);
  const theta = phase + Math.PI * 2 * finiteOr(spec.frequency, 0) * time;
  const wave = Math.sin(theta) - Math.sin(phase);

  if (spec.kind === 'linear') {
    const displacement = amplitude * wave;
    return rebuildPortalPose(
      portal,
      originX + Math.cos(axisAngle) * displacement,
      originY + Math.sin(axisAngle) * displacement,
      originAngle,
    );
  }

  if (spec.kind === 'circular') {
    return rebuildPortalPose(
      portal,
      originX + amplitude * (Math.cos(theta) - Math.cos(phase)),
      originY + amplitude * (Math.sin(theta) - Math.sin(phase)),
      originAngle,
    );
  }

  const displacement = amplitude * wave;
  return rebuildPortalPose(
    portal,
    originX + Math.cos(axisAngle) * displacement,
    originY + Math.sin(axisAngle) * displacement,
    originAngle + angularAmplitude * wave,
  );
};

export const advancePortalsWithMotion = (
  portals: readonly Portal[],
  specs: Readonly<Record<string, PortalMotionSpec | undefined>>,
  simulationTime: number,
): Portal[] => portals.map(portal => {
  const spec = specs[portal.id];
  return spec ? evaluatePortalMotion(portal, spec, simulationTime) : portal;
});
