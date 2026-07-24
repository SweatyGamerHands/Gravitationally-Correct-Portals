import { createSeededRandom, type SeedInput } from './seededRandom';
import type {
  ExperimentDocument,
  LabConfig,
  PortalMotionSpec,
  SerializableBall,
  SerializablePortal,
} from './types';

export type ExperimentPreset = {
  id: string;
  title: string;
  question: string;
  description: string;
  tags: string[];
  accent: string;
  create: (width: number, height: number, seed?: SeedInput) => ExperimentDocument;
};

export const createDefaultLabConfig = (): LabConfig => ({
  gravity: 1,
  friction: 0.994,
  elasticity: 0.55,
  timeScale: 1,
  gridIntensity: 20,
  trailIntensity: 1,
  size: 15,
  mass: 20,
  substeps: 12,
  vacuum: false,
  showGrid: true,
  showFlow: false,
  showStreamlines: false,
  showHeatmap: false,
  debugOverlay: false,
  flowDensity: 15,
  flowScale: 1,
  portalWidth: 110,
  twoSided: false,
  showVelocityVectors: true,
  showAccelerationVectors: false,
  showPortalFrames: true,
  showClearance: true,
  showEnergyChart: true,
});

const staticMotion = (x: number, y: number, angle: number): PortalMotionSpec => ({
  enabled: false,
  kind: 'static',
  originX: x,
  originY: y,
  originAngle: angle,
  amplitude: 0,
  frequency: 0.25,
  axisAngle: 0,
  phase: 0,
  angularAmplitude: 0,
});

const portal = (
  id: string,
  x: number,
  y: number,
  angle: number,
  color: string,
  width: number,
  twoSided: boolean,
  motion: Partial<PortalMotionSpec> = {},
): SerializablePortal => ({
  id,
  x,
  y,
  angle,
  color,
  width,
  twoSided,
  motion: { ...staticMotion(x, y, angle), ...motion },
});

const ball = (
  id: string,
  x: number,
  y: number,
  radius = 15,
  mass = 20,
  vx = 0,
  vy = 0,
  color = '#7dd3fc',
  label = id,
): SerializableBall => ({
  id,
  label,
  x,
  y,
  oldX: x,
  oldY: y,
  vx,
  vy,
  radius,
  mass,
  cooldown: 0,
  color,
  trail: [],
});

const document = (
  id: string,
  name: string,
  question: string,
  seed: SeedInput,
  width: number,
  height: number,
  config: Partial<LabConfig>,
  portals: SerializablePortal[],
  balls: SerializableBall[],
): ExperimentDocument => ({
  version: 1,
  id,
  name,
  question,
  seed,
  simTime: 0,
  world: { width, height },
  config: { ...createDefaultLabConfig(), ...config },
  portals,
  balls,
});

const safeSize = (width: number, height: number) => ({
  w: Math.max(280, width || 800),
  h: Math.max(280, height || 600),
});

export const EXPERIMENT_PRESETS: ExperimentPreset[] = [
  {
    id: 'infinite-fall',
    title: 'Infinite fall loop',
    question: 'Does a passive portal loop create unlimited speed?',
    description: 'Drop a probe through vertically separated mouths and compare its speed and total energy on every pass.',
    tags: ['energy', 'canonical'],
    accent: '#00a2ff',
    create: (width, height, seed = 'infinite-fall') => {
      const { w, h } = safeSize(width, height);
      const cx = w / 2;
      return document('infinite-fall', 'Infinite fall loop', 'Does a passive portal loop create unlimited speed?', seed, w, h, {
        friction: 1,
        vacuum: true,
        elasticity: 0.85,
        portalWidth: Math.min(170, w * 0.3),
        showAccelerationVectors: true,
      }, [
        portal('orange', cx, h - 72, Math.PI, '#ff9d00', Math.min(170, w * 0.3), false),
        portal('blue', cx, 86, 0, '#00a2ff', Math.min(170, w * 0.3), false),
      ], [ball('probe-1', cx, 120, 12, 10, 0, 80, '#a5f3fc', 'Energy probe')]);
    },
  },
  {
    id: 'moving-launcher',
    title: 'Moving-mouth launcher',
    question: 'Where does the launch energy come from?',
    description: 'A programmed entrance sweeps across a stationary ball while the exit frame remains fixed.',
    tags: ['motion', 'work'],
    accent: '#ff9d00',
    create: (width, height, seed = 'moving-launcher') => {
      const { w, h } = safeSize(width, height);
      const entryX = Math.max(110, w * 0.23);
      const entryY = h * 0.58;
      return document('moving-launcher', 'Moving-mouth launcher', 'Where does the launch energy come from?', seed, w, h, {
        gravity: 0.25,
        friction: 1,
        vacuum: true,
        portalWidth: 125,
      }, [
        portal('orange', entryX, entryY, Math.PI / 2, '#ff9d00', 125, true, {
          enabled: true,
          kind: 'linear',
          amplitude: Math.min(105, w * 0.16),
          frequency: 0.32,
          axisAngle: 0,
        }),
        portal('blue', w * 0.76, h * 0.35, -0.4, '#00a2ff', 125, true),
      ], [ball('probe-1', entryX + 72, entryY, 14, 20, 0, 0, '#fef3c7', 'Launch probe')]);
    },
  },
  {
    id: 'rotating-exit',
    title: 'Rotating-exit slingshot',
    question: 'Can a rotating coordinate frame redirect and accelerate a probe?',
    description: 'The exit oscillates through a wide angle while a stream of probes reaches the entrance.',
    tags: ['rotation', 'frames'],
    accent: '#c084fc',
    create: (width, height, seed = 'rotating-exit') => {
      const { w, h } = safeSize(width, height);
      return document('rotating-exit', 'Rotating-exit slingshot', 'Can a rotating coordinate frame redirect and accelerate a probe?', seed, w, h, {
        gravity: 0,
        friction: 1,
        vacuum: true,
        portalWidth: 140,
        showAccelerationVectors: true,
      }, [
        portal('orange', w * 0.33, h * 0.54, Math.PI / 2, '#ff9d00', 140, true),
        portal('blue', w * 0.7, h * 0.45, -Math.PI / 2, '#00a2ff', 140, true, {
          enabled: true,
          kind: 'oscillate',
          frequency: 0.28,
          angularAmplitude: 1.15,
        }),
      ], [
        ball('probe-1', w * 0.12, h * 0.54, 11, 8, 260, 0, '#ddd6fe', 'Frame probe A'),
        ball('probe-2', w * 0.08, h * 0.63, 9, 6, 220, -20, '#e9d5ff', 'Frame probe B'),
      ]);
    },
  },
  {
    id: 'rear-plate',
    title: 'Rear-plate drop',
    question: 'What distinguishes a one-sided aperture from an ordinary wall?',
    description: 'Two identical balls approach opposite faces of the same mouth; one traverses and one meets the solid rear plate.',
    tags: ['one-sided', 'collision'],
    accent: '#f87171',
    create: (width, height, seed = 'rear-plate') => {
      const { w, h } = safeSize(width, height);
      return document('rear-plate', 'Rear-plate drop', 'What distinguishes a one-sided aperture from an ordinary wall?', seed, w, h, {
        gravity: 0,
        friction: 1,
        vacuum: true,
        portalWidth: 150,
        debugOverlay: true,
      }, [
        portal('orange', w * 0.42, h * 0.5, Math.PI / 2, '#ff9d00', 150, false),
        portal('blue', w * 0.76, h * 0.5, -Math.PI / 2, '#00a2ff', 150, false),
      ], [
        ball('front-probe', w * 0.22, h * 0.44, 13, 12, 220, 0, '#fde68a', 'Front approach'),
        ball('rear-probe', w * 0.62, h * 0.58, 13, 12, -220, 0, '#fecaca', 'Rear approach'),
      ]);
    },
  },
  {
    id: 'portal-ping-pong',
    title: 'Portal ping-pong',
    question: 'Can a probe remain trapped without gaining energy?',
    description: 'Two facing, two-sided mouths form a horizontal recurrence chamber in zero gravity.',
    tags: ['recurrence', 'vacuum'],
    accent: '#22d3ee',
    create: (width, height, seed = 'portal-ping-pong') => {
      const { w, h } = safeSize(width, height);
      return document('portal-ping-pong', 'Portal ping-pong', 'Can a probe remain trapped without gaining energy?', seed, w, h, {
        gravity: 0,
        friction: 1,
        vacuum: true,
        elasticity: 1,
        portalWidth: 170,
      }, [
        portal('orange', w * 0.2, h * 0.52, Math.PI / 2, '#ff9d00', 170, true),
        portal('blue', w * 0.8, h * 0.52, -Math.PI / 2, '#00a2ff', 170, true),
      ], [ball('probe-1', w * 0.5, h * 0.52, 12, 10, 280, 0, '#cffafe', 'Ping-pong probe')]);
    },
  },
  {
    id: 'near-rim',
    title: 'Near-rim test',
    question: 'How much clearance does a finite-size body really need?',
    description: 'Two probes differ by only a few pixels: one clears the aperture and the other strikes a solid endpoint.',
    tags: ['clearance', 'CCD'],
    accent: '#facc15',
    create: (width, height, seed = 'near-rim') => {
      const { w, h } = safeSize(width, height);
      const aperture = 130;
      const y = h * 0.58;
      return document('near-rim', 'Near-rim test', 'How much clearance does a finite-size body really need?', seed, w, h, {
        gravity: 0,
        friction: 1,
        vacuum: true,
        portalWidth: aperture,
        showClearance: true,
      }, [
        portal('orange', w * 0.42, y, 0, '#ff9d00', aperture, true),
        portal('blue', w * 0.72, h * 0.35, Math.PI, '#00a2ff', aperture, true),
      ], [
        ball('clear-probe', w * 0.42 - 34, y - 110, 14, 10, 0, 260, '#fef9c3', 'Clear path'),
        ball('rim-probe', w * 0.42 + 50, y - 110, 14, 10, 0, 260, '#fecaca', 'Rim path'),
      ]);
    },
  },
  {
    id: 'exact-clearance',
    title: 'Exact-clearance limit',
    question: 'What happens at the aperture’s exact geometric limit?',
    description: 'A large probe is configured at the full-body clearance boundary; resize either participant and repeat.',
    tags: ['tolerance', 'geometry'],
    accent: '#fb7185',
    create: (width, height, seed = 'exact-clearance') => {
      const { w, h } = safeSize(width, height);
      const radius = 28;
      const aperture = radius * 2 + 8;
      return document('exact-clearance', 'Exact-clearance limit', 'What happens at the aperture’s exact geometric limit?', seed, w, h, {
        gravity: 0.3,
        friction: 1,
        vacuum: true,
        size: radius,
        portalWidth: aperture,
        showClearance: true,
      }, [
        portal('orange', w * 0.42, h * 0.58, 0, '#ff9d00', aperture, true),
        portal('blue', w * 0.72, h * 0.34, Math.PI, '#00a2ff', aperture, true),
      ], [ball('limit-probe', w * 0.42, h * 0.22, radius, 45, 0, 70, '#fecdd3', 'Limit probe')]);
    },
  },
  {
    id: 'zero-g-transfer',
    title: 'Zero-g frame transfer',
    question: 'Can a moving pair leave world velocity unchanged?',
    description: 'Both mouths follow matched circular paths in zero gravity. Compare frame-relative and world velocity at each crossing.',
    tags: ['frames', 'zero-g'],
    accent: '#4ade80',
    create: (width, height, seed = 'zero-g-transfer') => {
      const { w, h } = safeSize(width, height);
      const common = { enabled: true, kind: 'circular' as const, amplitude: 45, frequency: 0.18, phase: 0.3 };
      return document('zero-g-transfer', 'Zero-g frame transfer', 'Can a moving pair leave world velocity unchanged?', seed, w, h, {
        gravity: 0,
        friction: 1,
        vacuum: true,
        portalWidth: 135,
      }, [
        portal('orange', w * 0.32, h * 0.55, Math.PI / 2, '#ff9d00', 135, true, common),
        portal('blue', w * 0.68, h * 0.55, -Math.PI / 2, '#00a2ff', 135, true, common),
      ], [ball('probe-1', w * 0.12, h * 0.55, 12, 10, 250, 0, '#bbf7d0', 'Matched-frame probe')]);
    },
  },
  {
    id: 'bulldozer',
    title: 'One-sided bulldozer',
    question: 'Can a closed rear plate move a pile without traversing it?',
    description: 'A one-sided mouth oscillates through a row of balls; the event log separates rear-plate pushes from traversals.',
    tags: ['motion', 'back plate'],
    accent: '#fb923c',
    create: (width, height, seed = 'bulldozer') => {
      const { w, h } = safeSize(width, height);
      const y = h * 0.63;
      return document('bulldozer', 'One-sided bulldozer', 'Can a closed rear plate move a pile without traversing it?', seed, w, h, {
        gravity: 0.6,
        friction: 0.985,
        portalWidth: 165,
      }, [
        portal('orange', w * 0.22, y, Math.PI / 2, '#ff9d00', 165, false, {
          enabled: true,
          kind: 'linear',
          amplitude: Math.min(145, w * 0.2),
          frequency: 0.2,
          axisAngle: 0,
        }),
        portal('blue', w * 0.8, h * 0.32, -Math.PI / 2, '#00a2ff', 165, false),
      ], Array.from({ length: 6 }, (_, index) => (
        ball(`pile-${index + 1}`, w * (0.43 + index * 0.055), y - 18 - (index % 2) * 32, 13, 15, 0, 0, '#fed7aa', `Pile ${index + 1}`)
      )));
    },
  },
  {
    id: 'relay-network',
    title: 'Two-pair relay',
    question: 'Can you predict a trajectory through two independent links?',
    description: 'Four mouths expose the engine’s adjacent-pair topology and make portal-history trails easy to read.',
    tags: ['multi-pair', 'trajectory'],
    accent: '#a78bfa',
    create: (width, height, seed = 'relay-network') => {
      const { w, h } = safeSize(width, height);
      return document('relay-network', 'Two-pair relay', 'Can you predict a trajectory through two independent links?', seed, w, h, {
        gravity: 0.35,
        friction: 1,
        vacuum: true,
        portalWidth: 105,
      }, [
        portal('orange-a', w * 0.3, h * 0.62, 0, '#ff9d00', 105, true),
        portal('blue-a', w * 0.58, h * 0.26, Math.PI / 2, '#00a2ff', 105, true),
        portal('violet-b', w * 0.72, h * 0.55, Math.PI / 2, '#a855f7', 105, true),
        portal('green-b', w * 0.43, h * 0.78, Math.PI, '#22c55e', 105, true),
      ], [ball('relay-probe', w * 0.3, h * 0.18, 11, 10, 0, 160, '#ede9fe', 'Relay probe')]);
    },
  },
];

const SURPRISE_QUESTIONS = [
  'Can this configuration return a probe to its starting point with a different velocity?',
  'Which event transfers the most energy, and what supplied it?',
  'Can you predict the first rim impact before pressing play?',
  'Will any probe remain trapped for ten simulated seconds?',
  'Which mouth sees the largest frame-relative crossing speed?',
  'Can you change one parameter and reverse the causal order of two events?',
];

export const createSurpriseExperiment = (
  width: number,
  height: number,
  inputSeed: SeedInput = Date.now(),
): ExperimentDocument => {
  const { w, h } = safeSize(width, height);
  const random = createSeededRandom(inputSeed);
  const pairCount = random.next() < 0.3 ? 2 : 1;
  const mouthColors = ['#ff9d00', '#00a2ff', '#a855f7', '#22c55e'];
  const portals: SerializablePortal[] = [];
  const positions: Array<{ x: number; y: number }> = [];

  for (let index = 0; index < pairCount * 2; index += 1) {
    let x = w / 2;
    let y = h / 2;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      x = random.range(90, w - 90);
      y = random.range(85, h - 85);
      if (positions.every(point => Math.hypot(x - point.x, y - point.y) > Math.min(180, w * 0.25))) break;
    }
    positions.push({ x, y });
    const angle = random.range(-Math.PI, Math.PI);
    const widthForMouth = random.range(85, 155);
    const moving = random.next() < 0.42;
    const motionKind = random.pick(['linear', 'circular', 'oscillate'] as const) ?? 'linear';
    portals.push(portal(`mouth-${index + 1}`, x, y, angle, mouthColors[index], widthForMouth, random.next() < 0.55, moving ? {
      enabled: true,
      kind: motionKind,
      amplitude: random.range(25, Math.min(90, w * 0.12)),
      frequency: random.range(0.12, 0.42),
      axisAngle: random.range(-Math.PI, Math.PI),
      phase: random.range(0, Math.PI * 2),
      angularAmplitude: random.range(0.25, 1.1),
    } : {}));
  }

  const balls: SerializableBall[] = [];
  const bodyCount = random.integer(2, 7);
  for (let index = 0; index < bodyCount; index += 1) {
    const radius = random.range(8, 21);
    let x = w / 2;
    let y = 90;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      x = random.range(radius + 12, w - radius - 12);
      y = random.range(radius + 20, h - radius - 20);
      const clearBodies = balls.every(candidate => Math.hypot(x - candidate.x, y - candidate.y) > radius + candidate.radius + 10);
      const clearMouths = portals.every(candidate => Math.hypot(x - candidate.x, y - candidate.y) > radius + 24);
      if (clearBodies && clearMouths) break;
    }
    const hue = random.integer(185, 265);
    balls.push(ball(
      `probe-${index + 1}`,
      x,
      y,
      radius,
      Math.max(4, Math.round(radius * radius * 0.07)),
      random.range(-220, 220),
      random.range(-180, 180),
      `hsl(${hue}, 88%, 72%)`,
      `Probe ${index + 1}`,
    ));
  }

  const question = random.pick(SURPRISE_QUESTIONS) ?? SURPRISE_QUESTIONS[0];
  const portalWidth = Math.round(portals.reduce((sum, item) => sum + item.width, 0) / portals.length);
  return document(`surprise-${String(inputSeed)}`, 'Seeded surprise', question, inputSeed, w, h, {
    gravity: random.range(0, 1.8),
    friction: random.range(0.985, 1),
    elasticity: random.range(0.4, 0.9),
    vacuum: random.next() < 0.45,
    portalWidth,
    showAccelerationVectors: random.next() < 0.5,
  }, portals, balls);
};
