import type { ExperimentDocument } from './types';

const validDimension = (value: number) => Number.isFinite(value) && value > 0;
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

/**
 * Fit a saved CSS-pixel world into a new canvas without distorting angles,
 * circles, velocities, or programmed paths. Empty margins are intentional
 * when the source and target aspect ratios differ.
 */
export const fitExperimentToWorld = (
  documentState: ExperimentDocument,
  targetWidth: number,
  targetHeight: number,
): ExperimentDocument => {
  if (!validDimension(targetWidth) || !validDimension(targetHeight)) return documentState;

  const targetWorld = { width: targetWidth, height: targetHeight };
  const source = documentState.world;
  if (!source || !validDimension(source.width) || !validDimension(source.height)) {
    return { ...documentState, world: targetWorld };
  }

  const scale = Math.min(targetWidth / source.width, targetHeight / source.height, 10);
  if (!Number.isFinite(scale) || scale <= 0) return documentState;
  const offsetX = (targetWidth - source.width * scale) / 2;
  const offsetY = (targetHeight - source.height * scale) / 2;
  const mapX = (value: number) => clamp(offsetX + value * scale, -10_000_000, 10_000_000);
  const mapY = (value: number) => clamp(offsetY + value * scale, -10_000_000, 10_000_000);

  return {
    ...documentState,
    world: targetWorld,
    config: {
      ...documentState.config,
      gravity: clamp(documentState.config.gravity * scale, -20, 20),
      gridIntensity: clamp(documentState.config.gridIntensity * scale, 0, 200),
      size: clamp(documentState.config.size * scale, 3, 200),
      portalWidth: clamp(documentState.config.portalWidth * scale, 10, 4_000),
    },
    portals: documentState.portals.map(portal => ({
      ...portal,
      x: mapX(portal.x),
      y: mapY(portal.y),
      width: clamp(portal.width * scale, 10, 4_000),
      motion: {
        ...portal.motion,
        originX: mapX(portal.motion.originX),
        originY: mapY(portal.motion.originY),
        amplitude: clamp(portal.motion.amplitude * scale, 0, 2_000),
      },
    })),
    balls: documentState.balls.map(ball => ({
      ...ball,
      x: mapX(ball.x),
      y: mapY(ball.y),
      oldX: mapX(ball.oldX),
      oldY: mapY(ball.oldY),
      vx: clamp(ball.vx * scale, -10_000_000, 10_000_000),
      vy: clamp(ball.vy * scale, -10_000_000, 10_000_000),
      radius: clamp(ball.radius * scale, 1, 1_000),
      trail: ball.trail.map(point => ({ x: mapX(point.x), y: mapY(point.y) })),
    })),
  };
};
