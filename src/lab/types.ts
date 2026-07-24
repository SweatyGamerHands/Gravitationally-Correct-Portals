/** A JSON-safe two-dimensional point. */
export type SerializablePoint = {
  x: number;
  y: number;
};

/** Every simulation and visualization setting that belongs in an experiment. */
export type LabConfig = {
  gravity: number;
  friction: number;
  elasticity: number;
  timeScale: number;
  gridIntensity: number;
  trailIntensity: number;
  size: number;
  mass: number;
  substeps: number;
  vacuum: boolean;
  showGrid: boolean;
  showFlow: boolean;
  showStreamlines: boolean;
  showHeatmap: boolean;
  debugOverlay: boolean;
  flowDensity: number;
  flowScale: number;
  portalWidth: number;
  twoSided: boolean;
  showVelocityVectors: boolean;
  showAccelerationVectors: boolean;
  showPortalFrames: boolean;
  showClearance: boolean;
  showEnergyChart: boolean;
};

export type PortalMotionKind = 'static' | 'linear' | 'circular' | 'oscillate';

/** Parameters are expressed in world units, seconds, and radians. */
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

export type SerializablePortal = {
  id: string;
  x: number;
  y: number;
  angle: number;
  color: string;
  width: number;
  twoSided: boolean;
  motion: PortalMotionSpec;
};

export type SerializableBall = {
  id: string;
  label: string;
  x: number;
  y: number;
  oldX: number;
  oldY: number;
  vx: number;
  vy: number;
  radius: number;
  mass: number;
  cooldown: number;
  color: string;
  trail: SerializablePoint[];
};

export type ExperimentSeed = string | number;

/** CSS-pixel world dimensions used to make saved experiments responsive. */
export type SerializableWorld = {
  width: number;
  height: number;
};

/** Versioned, self-contained data used by snapshots, history, and share links. */
export type ExperimentDocument = {
  version: 1;
  id: string;
  name: string;
  question: string;
  seed: ExperimentSeed;
  simTime: number;
  /** Optional for backwards compatibility with early version-1 share links. */
  world?: SerializableWorld;
  config: LabConfig;
  portals: SerializablePortal[];
  balls: SerializableBall[];
};
