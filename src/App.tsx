/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Activity,
  BookOpen,
  Camera,
  Settings2,
  Trash2,
  Plus,
  Layout,
  Info,
  Wind,
  CircleDot,
  Copy,
  FlaskConical,
  Link2,
  Orbit,
  Target,
  X,
} from 'lucide-react';
import {
  FIXED_TIMESTEP,
  MAX_BALLS,
  MAX_ACCUMULATED_TIME,
  PORTAL_EDGE_RADIUS,
  computeGravityAt,
  computePotentialAt,
  findAvailableBallSpawn,
  getBaselineG,
  getPortalLocal,
  getScaledFrameDt,
  movePortalForEditor,
  resolveMovingPortalSweeps,
  advancePortalsWithMotion,
  syncPinnedBallToPointer,
  type DragState,
} from './simulation/physics';
import { Ball } from './simulation/Ball';
import { isPortalTwoSided, withPortalVectors, type Point, type Portal } from './simulation/types';
import type { PhysicsEvent } from './simulation/events';
import { rk4FieldStep } from './simulation/visualization';
import { HelpTooltip } from './components/HelpTooltip';
import { TheoryOverlay } from './components/TheoryOverlay';
import { TransportControls } from './components/TransportControls';
import { ExperimentLibrary, type ExperimentCardData } from './components/ExperimentLibrary';
import { EventLogPanel, type LabEventView } from './components/EventLogPanel';
import { EnergyChart, type EnergySample } from './components/EnergyChart';
import { SnapshotPanel, type SnapshotView } from './components/SnapshotPanel';
import {
  EXPERIMENT_PRESETS,
  createDefaultLabConfig,
  createSurpriseExperiment,
} from './lab/presets';
import {
  canRedoHistory,
  canUndoHistory,
  commitHistory,
  createHistory,
  redoHistory,
  undoHistory,
  type HistoryState,
} from './lab/history';
import {
  decodeExperimentDocument,
  encodeExperimentDocument,
  validateExperimentDocument,
} from './lab/snapshotCodec';
import { fitExperimentToWorld } from './lab/responsiveExperiment';
import type {
  ExperimentDocument,
  LabConfig,
  PortalMotionSpec,
  SerializableBall,
  SerializablePortal,
} from './lab/types';

// --- Constants & Types ---
const GRID_RES = 30;
const MAX_GRID_WARP_RADIUS = 28;
const GRID_BREAK_MULTIPLIER = 2.5;
const TIMELINE_SAMPLE_INTERVAL = 1 / 30;
const MAX_TIMELINE_FRAMES = 900;
const MAX_EVENT_LOG = 80;
const MAX_ENERGY_SAMPLES = 180;
const SNAPSHOT_STORAGE_KEY = 'portal-lab-snapshots-v1';

type Selection = { kind: 'ball' | 'portal'; id: string } | null;
type TimelineUi = { index: number; max: number };
type ObservationTab = 'inspector' | 'events' | 'energy';
type SavedSnapshot = SnapshotView & { document: ExperimentDocument };
type HistoryTransaction = {
  label: string;
  resetEnergy: boolean;
  resetTimeline: boolean;
};
type HistoryTransactionOptions = Partial<Pick<HistoryTransaction, 'resetEnergy' | 'resetTimeline'>>;

const createMotionSpec = (portal: Pick<Portal, 'x' | 'y' | 'angle'>): PortalMotionSpec => ({
  enabled: false,
  kind: 'static',
  originX: portal.x,
  originY: portal.y,
  originAngle: portal.angle,
  amplitude: 60,
  frequency: 0.25,
  axisAngle: 0,
  phase: 0,
  angularAmplitude: Math.PI / 4,
});

const rebaseMotionSpecAtPose = (
  portal: Pick<Portal, 'x' | 'y' | 'angle'>,
  spec: PortalMotionSpec,
  simulationTime: number,
): PortalMotionSpec => {
  if (!spec.enabled || spec.kind === 'static') {
    return { ...spec, originX: portal.x, originY: portal.y, originAngle: portal.angle };
  }
  const theta = spec.phase + Math.PI * 2 * spec.frequency * Math.max(0, simulationTime);
  if (spec.kind === 'circular') {
    return {
      ...spec,
      originX: portal.x - spec.amplitude * (Math.cos(theta) - Math.cos(spec.phase)),
      originY: portal.y - spec.amplitude * (Math.sin(theta) - Math.sin(spec.phase)),
      originAngle: portal.angle,
    };
  }
  const wave = Math.sin(theta) - Math.sin(spec.phase);
  const displacement = spec.amplitude * wave;
  return {
    ...spec,
    originX: portal.x - Math.cos(spec.axisAngle) * displacement,
    originY: portal.y - Math.sin(spec.axisAngle) * displacement,
    originAngle: portal.angle - (spec.kind === 'oscillate' ? spec.angularAmplitude * wave : 0),
  };
};

const cloneConfig = (config: LabConfig): LabConfig => ({ ...config });

const clampNumber = (value: number, minimum: number, maximum: number, fallback: number) => (
  Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback
);

const normalizeLabConfig = (value: LabConfig, fallback: LabConfig): LabConfig => ({
  ...value,
  gravity: clampNumber(value.gravity, -20, 20, fallback.gravity),
  friction: clampNumber(value.friction, 0, 1, fallback.friction),
  elasticity: clampNumber(value.elasticity, 0, 1.5, fallback.elasticity),
  timeScale: clampNumber(value.timeScale, 0.01, 4, fallback.timeScale),
  gridIntensity: clampNumber(value.gridIntensity, 0, 200, fallback.gridIntensity),
  trailIntensity: clampNumber(value.trailIntensity, 0, 5, fallback.trailIntensity),
  size: clampNumber(value.size, 3, 200, fallback.size),
  mass: clampNumber(value.mass, 0.1, 10_000, fallback.mass),
  substeps: Math.round(clampNumber(value.substeps, 1, 64, fallback.substeps)),
  flowDensity: Math.round(clampNumber(value.flowDensity, 4, 64, fallback.flowDensity)),
  flowScale: clampNumber(value.flowScale, 0.05, 10, fallback.flowScale),
  portalWidth: clampNumber(value.portalWidth, 10, 4_000, fallback.portalWidth),
});

const normalizeMotionSpec = (value: PortalMotionSpec, fallback: PortalMotionSpec): PortalMotionSpec => ({
  ...value,
  originX: clampNumber(value.originX, -10_000_000, 10_000_000, fallback.originX),
  originY: clampNumber(value.originY, -10_000_000, 10_000_000, fallback.originY),
  originAngle: clampNumber(value.originAngle, -1_000_000, 1_000_000, fallback.originAngle),
  amplitude: clampNumber(value.amplitude, 0, 2_000, fallback.amplitude),
  frequency: clampNumber(value.frequency, 0, 20, fallback.frequency),
  axisAngle: clampNumber(value.axisAngle, -1_000_000, 1_000_000, fallback.axisAngle),
  phase: clampNumber(value.phase, -1_000_000, 1_000_000, fallback.phase),
  angularAmplitude: clampNumber(value.angularAmplitude, 0, Math.PI * 4, fallback.angularAmplitude),
});

const experimentDocumentsEqual = (left: ExperimentDocument, right: ExperimentDocument) => (
  JSON.stringify(left) === JSON.stringify(right)
);

const serializeBall = (body: Ball, includeTrail = true): SerializableBall => ({
  id: body.id,
  label: body.label,
  x: body.x,
  y: body.y,
  oldX: body.oldX,
  oldY: body.oldY,
  vx: body.vx,
  vy: body.vy,
  radius: body.radius,
  mass: body.mass,
  cooldown: body.cooldown,
  color: body.color,
  trail: includeTrail ? body.trail.map(point => ({ ...point })) : [],
});

const hydrateBall = (state: SerializableBall): Ball => {
  const body = new Ball(state.x, state.y, state.radius, state.mass, state.id, state.label);
  body.oldX = state.oldX;
  body.oldY = state.oldY;
  body.vx = state.vx;
  body.vy = state.vy;
  body.cooldown = state.cooldown;
  body.color = state.color;
  body.trail = state.trail.map(point => ({ ...point }));
  body.trailSampleElapsed = 0;
  return body;
};

const hydratePortal = (state: SerializablePortal): Portal => withPortalVectors({
  id: state.id,
  x: state.x,
  y: state.y,
  angle: state.angle,
  color: state.color,
  width: state.width,
  twoSided: state.twoSided,
});

const physicsEventTone = (event: PhysicsEvent): LabEventView['tone'] => {
  if (event.type === 'traversal') return 'portal';
  if (event.type === 'back-plate-impact') return 'warning';
  return 'danger';
};

const physicsEventTitle = (event: PhysicsEvent) => {
  if (event.type === 'traversal') return `${event.bodyId} crossed ${event.portalIds.entry}`;
  if (event.type === 'back-plate-impact') return `${event.bodyId} met a rear plate`;
  return `${event.bodyId} struck a rim`;
};

const formatSpeed = (speed: number) => `${speed.toFixed(1)} px/s`;

// --- Main Component ---
export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const objectsRef = useRef<Ball[]>([]);
  const [entityCount, setEntityCount] = useState(0);
  const [portals, setPortals] = useState<Portal[]>([]);
  const [fps, setFps] = useState(0);
  const [config, setConfig] = useState<LabConfig>(() => createDefaultLabConfig());
  const configRef = useRef(config);
  const portalsRef = useRef(portals);
  const motionSpecsRef = useRef<Record<string, PortalMotionSpec>>({});
  const simTimeRef = useRef(0);
  const playingRef = useRef(true);
  const timelineFramesRef = useRef<ExperimentDocument[]>([]);
  const timelineCursorRef = useRef(0);
  const lastTimelineCaptureRef = useRef(0);
  const historyRef = useRef<HistoryState<ExperimentDocument> | null>(null);
  const historyTransactionRef = useRef<HistoryTransaction | null>(null);
  const experimentMetaRef = useRef({ id: 'custom', name: 'Untitled experiment', question: 'What will happen next?', seed: 'default' as string | number });
  const lastEnergySampleRef = useRef(-Infinity);
  const energyBaselineRef = useRef<number | null>(null);
  const lastEventKeyRef = useRef({ key: '', time: -Infinity });
  const eventOrdinalRef = useRef(1);
  const eventMarkersRef = useRef<Array<{ x: number; y: number; type: PhysicsEvent['type']; expiresAt: number }>>([]);
  const lastPortalUiSyncRef = useRef(-Infinity);
  const lastTimeUiSyncRef = useRef(-Infinity);
  const ballOrdinalRef = useRef(2);
  const portalPairOrdinalRef = useRef(2);

  const [playing, setPlaying] = useState(true);
  const [simTime, setSimTime] = useState(0);
  const [timelineUi, setTimelineUi] = useState<TimelineUi>({ index: 0, max: 0 });
  const [historyUi, setHistoryUi] = useState({ canUndo: false, canRedo: false });
  const [selection, setSelection] = useState<Selection>(null);
  const [observationTab, setObservationTab] = useState<ObservationTab>('inspector');
  const [events, setEvents] = useState<LabEventView[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [energySamples, setEnergySamples] = useState<EnergySample[]>([]);
  const [energyNow, setEnergyNow] = useState({ kinetic: 0, potential: 0, total: 0, drift: 0 });
  const [actuatorWork, setActuatorWork] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const [showExperiments, setShowExperiments] = useState(false);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [inspectorTick, setInspectorTick] = useState(0);
  const [savedSnapshots, setSavedSnapshots] = useState<SavedSnapshot[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(SNAPSHOT_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as Array<Partial<SavedSnapshot>>;
      return parsed.flatMap(item => {
        const validated = validateExperimentDocument(item.document);
        if (!validated.ok || typeof item.id !== 'string' || typeof item.name !== 'string') return [];
        return [{
          id: item.id,
          name: item.name,
          createdAt: typeof item.createdAt === 'number' || typeof item.createdAt === 'string' ? item.createdAt : Date.now(),
          document: validated.value,
        }];
      });
    } catch {
      return [];
    }
  });

  const [layoutIdx, setLayoutIdx] = useState(2);
  
  const dragStateRef = useRef<DragState>({ id: null, type: null });
  const updateDragState = useCallback((nextDragState: DragState) => {
    dragStateRef.current = nextDragState;
  }, []);
  const lastPos = useRef({ x: 0, y: 0 });
  const activePointerId = useRef<number | null>(null);
  const lastPortalMotionTimestamp = useRef<number | null>(null);
  const frameCount = useRef(0);
  const lastTime = useRef(performance.now());
  const prevTime = useRef(performance.now());
  const accumulatorRef = useRef(0);
  const initializedRef = useRef(false);
  const canvasSizeRef = useRef({ width: 0, height: 0 });
  const initialPortalWidthRef = useRef(config.portalWidth);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(savedSnapshots));
    } catch {
      setToast('Snapshot storage is full or unavailable');
    }
  }, [savedSnapshots]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const captureExperiment = useCallback((includeTrail = true): ExperimentDocument => {
    const meta = experimentMetaRef.current;
    const world = canvasSizeRef.current;
    return {
      version: 1,
      id: meta.id,
      name: meta.name,
      question: meta.question,
      seed: meta.seed,
      simTime: simTimeRef.current,
      world: {
        width: world.width > 0 ? world.width : 800,
        height: world.height > 0 ? world.height : 600,
      },
      config: cloneConfig(configRef.current),
      portals: portalsRef.current.map(portalState => ({
        id: portalState.id,
        x: portalState.x,
        y: portalState.y,
        angle: portalState.angle,
        color: portalState.color,
        width: portalState.width,
        twoSided: isPortalTwoSided(portalState, configRef.current.twoSided),
        motion: { ...(motionSpecsRef.current[portalState.id] ?? createMotionSpec(portalState)) },
      })),
      balls: objectsRef.current.map(body => serializeBall(body, includeTrail)),
    };
  }, []);

  const syncHistoryUi = useCallback(() => {
    const history = historyRef.current;
    setHistoryUi(history
      ? { canUndo: canUndoHistory(history), canRedo: canRedoHistory(history) }
      : { canUndo: false, canRedo: false });
  }, []);

  const applyExperimentDocument = useCallback((documentState: ExperimentDocument, clearAnalysis = true) => {
    const currentWorld = canvasSizeRef.current;
    const fittedDocument = fitExperimentToWorld(
      documentState,
      currentWorld.width || documentState.world?.width || 800,
      currentWorld.height || documentState.world?.height || 600,
    );
    const nextPortals = fittedDocument.portals.map(hydratePortal);
    const nextBalls = fittedDocument.balls.map(hydrateBall);
    const nextMotions = Object.fromEntries(fittedDocument.portals.map(portalState => [
      portalState.id,
      { ...portalState.motion },
    ]));

    objectsRef.current = nextBalls;
    portalsRef.current = nextPortals;
    motionSpecsRef.current = nextMotions;
    configRef.current = cloneConfig(fittedDocument.config);
    simTimeRef.current = fittedDocument.simTime;
    experimentMetaRef.current = {
      id: fittedDocument.id,
      name: fittedDocument.name,
      question: fittedDocument.question,
      seed: fittedDocument.seed,
    };
    accumulatorRef.current = 0;
    lastTimelineCaptureRef.current = fittedDocument.simTime;
    lastTimeUiSyncRef.current = fittedDocument.simTime;
    lastPortalUiSyncRef.current = fittedDocument.simTime;
    lastEventKeyRef.current = { key: '', time: -Infinity };
    eventMarkersRef.current = [];

    const highestBallOrdinal = nextBalls.reduce((highest, body) => {
      const match = /^ball-(\d+)$/.exec(body.id);
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0);
    const highestPairOrdinal = nextPortals.reduce((highest, portalState) => {
      const match = /^pair-(\d+)-[ab]$/.exec(portalState.id);
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0);
    ballOrdinalRef.current = Math.max(ballOrdinalRef.current, highestBallOrdinal + 1);
    portalPairOrdinalRef.current = Math.max(portalPairOrdinalRef.current, highestPairOrdinal + 1);

    setEntityCount(nextBalls.length);
    setPortals(nextPortals);
    setConfig(cloneConfig(fittedDocument.config));
    setSimTime(fittedDocument.simTime);
    setSelection(null);
    if (clearAnalysis) {
      setEvents([]);
      setSelectedEventId(null);
      setEnergySamples([]);
      setEnergyNow({ kinetic: 0, potential: 0, total: 0, drift: 0 });
      setActuatorWork(0);
      energyBaselineRef.current = null;
      lastEnergySampleRef.current = -Infinity;
      eventOrdinalRef.current = 1;
    }
    setInspectorTick(value => value + 1);
  }, []);

  const resetTimelineFromCurrent = useCallback(() => {
    const frame = captureExperiment(false);
    timelineFramesRef.current = [frame];
    timelineCursorRef.current = 0;
    lastTimelineCaptureRef.current = frame.simTime;
    setTimelineUi({ index: 0, max: 0 });
  }, [captureExperiment]);

  const branchTimelineFromCurrent = useCallback(() => {
    const frames = timelineFramesRef.current;
    if (timelineCursorRef.current < frames.length - 1) {
      frames.splice(timelineCursorRef.current + 1);
    }
    frames.push(captureExperiment(false));
    if (frames.length > MAX_TIMELINE_FRAMES) frames.shift();
    timelineCursorRef.current = frames.length - 1;
    lastTimelineCaptureRef.current = simTimeRef.current;
    setTimelineUi({ index: timelineCursorRef.current, max: frames.length - 1 });
  }, [captureExperiment]);

  const commitHistoryCurrent = useCallback(() => {
    const current = captureExperiment(false);
    historyRef.current = historyRef.current
      ? commitHistory(historyRef.current, current, experimentDocumentsEqual)
      : createHistory(current);
    syncHistoryUi();
  }, [captureExperiment, syncHistoryUi]);

  const beginHistoryTransaction = useCallback((label: string, options: HistoryTransactionOptions = {}) => {
    if (historyTransactionRef.current) return;
    const transaction: HistoryTransaction = {
      label,
      resetEnergy: options.resetEnergy ?? true,
      resetTimeline: options.resetTimeline ?? true,
    };
    historyTransactionRef.current = transaction;
    commitHistoryCurrent();
    if (transaction.resetEnergy) {
      energyBaselineRef.current = null;
      lastEnergySampleRef.current = -Infinity;
      setEnergySamples([]);
      setActuatorWork(0);
    }
  }, [commitHistoryCurrent]);

  const finishHistoryTransaction = useCallback(() => {
    const transaction = historyTransactionRef.current;
    if (!transaction) return;
    historyTransactionRef.current = null;
    commitHistoryCurrent();
    if (transaction.resetTimeline) branchTimelineFromCurrent();
    if (transaction.resetEnergy) {
      let kinetic = 0;
      let potential = 0;
      for (const body of objectsRef.current) {
        kinetic += 0.5 * body.mass * (body.vx ** 2 + body.vy ** 2);
        potential += body.mass * computePotentialAt(body.x, body.y, portalsRef.current, configRef.current);
      }
      const total = kinetic + potential;
      energyBaselineRef.current = total;
      lastEnergySampleRef.current = simTimeRef.current;
      setEnergyNow({ kinetic, potential, total, drift: 0 });
      setEnergySamples([{ time: simTimeRef.current, kinetic, potential, total }]);
    }
  }, [branchTimelineFromCurrent, commitHistoryCurrent]);

  const updateConfig = useCallback((patch: Partial<LabConfig>) => {
    const current = configRef.current;
    const next = normalizeLabConfig({ ...current, ...patch }, current);
    configRef.current = next;
    setConfig(next);
  }, []);

  const undo = useCallback(() => {
    if (historyTransactionRef.current) {
      historyTransactionRef.current = null;
      commitHistoryCurrent();
    }
    activePointerId.current = null;
    dragStateRef.current = { id: null, type: null };
    lastPortalMotionTimestamp.current = null;
    const history = historyRef.current;
    if (!history || !canUndoHistory(history)) return;
    const next = undoHistory(history);
    historyRef.current = next;
    applyExperimentDocument(next.present);
    resetTimelineFromCurrent();
    syncHistoryUi();
    setToast('Edit undone');
  }, [applyExperimentDocument, commitHistoryCurrent, resetTimelineFromCurrent, syncHistoryUi]);

  const redo = useCallback(() => {
    if (historyTransactionRef.current) {
      historyTransactionRef.current = null;
      commitHistoryCurrent();
    }
    activePointerId.current = null;
    dragStateRef.current = { id: null, type: null };
    lastPortalMotionTimestamp.current = null;
    const history = historyRef.current;
    if (!history || !canRedoHistory(history)) return;
    const next = redoHistory(history);
    historyRef.current = next;
    applyExperimentDocument(next.present);
    resetTimelineFromCurrent();
    syncHistoryUi();
    setToast('Edit restored');
  }, [applyExperimentDocument, commitHistoryCurrent, resetTimelineFromCurrent, syncHistoryUi]);

  const initializeScene = useCallback((width: number, height: number) => {
    // Mark initialization synchronously before mutating refs or scheduling React state.
    initializedRef.current = true;

    const cx = width / 2;
    const cy = height / 2;
    const initialPortals: Portal[] = [
      withPortalVectors({ id: 'orange', x: cx - width * 0.15, y: cy + height * 0.1, angle: -0.6, color: '#ff9d00', width: initialPortalWidthRef.current, twoSided: false }),
      withPortalVectors({ id: 'blue', x: cx + width * 0.15, y: cy - height * 0.1, angle: 2.5, color: '#00a2ff', width: initialPortalWidthRef.current, twoSided: false }),
    ];

    const initializedPortals = initialPortals;
    objectsRef.current = [new Ball(width / 2, 100, 15, 20, 'ball-1', 'Probe 1')];
    portalsRef.current = initializedPortals;
    motionSpecsRef.current = Object.fromEntries(initializedPortals.map(portalState => [portalState.id, createMotionSpec(portalState)]));
    experimentMetaRef.current = {
      id: 'custom',
      name: 'Untitled experiment',
      question: 'What will happen next?',
      seed: 'default',
    };
    setEntityCount(objectsRef.current.length);
    setPortals(initializedPortals);

    const encoded = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('experiment');
    if (encoded) {
      const decoded = decodeExperimentDocument(encoded);
      if (decoded.ok) {
        applyExperimentDocument(decoded.value);
        setToast(`Loaded shared experiment: ${decoded.value.name}`);
      } else {
        setToast('The shared experiment link is invalid');
      }
    }

    const initialDocument = captureExperiment(false);
    historyRef.current = createHistory(initialDocument);
    syncHistoryUi();
    resetTimelineFromCurrent();
  }, [applyExperimentDocument, captureExperiment, resetTimelineFromCurrent, syncHistoryUi]);

  const isReadyForInitialScene = useCallback((width: number, height: number) => {
    return (
      !initializedRef.current &&
      width > 0 &&
      height > 0 &&
      objectsRef.current.length === 0
    );
  }, []);

  // ResizeObserver owns canvas sizing and proportional scene scaling only.
  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const canvas = canvasRef.current;
        if (!canvas) return;

        if (width <= 0 || height <= 0) continue;

        const previousSize = canvasSizeRef.current;
        const hasPreviousSize = previousSize.width > 0 && previousSize.height > 0;
        const scaleX = hasPreviousSize ? width / previousSize.width : 1;
        const scaleY = hasPreviousSize ? height / previousSize.height : 1;
        const uniformScale = Math.min(scaleX, scaleY);
        const offsetX = hasPreviousSize ? (width - previousSize.width * uniformScale) / 2 : 0;
        const offsetY = hasPreviousSize ? (height - previousSize.height * uniformScale) / 2 : 0;
        const mapX = (value: number) => offsetX + value * uniformScale;
        const mapY = (value: number) => offsetY + value * uniformScale;
        const isRealSizeChange = !hasPreviousSize || Math.abs(scaleX - 1) >= 1e-6 || Math.abs(scaleY - 1) >= 1e-6;

        const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        const resizeCtx = canvas.getContext('2d');
        resizeCtx?.setTransform(dpr, 0, 0, dpr, 0, 0);
        canvasSizeRef.current = { width, height };

        if (initializedRef.current && hasPreviousSize && isRealSizeChange) {
          const updatedPortals = portalsRef.current.map(portal => withPortalVectors({
            ...portal,
            x: mapX(portal.x),
            y: mapY(portal.y),
            width: Math.max(10, Math.min(4_000, portal.width * uniformScale)),
          }));
          portalsRef.current = updatedPortals;
          setPortals(updatedPortals);

          motionSpecsRef.current = Object.fromEntries((Object.entries(motionSpecsRef.current) as Array<[string, PortalMotionSpec]>).map(([id, motionSpec]) => [
            id,
            {
              ...motionSpec,
              originX: mapX(motionSpec.originX),
              originY: mapY(motionSpec.originY),
              amplitude: Math.max(0, Math.min(2_000, motionSpec.amplitude * uniformScale)),
            },
          ]));

          if (dragStateRef.current.type !== 'ball') {
            objectsRef.current.forEach(obj => {
              obj.x = mapX(obj.x);
              obj.y = mapY(obj.y);
              obj.oldX = mapX(obj.oldX);
              obj.oldY = mapY(obj.oldY);
              obj.vx *= uniformScale;
              obj.vy *= uniformScale;
              obj.radius = Math.max(1, Math.min(1_000, obj.radius * uniformScale));
              obj.trail = obj.trail.map(point => ({ x: mapX(point.x), y: mapY(point.y) }));
            });
          }

          const resizedConfig = normalizeLabConfig({
            ...configRef.current,
            gravity: configRef.current.gravity * uniformScale,
            gridIntensity: configRef.current.gridIntensity * uniformScale,
            size: configRef.current.size * uniformScale,
            portalWidth: configRef.current.portalWidth * uniformScale,
          }, configRef.current);
          configRef.current = resizedConfig;
          setConfig(resizedConfig);
          lastPos.current = { x: mapX(lastPos.current.x), y: mapY(lastPos.current.y) };
        }

        if (isReadyForInitialScene(width, height)) {
          if (dragStateRef.current.type !== null) return;
          initializeScene(width, height);
        }
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [initializeScene, isReadyForInitialScene]);

  const getGravityAt = useCallback((x: number, y: number, currentPortals: Portal[]) => {
    return computeGravityAt(x, y, currentPortals, configRef.current);
  }, []);

  const drawGrid = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number, currentPortals: Portal[]) => {
    const config = configRef.current;

    ctx.strokeStyle = 'rgba(0, 162, 255, 0.08)';
    ctx.lineWidth = 1;
    const stepX = w / GRID_RES;
    const stepY = h / GRID_RES;
    const currentBaseG = getBaselineG(config.vacuum, config.gravity);
    const safeBaseG = Math.max(Math.abs(currentBaseG), 1);
    const warpScale = config.gridIntensity * 10;

    const getWarpedGridPoint = (x: number, y: number): Point => {
      const g = getGravityAt(x, y, currentPortals);
      const deltaG = { x: g.x, y: g.y - currentBaseG };
      let offsetX = (deltaG.x / safeBaseG) * warpScale;
      let offsetY = (deltaG.y / safeBaseG) * warpScale;
      const offsetMag = Math.hypot(offsetX, offsetY);

      if (offsetMag > MAX_GRID_WARP_RADIUS) {
        const clampScale = MAX_GRID_WARP_RADIUS / offsetMag;
        offsetX *= clampScale;
        offsetY *= clampScale;
      }

      return { x: x + offsetX, y: y + offsetY };
    };

    const drawWarpedPolyline = (points: Point[], expectedStep: number) => {
      const breakThreshold = Math.max(
        expectedStep * GRID_BREAK_MULTIPLIER,
        expectedStep + MAX_GRID_WARP_RADIUS * 1.75,
      );

      ctx.beginPath();
      points.forEach((point, index) => {
        if (index === 0) {
          ctx.moveTo(point.x, point.y);
          return;
        }

        const prev = points[index - 1];
        const warpedStep = Math.hypot(point.x - prev.x, point.y - prev.y);
        if (warpedStep > breakThreshold) {
          ctx.moveTo(point.x, point.y);
        } else {
          ctx.lineTo(point.x, point.y);
        }
      });
      ctx.stroke();
    };

    for (let i = 0; i <= GRID_RES; i++) {
      const points: Point[] = [];
      for (let j = 0; j <= GRID_RES; j++) {
        points.push(getWarpedGridPoint(i * stepX, j * stepY));
      }
      drawWarpedPolyline(points, stepY);
    }

    for (let j = 0; j <= GRID_RES; j++) {
      const points: Point[] = [];
      for (let i = 0; i <= GRID_RES; i++) {
        points.push(getWarpedGridPoint(i * stepX, j * stepY));
      }
      drawWarpedPolyline(points, stepX);
    }
  }, [getGravityAt]);
  
  const drawFlow = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number, currentPortals: Portal[]) => {
    const config = configRef.current;
    const res = config.flowDensity;
    const stepX = w / res;
    const stepY = h / res;
    const currentBaseG = getBaselineG(config.vacuum, config.gravity) || 1;
    
    ctx.lineWidth = 1;
    
    for (let i = 0; i <= res; i++) {
      for (let j = 0; j <= res; j++) {
        const x = i * stepX;
        const y = j * stepY;
        const g = getGravityAt(x, y, currentPortals);
        
        const mag = Math.sqrt(g.x * g.x + g.y * g.y);
        // Exclude microscopic FP floats
        if (mag < 10) continue;
        
        const dirX = g.x / mag;
        const dirY = g.y / mag;
        
        // Exact Physical Magnitude ratio relative to baseline gravity
        const visualMagRatio = mag / currentBaseG;
        
        // Render exact directional angle. The length acts as a scaled visualization multiplier only.
        const len = Math.min(stepX, stepY) * 0.4 * config.flowScale * visualMagRatio;
        
        const endX = x + dirX * len;
        const endY = y + dirY * len;
        
        const opacity = Math.min(0.6, visualMagRatio * 1.5);
        if (visualMagRatio > 1.2) {
          ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
          ctx.shadowBlur = 4;
          ctx.shadowColor = 'white';
        } else if (visualMagRatio > 0.4) {
          ctx.strokeStyle = `rgba(0, 162, 255, ${opacity})`;
          ctx.shadowBlur = 0;
        } else {
          ctx.strokeStyle = `rgba(0, 162, 255, ${opacity * 0.5})`;
          ctx.shadowBlur = 0;
        }
        
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(endX, endY);
        
        const arrowSize = 4 * config.flowScale;
        const ang = Math.atan2(dirY, dirX);
        ctx.lineTo(
          endX - arrowSize * Math.cos(ang - Math.PI/6),
          endY - arrowSize * Math.sin(ang - Math.PI/6)
        );
        ctx.moveTo(endX, endY);
        ctx.lineTo(
          endX - arrowSize * Math.cos(ang + Math.PI/6),
          endY - arrowSize * Math.sin(ang + Math.PI/6)
        );
        ctx.stroke();
      }
    }
  }, [getGravityAt]);


  const drawHeatmap = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number, currentPortals: Portal[]) => {
    const step = Math.max(36, Math.min(70, Math.round(Math.min(w, h) / 8)));
    const base = Math.max(1, Math.abs(getBaselineG(configRef.current.vacuum, configRef.current.gravity)));
    ctx.save();
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const g = getGravityAt(x + step / 2, y + step / 2, currentPortals);
        const deviation = Math.min(1, Math.hypot(g.x, g.y - base) / base);
        if (deviation < 0.03) continue;
        ctx.fillStyle = `rgba(255, 157, 0, ${deviation * 0.16})`;
        ctx.fillRect(x, y, step + 1, step + 1);
      }
    }
    ctx.restore();
  }, [getGravityAt]);

  const drawStreamlines = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number, currentPortals: Portal[]) => {
    const seeds: Point[] = [];
    currentPortals.forEach(portal => {
      for (let i = -2; i <= 2; i++) seeds.push({ x: portal.x + portal.dir.x * (i * portal.width / 5) + portal.normal.x * 18, y: portal.y + portal.dir.y * (i * portal.width / 5) + portal.normal.y * 18 });
    });
    for (let x = w * 0.15; x <= w * 0.85; x += Math.max(120, w / 5)) seeds.push({ x, y: h * 0.15 });
    ctx.save();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = 'rgba(0, 255, 210, 0.28)';
    for (const seed of seeds) {
      let p = seed;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      for (let i = 0; i < 42; i++) {
        p = rk4FieldStep(p, 10, currentPortals, configRef.current);
        if (p.x < 0 || p.y < 0 || p.x > w || p.y > h) break;
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }, []);

  const drawDebugOverlay = useCallback((ctx: CanvasRenderingContext2D, currentPortals: Portal[]) => {
    ctx.save();
    ctx.lineWidth = 2;
    currentPortals.forEach(portal => {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath(); ctx.moveTo(portal.x, portal.y); ctx.lineTo(portal.x + portal.dir.x * 55, portal.y + portal.dir.y * 55); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,157,0,0.65)';
      ctx.beginPath(); ctx.moveTo(portal.x, portal.y); ctx.lineTo(portal.x + portal.normal.x * 55, portal.y + portal.normal.y * 55); ctx.stroke();
      const g = getGravityAt(portal.x + portal.normal.x * 22, portal.y + portal.normal.y * 22, currentPortals);
      ctx.strokeStyle = portal.color; ctx.beginPath(); ctx.moveTo(portal.x, portal.y); ctx.lineTo(portal.x + g.x * 0.04, portal.y + g.y * 0.04); ctx.stroke();
    });
    ctx.restore();
  }, [getGravityAt]);

  const drawObservationOverlay = useCallback((
    ctx: CanvasRenderingContext2D,
    currentPortals: Portal[],
    currentObjects: Ball[],
  ) => {
    const currentConfig = configRef.current;
    const drawArrow = (origin: Point, vector: Point, scale: number, color: string, label: string) => {
      const length = Math.hypot(vector.x, vector.y) * scale;
      if (!Number.isFinite(length) || length < 1) return;
      const clampedLength = Math.min(130, Math.max(8, length));
      const angle = Math.atan2(vector.y, vector.x);
      const end = { x: origin.x + Math.cos(angle) * clampedLength, y: origin.y + Math.sin(angle) * clampedLength };
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(end.x - 7 * Math.cos(angle - Math.PI / 6), end.y - 7 * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(end.x - 7 * Math.cos(angle + Math.PI / 6), end.y - 7 * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
      ctx.font = '9px ui-monospace, SFMono-Regular, monospace';
      ctx.fillText(label, end.x + 5, end.y - 5);
    };

    ctx.save();
    if (currentConfig.showPortalFrames) {
      currentPortals.forEach((portalState, index) => {
        ctx.globalAlpha = selection?.kind === 'portal' && selection.id !== portalState.id ? 0.28 : 0.72;
        drawArrow(portalState, { x: portalState.dir.x * 55, y: portalState.dir.y * 55 }, 1, 'rgba(255,255,255,0.7)', `t${index + 1}`);
        drawArrow(portalState, { x: portalState.normal.x * 48, y: portalState.normal.y * 48 }, 1, portalState.color, `n${index + 1}`);
      });
      ctx.globalAlpha = 1;
    }

    currentObjects.forEach(body => {
      if (currentConfig.showVelocityVectors) {
        drawArrow(body, { x: body.vx, y: body.vy }, 0.12, '#67e8f9', `v ${Math.hypot(body.vx, body.vy).toFixed(0)}`);
      }
      if (currentConfig.showAccelerationVectors) {
        const acceleration = getGravityAt(body.x, body.y, currentPortals);
        drawArrow(body, acceleration, 0.05, '#fbbf24', `a ${Math.hypot(acceleration.x, acceleration.y).toFixed(0)}`);
      }
      if (selection?.kind === 'ball' && selection.id === body.id) {
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(body.x, body.y, body.radius + 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });

    if (selection?.kind === 'portal') {
      const selectedPortal = currentPortals.find(portalState => portalState.id === selection.id);
      if (selectedPortal) {
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(selectedPortal.x, selectedPortal.y, Math.max(28, selectedPortal.width / 2 + 14), 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    if (currentConfig.showClearance && selection?.kind === 'ball') {
      const selectedBall = currentObjects.find(body => body.id === selection.id);
      if (selectedBall) {
        currentPortals.forEach(portalState => {
          const usable = portalState.width / 2 - selectedBall.radius - PORTAL_EDGE_RADIUS;
          const clears = usable >= 0;
          ctx.strokeStyle = clears ? 'rgba(52,211,153,0.75)' : 'rgba(248,113,113,0.8)';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(portalState.x - portalState.dir.x * Math.max(0, usable), portalState.y - portalState.dir.y * Math.max(0, usable));
          ctx.lineTo(portalState.x + portalState.dir.x * Math.max(0, usable), portalState.y + portalState.dir.y * Math.max(0, usable));
          ctx.stroke();
          ctx.fillStyle = clears ? '#6ee7b7' : '#fca5a5';
          ctx.font = 'bold 9px ui-monospace, SFMono-Regular, monospace';
          ctx.fillText(clears ? `${(usable * 2).toFixed(0)} px clear` : 'NO CLEARANCE', portalState.x + 8, portalState.y - 12);
        });
      }
    }

    eventMarkersRef.current = eventMarkersRef.current.filter(marker => marker.expiresAt > simTimeRef.current);
    eventMarkersRef.current.forEach(marker => {
      const remaining = Math.max(0, marker.expiresAt - simTimeRef.current) / 1.2;
      ctx.globalAlpha = remaining;
      ctx.strokeStyle = marker.type === 'traversal' ? '#00a2ff' : marker.type === 'rim-impact' ? '#f87171' : '#ff9d00';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(marker.x, marker.y, 7 + (1 - remaining) * 14, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.restore();
  }, [getGravityAt, selection]);

  const resolveCollisions = useCallback((balls: Ball[], bounce: number, pinnedIdx: number = -1) => {
    for (let i = 0; i < balls.length; i++) {
      const b1 = balls[i];
      const isPinned1 = i === pinnedIdx;
      
      for (let j = i + 1; j < balls.length; j++) {
        const b2 = balls[j];
        const isPinned2 = j === pinnedIdx;
        
        const dx = b2.x - b1.x;
        const dy = b2.y - b1.y;
        const distSq = dx * dx + dy * dy;
        const minDist = b1.radius + b2.radius;

        if (distSq < minDist * minDist) {
          const coincident = distSq <= 1e-12;
          const dist = coincident ? 0 : Math.sqrt(distSq);
          const overlap = (minDist - dist);
          const direction = (i + j) % 2 === 0 ? 1 : -1;
          const nx = coincident ? direction : dx / dist;
          const ny = coincident ? 0 : dy / dist;
          
          let w1, w2;
          if (isPinned1 && !isPinned2) { w1 = 0; w2 = 1; }
          else if (!isPinned1 && isPinned2) { w1 = 1; w2 = 0; }
          else {
            const mTotal = b1.mass + b2.mass;
            w1 = b2.mass / mTotal;
            w2 = b1.mass / mTotal;
          }
          
          const posCorrectionX = nx * overlap;
          const posCorrectionY = ny * overlap;

          // 1. Pure Positional Correction
          b1.x -= posCorrectionX * w1;
          b1.y -= posCorrectionY * w1;
          b2.x += posCorrectionX * w2;
          b2.y += posCorrectionY * w2;
          
          // 2. Re-anchor previous positions after positional correction; momentum lives in px/sec.
          b1.oldX = b1.x;
          b1.oldY = b1.y;
          b2.oldX = b2.x;
          b2.oldY = b2.y;
          
          // 3. Explicit physical collision response using px/sec velocity restitution.
          const rVx = b1.vx - b2.vx;
          const rVy = b1.vy - b2.vy;
          const relVelDist = rVx * nx + rVy * ny;
          
          // Objects are strictly approaching each other
          if (relVelDist > 0) {
              const impulse = (1 + bounce) * relVelDist;
              b1.vx -= impulse * nx * w1;
              b1.vy -= impulse * ny * w1;
              b2.vx += impulse * nx * w2;
              b2.vy += impulse * ny * w2;
          }
        }
      }
    }
  }, []);

  const emitPhysicsEvent = useCallback((event: PhysicsEvent) => {
    const now = simTimeRef.current;
    if (event.explanation.facts.movingPortal === true) {
      const body = objectsRef.current.find(candidate => candidate.id === event.bodyId);
      const mass = body?.mass ?? 1;
      const kineticDelta = 0.5 * mass * (event.afterSpeed ** 2 - event.beforeSpeed ** 2);
      if (Number.isFinite(kineticDelta)) setActuatorWork(value => value + kineticDelta);
    }

    const key = `${event.type}:${event.bodyId}:${event.portalIds.entry}`;
    if (lastEventKeyRef.current.key === key && now - lastEventKeyRef.current.time < 0.08) return;
    lastEventKeyRef.current = { key, time: now };

    const delta = event.afterSpeed - event.beforeSpeed;
    const view: LabEventView = {
      id: `event-${eventOrdinalRef.current++}`,
      time: now,
      kind: event.type.replaceAll('-', ' '),
      title: physicsEventTitle(event),
      summary: `${formatSpeed(event.beforeSpeed)} → ${formatSpeed(event.afterSpeed)} (${delta >= 0 ? '+' : ''}${delta.toFixed(1)} px/s)`,
      explanation: event.explanation.message,
      tone: physicsEventTone(event),
    };
    setEvents(previous => [...previous.slice(-(MAX_EVENT_LOG - 1)), view]);
    setSelectedEventId(view.id);
    eventMarkersRef.current.push({
      x: event.position.x,
      y: event.position.y,
      type: event.type,
      expiresAt: now + 1.2,
    });
    eventMarkersRef.current = eventMarkersRef.current.slice(-24);

  }, []);

  const sampleEnergy = useCallback((force = false) => {
    const now = simTimeRef.current;
    if (!force && now - lastEnergySampleRef.current < 0.1) return;
    lastEnergySampleRef.current = now;
    const currentPortals = portalsRef.current;
    const currentConfig = configRef.current;
    let kinetic = 0;
    let potential = 0;
    for (const body of objectsRef.current) {
      kinetic += 0.5 * body.mass * (body.vx ** 2 + body.vy ** 2);
      potential += body.mass * computePotentialAt(body.x, body.y, currentPortals, currentConfig);
    }
    const total = kinetic + potential;
    if (energyBaselineRef.current === null || !Number.isFinite(energyBaselineRef.current)) {
      energyBaselineRef.current = total;
    }
    const baseline = energyBaselineRef.current;
    const absoluteDrift = total - baseline;
    const drift = Math.abs(baseline) > 1e-9
      ? absoluteDrift / Math.abs(baseline) * 100
      : Math.abs(absoluteDrift) <= 1e-9 ? 0 : Number.NaN;
    const sample = { time: now, kinetic, potential, total };
    setEnergyNow({ kinetic, potential, total, drift });
    setEnergySamples(previous => [...previous, sample].slice(-MAX_ENERGY_SAMPLES));
  }, []);

  const captureTimelineFrame = useCallback((force = false) => {
    const now = simTimeRef.current;
    if (!force && now - lastTimelineCaptureRef.current < TIMELINE_SAMPLE_INTERVAL) return;
    const frames = timelineFramesRef.current;
    if (timelineCursorRef.current < frames.length - 1) {
      frames.splice(timelineCursorRef.current + 1);
    }
    frames.push(captureExperiment(false));
    if (frames.length > MAX_TIMELINE_FRAMES) frames.shift();
    timelineCursorRef.current = frames.length - 1;
    lastTimelineCaptureRef.current = now;
    setTimelineUi({ index: timelineCursorRef.current, max: frames.length - 1 });
  }, [captureExperiment]);

  const stepWorld = useCallback((stepDuration: number, width: number, height: number, pinnedIdx = -1) => {
    const currentConfig = configRef.current;
    const substeps = Math.max(1, currentConfig.substeps);
    const dt = stepDuration / substeps;
    const friction = currentConfig.vacuum ? 1 : currentConfig.friction;

    for (let substep = 0; substep < substeps; substep += 1) {
      const beforePortals = portalsRef.current;
      const nextTime = simTimeRef.current + dt;
      const movedPortals = advancePortalsWithMotion(beforePortals, motionSpecsRef.current, nextTime);
      const portalPoseChanged = movedPortals.some((portalState, index) => {
        const previous = beforePortals[index];
        return !previous
          || Math.abs(portalState.x - previous.x) > 1e-9
          || Math.abs(portalState.y - previous.y) > 1e-9
          || Math.abs(portalState.angle - previous.angle) > 1e-9
          || Math.abs(portalState.width - previous.width) > 1e-9;
      });
      if (portalPoseChanged) {
        resolveMovingPortalSweeps(objectsRef.current, beforePortals, movedPortals, {
          duration: dt,
          twoSided: currentConfig.twoSided,
          bounce: currentConfig.elasticity,
          onEvent: emitPhysicsEvent,
        });
        portalsRef.current = movedPortals;
      }

      const currentPortals = portalsRef.current;
      objectsRef.current.forEach((body, index) => {
        if (index === pinnedIdx) return;
        body.update(friction, (x, y) => getGravityAt(x, y, currentPortals), dt);
        const event = body.checkCrossing(currentPortals, currentConfig.twoSided, currentConfig.elasticity);
        if (event) emitPhysicsEvent(event);
      });
      resolveCollisions(objectsRef.current, currentConfig.elasticity, pinnedIdx);
      objectsRef.current.forEach((body, index) => {
        if (index !== pinnedIdx) body.constrain(width, height, currentPortals, currentConfig.elasticity, currentConfig.twoSided);
      });
      simTimeRef.current = nextTime;
    }

    const hasProgrammedMotion = (Object.values(motionSpecsRef.current) as PortalMotionSpec[]).some(spec => spec.enabled && spec.kind !== 'static');
    if (hasProgrammedMotion && simTimeRef.current - lastPortalUiSyncRef.current >= 1 / 12) {
      lastPortalUiSyncRef.current = simTimeRef.current;
      setPortals([...portalsRef.current]);
    }
    if (simTimeRef.current - lastTimeUiSyncRef.current >= 0.08) {
      lastTimeUiSyncRef.current = simTimeRef.current;
      setSimTime(simTimeRef.current);
      setInspectorTick(value => value + 1);
    }
    sampleEnergy();
  }, [emitPhysicsEvent, getGravityAt, resolveCollisions, sampleEnergy]);

  // Game Loop
  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    let animationId: number;

    const render = (time: number) => {
      const frameConfig = configRef.current;

      // FPS calculation
      frameCount.current++;
      if (time - lastTime.current >= 1000) {
        setFps(frameCount.current);
        frameCount.current = 0;
        lastTime.current = time;
      }

      const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      const w = canvasSizeRef.current.width || canvas.clientWidth;
      const h = canvasSizeRef.current.height || canvas.clientHeight;
      // Calculate proper timestep based on actual frame performance
      const realFrameDt = (time - prevTime.current) / 1000;
      prevTime.current = time;
      const scaledFrameDt = playingRef.current
        ? getScaledFrameDt(realFrameDt, frameConfig.timeScale, MAX_ACCUMULATED_TIME)
        : 0;
      const pinDt = Math.max(scaledFrameDt, FIXED_TIMESTEP / Math.max(1, frameConfig.substeps));
      const pinnedIdx = syncPinnedBallToPointer(objectsRef.current, dragStateRef.current, lastPos.current, pinDt);

      if (playingRef.current) {
        accumulatorRef.current = Math.min(MAX_ACCUMULATED_TIME, accumulatorRef.current + scaledFrameDt);
        while (accumulatorRef.current >= FIXED_TIMESTEP) {
          stepWorld(FIXED_TIMESTEP, w, h, pinnedIdx);
          accumulatorRef.current -= FIXED_TIMESTEP;
          captureTimelineFrame();
        }
      } else {
        accumulatorRef.current = 0;
      }

      // Draw a single coherent post-step snapshot.
      const config = configRef.current;
      const portals = portalsRef.current;
      const objects = objectsRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#0a0a0c';
      ctx.fillRect(0, 0, w, h);

      if (config.showHeatmap) drawHeatmap(ctx, w, h, portals);
      if (config.showGrid) drawGrid(ctx, w, h, portals);
      if (config.showStreamlines) drawStreamlines(ctx, w, h, portals);
      if (config.showFlow) drawFlow(ctx, w, h, portals);

      // Draw Portals
      portals.forEach(p => {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);

        // One-sided "Back Plate"
        if (!isPortalTwoSided(p, config.twoSided)) {
          ctx.beginPath();
          ctx.fillStyle = 'rgba(255,255,255,0.15)';
          ctx.roundRect(-p.width/2 - 2, -10, p.width + 4, 8, 2);
          ctx.fill();
          
          // Warning pattern
          ctx.strokeStyle = 'rgba(255,255,255,0.1)';
          ctx.lineWidth = 1;
          for (let i = -p.width/2; i < p.width/2; i += 10) {
            ctx.beginPath();
            ctx.moveTo(i, -10);
            ctx.lineTo(i + 5, -2);
            ctx.stroke();
          }

          // The handle and arrow live on the permitted front-entry side.
          ctx.beginPath();
          ctx.moveTo(0, 3);
          ctx.lineTo(-5, 12);
          ctx.lineTo(5, 12);
          ctx.closePath();
          ctx.fillStyle = p.color;
          ctx.fill();
        }

        // Edge Caps (Always solid)
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(-p.width/2, 0, PORTAL_EDGE_RADIUS, 0, Math.PI * 2);
        ctx.arc(p.width/2, 0, PORTAL_EDGE_RADIUS, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 20;
        ctx.shadowColor = p.color;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-p.width/2, 0);
        ctx.lineTo(p.width/2, 0);
        ctx.stroke();
        
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.handle.x, p.handle.y);
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.handle.x, p.handle.y, 7, 0, Math.PI * 2);
        ctx.fillStyle = 'white';
        ctx.fill();
      });

      objects.forEach(obj => obj.draw(ctx, config.trailIntensity, portals, config.twoSided));
      if (config.debugOverlay) drawDebugOverlay(ctx, portals);
      drawObservationOverlay(ctx, portals, objects);
      animationId = requestAnimationFrame(render);
    };

    animationId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationId);
  }, [captureTimelineFrame, drawDebugOverlay, drawFlow, drawGrid, drawHeatmap, drawObservationOverlay, drawStreamlines, stepWorld]);

  const handleStart = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    activePointerId.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    lastPos.current = p;

    const currentPortals = portalsRef.current;
    for (const pt of currentPortals) {
      if (Math.hypot(pt.handle.x - p.x, pt.handle.y - p.y) < 30) {
        beginHistoryTransaction('Rotate portal', { resetEnergy: !playingRef.current });
        const motion = motionSpecsRef.current[pt.id] ?? createMotionSpec(pt);
        motionSpecsRef.current[pt.id] = { ...motion, enabled: false, kind: 'static', originX: pt.x, originY: pt.y, originAngle: pt.angle };
        setSelection({ kind: 'portal', id: pt.id });
        setObservationTab('inspector');
        updateDragState({ id: pt.id, type: 'handle' });
        lastPortalMotionTimestamp.current = e.timeStamp;
        return;
      }
    }

    const objects = objectsRef.current;
    for (let i = objects.length - 1; i >= 0; i--) {
      const obj = objects[i];
      if (Math.hypot(obj.x - p.x, obj.y - p.y) < obj.radius + 20) {
        beginHistoryTransaction('Move ball');
        setSelection({ kind: 'ball', id: obj.id });
        setObservationTab('inspector');
        updateDragState({ id: String(i), type: 'ball' });
        return;
      }
    }

    for (const pt of currentPortals) {
      const local = getPortalLocal(p, pt);
      if (Math.abs(local.normal) < 32 && Math.abs(local.along) < pt.width / 2 + 22) {
        beginHistoryTransaction('Move portal', { resetEnergy: !playingRef.current });
        const motion = motionSpecsRef.current[pt.id] ?? createMotionSpec(pt);
        motionSpecsRef.current[pt.id] = { ...motion, enabled: false, kind: 'static', originX: pt.x, originY: pt.y, originAngle: pt.angle };
        setSelection({ kind: 'portal', id: pt.id });
        setObservationTab('inspector');
        updateDragState({ id: pt.id, type: 'portal' });
        lastPortalMotionTimestamp.current = e.timeStamp;
        return;
      }
    }

    setSelection(null);
  };

  const moveActivePortal = useCallback((point: Point, timestamp: number) => {
    const dragState = dragStateRef.current;
    if ((dragState.type !== 'portal' && dragState.type !== 'handle') || !dragState.id) return;

    const previous = portalsRef.current;
    const updated = movePortalForEditor(previous, dragState.id, dragState.type, point);
    const lastTimestamp = lastPortalMotionTimestamp.current;
    const measuredDuration = lastTimestamp === null ? 1 / 60 : (timestamp - lastTimestamp) / 1000;
    const duration = Number.isFinite(measuredDuration) && measuredDuration > 0
      ? Math.max(1 / 240, Math.min(1, measuredDuration))
      : 1 / 60;
    const config = configRef.current;
    if (playingRef.current) {
      resolveMovingPortalSweeps(objectsRef.current, previous, updated, {
        duration,
        twoSided: config.twoSided,
        bounce: config.elasticity,
        onEvent: emitPhysicsEvent,
      });
    }
    const movedPortal = updated.find(portalState => portalState.id === dragState.id);
    if (movedPortal) {
      const motion = motionSpecsRef.current[movedPortal.id] ?? createMotionSpec(movedPortal);
      motionSpecsRef.current[movedPortal.id] = {
        ...motion,
        enabled: false,
        kind: 'static',
        originX: movedPortal.x,
        originY: movedPortal.y,
        originAngle: movedPortal.angle,
      };
    }
    lastPortalMotionTimestamp.current = timestamp;
    portalsRef.current = updated;
    setPortals(updated);
  }, [emitPhysicsEvent]);

  const finishActiveDrag = useCallback(() => {
    lastPortalMotionTimestamp.current = null;
    updateDragState({ id: null, type: null });
    finishHistoryTransaction();
  }, [finishHistoryTransaction, updateDragState]);

  const handleMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const currentDragState = dragStateRef.current;
    if (!currentDragState.type || activePointerId.current !== e.pointerId) return;
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    moveActivePortal(p, e.timeStamp);
    
    // Update global last pointer position for pinning
    lastPos.current = p;
  };

  const handleEnd = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerId.current !== null && e.pointerId !== activePointerId.current) return;
    activePointerId.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    finishActiveDrag();
  };

  useEffect(() => {
    const onWindowPointerMove = (event: PointerEvent) => {
      const currentDragState = dragStateRef.current;
      if (!currentDragState.type || activePointerId.current !== event.pointerId) return;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const p = { x: event.clientX - rect.left, y: event.clientY - rect.top };

      moveActivePortal(p, event.timeStamp);

      lastPos.current = p;
    };

    const onWindowPointerEnd = (event: PointerEvent) => {
      if (activePointerId.current === null || event.pointerId !== activePointerId.current) return;
      activePointerId.current = null;
      finishActiveDrag();
    };

    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerEnd);
    window.addEventListener('pointercancel', onWindowPointerEnd);

    return () => {
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerEnd);
      window.removeEventListener('pointercancel', onWindowPointerEnd);
    };
  }, [finishActiveDrag, moveActivePortal]);

  const runInstantEdit = useCallback((
    label: string,
    mutation: () => void,
    options: HistoryTransactionOptions = {},
  ) => {
    beginHistoryTransaction(label, options);
    mutation();
    finishHistoryTransaction();
  }, [beginHistoryTransaction, finishHistoryTransaction]);

  const claimBallOrdinal = useCallback(() => {
    while (objectsRef.current.some(body => body.id === `ball-${ballOrdinalRef.current}`)) {
      ballOrdinalRef.current += 1;
    }
    const ordinal = ballOrdinalRef.current;
    ballOrdinalRef.current += 1;
    return ordinal;
  }, []);

  const claimPortalPairOrdinal = useCallback(() => {
    const isTaken = (ordinal: number) => portalsRef.current.some(portalState => (
      portalState.id === `pair-${ordinal}-a` || portalState.id === `pair-${ordinal}-b`
    ));
    while (isTaken(portalPairOrdinalRef.current)) portalPairOrdinalRef.current += 1;
    const ordinal = portalPairOrdinalRef.current;
    portalPairOrdinalRef.current += 1;
    return ordinal;
  }, []);

  const addBall = () => {
    const w = canvasSizeRef.current.width || canvasRef.current?.clientWidth || 800;
    const h = canvasSizeRef.current.height || canvasRef.current?.clientHeight || 600;
    const currentConfig = configRef.current;
    if (objectsRef.current.length >= MAX_BALLS) {
      setToast(`The ${MAX_BALLS}-body safety limit is active`);
      return;
    }
    const spawn = findAvailableBallSpawn(objectsRef.current, w, h, currentConfig.size);
    if (!spawn) {
      setToast('No collision-free launch slot is available');
      return;
    }
    runInstantEdit('Add ball', () => {
      const ordinal = claimBallOrdinal();
      const body = new Ball(spawn.x, spawn.y, currentConfig.size, currentConfig.mass, `ball-${ordinal}`, `Probe ${ordinal}`);
      objectsRef.current.push(body);
      setEntityCount(objectsRef.current.length);
      setSelection({ kind: 'ball', id: body.id });
      setObservationTab('inspector');
    });
  };

  const reset = () => {
    const w = canvasSizeRef.current.width || canvasRef.current?.clientWidth || 800;
    const currentConfig = configRef.current;
    runInstantEdit('Reset probes', () => {
      const ordinal = claimBallOrdinal();
      objectsRef.current = [new Ball(w / 2, 100, currentConfig.size, currentConfig.mass, `ball-${ordinal}`, `Probe ${ordinal}`)];
      setEntityCount(1);
      setSelection(null);
    });
  };

  const flushBuffer = () => {
    if (objectsRef.current.length === 0) return;
    runInstantEdit('Remove all probes', () => {
      objectsRef.current = [];
      setEntityCount(0);
      setSelection(current => current?.kind === 'ball' ? null : current);
    });
  };

  const toggleLayout = () => {
    const w = canvasSizeRef.current.width || canvasRef.current?.clientWidth || 800;
    const h = canvasSizeRef.current.height || canvasRef.current?.clientHeight || 600;
    const cx = w / 2;
    const cy = h / 2;
    
    // Responsive layouts
    const layouts = [
      { 
        p1: { x: cx, y: h - 100, a: -Math.PI / 2 }, 
        p2: { x: cx, y: 100, a: Math.PI / 2 } 
      },
      { 
        p1: { x: 100, y: cy, a: 0 }, 
        p2: { x: w - 100, y: cy, a: Math.PI } 
      },
      { 
        p1: { x: cx - w * 0.15, y: cy + h * 0.1, a: -0.6 }, 
        p2: { x: cx + w * 0.15, y: cy - h * 0.1, a: 2.5 } 
      }
    ];
    
    const nextIdx = (layoutIdx + 1) % layouts.length;
    const l = layouts[nextIdx];
    setLayoutIdx(nextIdx);

    const current = portalsRef.current;
    if (current.length < 2) return;
    beginHistoryTransaction('Change portal layout');
    const p1 = { ...current[0], x: l.p1.x, y: l.p1.y, angle: l.p1.a };
    const p2 = { ...current[1], x: l.p2.x, y: l.p2.y, angle: l.p2.a };
    const updated = [withPortalVectors(p1), withPortalVectors(p2), ...current.slice(2)];
    const config = configRef.current;
    if (playingRef.current) {
      resolveMovingPortalSweeps(objectsRef.current, current, updated, {
        duration: 0.25,
        twoSided: config.twoSided,
        bounce: config.elasticity,
        onEvent: emitPhysicsEvent,
      });
    }
    for (const portalState of updated.slice(0, 2)) {
      const spec = motionSpecsRef.current[portalState.id] ?? createMotionSpec(portalState);
      motionSpecsRef.current[portalState.id] = {
        ...spec,
        enabled: false,
        kind: 'static',
        originX: portalState.x,
        originY: portalState.y,
        originAngle: portalState.angle,
      };
    }
    portalsRef.current = updated;
    setPortals(updated);
    finishHistoryTransaction();
  };

  const addPortalPair = () => {
    if (portalsRef.current.length >= 8) {
      setToast('The lab UI supports up to four linked pairs');
      return;
    }
    const w = canvasSizeRef.current.width || 800;
    const h = canvasSizeRef.current.height || 600;
    runInstantEdit('Add portal pair', () => {
      const ordinal = claimPortalPairOrdinal();
      const colors = ordinal % 2 === 0 ? ['#a855f7', '#22c55e'] : ['#f43f5e', '#06b6d4'];
      const pair = [
        withPortalVectors({ id: `pair-${ordinal}-a`, x: w * 0.3, y: h * (0.28 + (ordinal % 3) * 0.16), angle: 0, color: colors[0], width: configRef.current.portalWidth, twoSided: configRef.current.twoSided }),
        withPortalVectors({ id: `pair-${ordinal}-b`, x: w * 0.7, y: h * (0.28 + (ordinal % 3) * 0.16), angle: Math.PI, color: colors[1], width: configRef.current.portalWidth, twoSided: configRef.current.twoSided }),
      ];
      portalsRef.current = [...portalsRef.current, ...pair];
      for (const portalState of pair) motionSpecsRef.current[portalState.id] = createMotionSpec(portalState);
      setPortals([...portalsRef.current]);
      setSelection({ kind: 'portal', id: pair[0].id });
      setObservationTab('inspector');
    });
  };

  const togglePlayback = useCallback(() => {
    setPlaying(value => {
      const next = !value;
      playingRef.current = next;
      if (next && timelineCursorRef.current < timelineFramesRef.current.length - 1) {
        timelineFramesRef.current.splice(timelineCursorRef.current + 1);
        setTimelineUi({ index: timelineCursorRef.current, max: timelineCursorRef.current });
      }
      return next;
    });
  }, []);

  const singleStep = useCallback(() => {
    setPlaying(false);
    playingRef.current = false;
    const w = canvasSizeRef.current.width || canvasRef.current?.clientWidth || 800;
    const h = canvasSizeRef.current.height || canvasRef.current?.clientHeight || 600;
    if (timelineCursorRef.current < timelineFramesRef.current.length - 1) {
      timelineFramesRef.current.splice(timelineCursorRef.current + 1);
    }
    stepWorld(FIXED_TIMESTEP, w, h);
    captureTimelineFrame(true);
    setSimTime(simTimeRef.current);
    sampleEnergy(true);
  }, [captureTimelineFrame, sampleEnergy, stepWorld]);

  const scrubTimeline = useCallback((index: number) => {
    const frames = timelineFramesRef.current;
    if (frames.length === 0) return;
    const clamped = Math.max(0, Math.min(frames.length - 1, Math.round(index)));
    setPlaying(false);
    playingRef.current = false;
    timelineCursorRef.current = clamped;
    applyExperimentDocument(frames[clamped], true);
    setTimelineUi({ index: clamped, max: frames.length - 1 });
    sampleEnergy(true);
  }, [applyExperimentDocument, sampleEnergy]);

  const rewindTimeline = useCallback(() => scrubTimeline(0), [scrubTimeline]);

  const loadExperiment = useCallback((documentState: ExperimentDocument) => {
    beginHistoryTransaction(`Load ${documentState.name}`);
    applyExperimentDocument(documentState);
    finishHistoryTransaction();
    resetTimelineFromCurrent();
    setShowExperiments(false);
    setToast(`Loaded ${documentState.name}`);
    sampleEnergy(true);
  }, [applyExperimentDocument, beginHistoryTransaction, finishHistoryTransaction, resetTimelineFromCurrent, sampleEnergy]);

  const experimentCards = useMemo<ExperimentCardData[]>(() => EXPERIMENT_PRESETS.map(preset => ({
    id: preset.id,
    title: preset.title,
    question: preset.question,
    description: preset.description,
    accent: preset.accent,
    tags: preset.tags,
  })), []);

  const handleLoadExperimentCard = useCallback((card: ExperimentCardData) => {
    const preset = EXPERIMENT_PRESETS.find(candidate => candidate.id === card.id);
    if (!preset) return;
    const size = canvasSizeRef.current;
    loadExperiment(preset.create(size.width || 800, size.height || 600));
  }, [loadExperiment]);

  const handleSurprise = useCallback(() => {
    const size = canvasSizeRef.current;
    const seed = `${Date.now().toString(36)}-${Math.floor(performance.now()).toString(36)}`;
    loadExperiment(createSurpriseExperiment(size.width || 800, size.height || 600, seed));
  }, [loadExperiment]);

  const copyShareLink = useCallback(async (documentState: ExperimentDocument) => {
    const encoded = encodeExperimentDocument(documentState);
    if (!encoded.ok) {
      setToast('error' in encoded ? encoded.error.message : 'Could not encode this experiment');
      return;
    }
    const url = `${window.location.origin}${window.location.pathname}#experiment=${encoded.value}`;
    try {
      await navigator.clipboard.writeText(url);
      setToast('Share link copied');
    } catch {
      window.prompt('Copy this experiment link', url);
    }
  }, []);

  const saveSnapshot = useCallback((name: string) => {
    const createdAt = Date.now();
    const snapshot: SavedSnapshot = {
      id: `snapshot-${createdAt.toString(36)}`,
      name: name.trim() || `Snapshot at ${simTimeRef.current.toFixed(2)} s`,
      createdAt,
      document: captureExperiment(false),
    };
    setSavedSnapshots(previous => [snapshot, ...previous]);
    setToast('Snapshot saved locally');
  }, [captureExperiment]);

  const restoreSnapshot = useCallback((id: string) => {
    const snapshot = savedSnapshots.find(candidate => candidate.id === id);
    if (snapshot) loadExperiment(snapshot.document);
  }, [loadExperiment, savedSnapshots]);

  const deleteSnapshot = useCallback((id: string) => {
    setSavedSnapshots(previous => previous.filter(candidate => candidate.id !== id));
  }, []);

  const shareSnapshot = useCallback((id: string) => {
    const snapshot = savedSnapshots.find(candidate => candidate.id === id);
    if (snapshot) void copyShareLink(snapshot.document);
  }, [copyShareLink, savedSnapshots]);

  const selectedBall = useMemo(() => {
    void inspectorTick;
    return selection?.kind === 'ball' ? objectsRef.current.find(body => body.id === selection.id) : undefined;
  }, [entityCount, inspectorTick, selection]);
  const selectedPortal = useMemo(() => (
    selection?.kind === 'portal' ? portals.find(portalState => portalState.id === selection.id) : undefined
  ), [portals, selection]);
  const selectedMotion = selectedPortal
    ? (motionSpecsRef.current[selectedPortal.id] ?? createMotionSpec(selectedPortal))
    : undefined;

  const patchSelectedBall = useCallback((patch: Partial<Pick<Ball, 'x' | 'y' | 'vx' | 'vy' | 'radius' | 'mass' | 'label'>>) => {
    if (selection?.kind !== 'ball') return;
    const body = objectsRef.current.find(candidate => candidate.id === selection.id);
    if (!body) return;
    const width = canvasSizeRef.current.width || 800;
    const height = canvasSizeRef.current.height || 600;
    if (typeof patch.label === 'string') body.label = patch.label.slice(0, 120);
    if (patch.x !== undefined) body.x = clampNumber(patch.x, -width, width * 2, body.x);
    if (patch.y !== undefined) body.y = clampNumber(patch.y, -height, height * 2, body.y);
    if (patch.vx !== undefined) body.vx = clampNumber(patch.vx, -100_000, 100_000, body.vx);
    if (patch.vy !== undefined) body.vy = clampNumber(patch.vy, -100_000, 100_000, body.vy);
    if (patch.radius !== undefined) body.radius = clampNumber(patch.radius, 3, 200, body.radius);
    if (patch.mass !== undefined) body.mass = clampNumber(patch.mass, 0.1, 10_000, body.mass);
    body.oldX = body.x;
    body.oldY = body.y;
    setInspectorTick(value => value + 1);
  }, [selection]);

  const patchSelectedPortal = useCallback((patch: Partial<Pick<Portal, 'x' | 'y' | 'angle' | 'width' | 'twoSided'>>) => {
    if (selection?.kind !== 'portal') return;
    const previous = portalsRef.current;
    const updated = previous.map(portalState => {
      if (portalState.id !== selection.id) return portalState;
      return withPortalVectors({
        ...portalState,
        ...patch,
        x: patch.x === undefined ? portalState.x : clampNumber(patch.x, -10_000_000, 10_000_000, portalState.x),
        y: patch.y === undefined ? portalState.y : clampNumber(patch.y, -10_000_000, 10_000_000, portalState.y),
        angle: patch.angle === undefined ? portalState.angle : clampNumber(patch.angle, -1_000_000, 1_000_000, portalState.angle),
        width: patch.width === undefined ? portalState.width : clampNumber(patch.width, 10, 4_000, portalState.width),
      });
    });
    const changed = updated.find(portalState => portalState.id === selection.id);
    if (!changed) return;
    if (playingRef.current) {
      resolveMovingPortalSweeps(objectsRef.current, previous, updated, {
        duration: 1 / 30,
        twoSided: configRef.current.twoSided,
        bounce: configRef.current.elasticity,
        onEvent: emitPhysicsEvent,
      });
    }
    const motion = motionSpecsRef.current[changed.id] ?? createMotionSpec(changed);
    motionSpecsRef.current[changed.id] = rebaseMotionSpecAtPose(changed, {
      ...motion,
      originX: changed.x,
      originY: changed.y,
      originAngle: changed.angle,
    }, simTimeRef.current);
    portalsRef.current = updated;
    setPortals(updated);
  }, [emitPhysicsEvent, selection]);

  const patchSelectedMotion = useCallback((patch: Partial<PortalMotionSpec>) => {
    if (selection?.kind !== 'portal') return;
    const livePortal = portalsRef.current.find(portalState => portalState.id === selection.id);
    if (!livePortal) return;
    const current = motionSpecsRef.current[livePortal.id] ?? createMotionSpec(livePortal);
    const normalized = normalizeMotionSpec({ ...current, ...patch }, current);
    motionSpecsRef.current[livePortal.id] = rebaseMotionSpecAtPose(
      livePortal,
      normalized,
      simTimeRef.current,
    );
    setPortals([...portalsRef.current]);
    setInspectorTick(value => value + 1);
  }, [selection]);

  const duplicateSelectedBall = useCallback(() => {
    if (!selectedBall || objectsRef.current.length >= MAX_BALLS) return;
    runInstantEdit('Duplicate ball', () => {
      const ordinal = claimBallOrdinal();
      const clone = new Ball(selectedBall.x + selectedBall.radius * 2 + 8, selectedBall.y, selectedBall.radius, selectedBall.mass, `ball-${ordinal}`, `${selectedBall.label} copy`);
      clone.vx = selectedBall.vx;
      clone.vy = selectedBall.vy;
      clone.color = selectedBall.color;
      objectsRef.current.push(clone);
      setEntityCount(objectsRef.current.length);
      setSelection({ kind: 'ball', id: clone.id });
    });
  }, [claimBallOrdinal, runInstantEdit, selectedBall]);

  const deleteSelection = useCallback(() => {
    if (!selection) return;
    if (selection.kind === 'ball') {
      runInstantEdit('Delete ball', () => {
        objectsRef.current = objectsRef.current.filter(body => body.id !== selection.id);
        setEntityCount(objectsRef.current.length);
        setSelection(null);
      });
      return;
    }
    const index = portalsRef.current.findIndex(portalState => portalState.id === selection.id);
    if (index < 0) return;
    const pairStart = index % 2 === 0 ? index : index - 1;
    runInstantEdit('Delete portal pair', () => {
      const removed = portalsRef.current.slice(pairStart, pairStart + 2);
      portalsRef.current = portalsRef.current.filter((_, portalIndex) => portalIndex < pairStart || portalIndex > pairStart + 1);
      for (const portalState of removed) delete motionSpecsRef.current[portalState.id];
      setPortals([...portalsRef.current]);
      setSelection(null);
    });
  }, [runInstantEdit, selection]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.matches('input, textarea, select, [contenteditable="true"]');
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        if (editing) return;
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
        return;
      }
      if (editing || showExperiments || showSnapshots || showHelp) return;
      if (event.code === 'Space') {
        event.preventDefault();
        togglePlayback();
      } else if (event.key === '.') {
        event.preventDefault();
        singleStep();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelection();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleteSelection, redo, showExperiments, showHelp, showSnapshots, singleStep, togglePlayback, undo]);

  return (
    <div className="app-root lab-dashboard-shell lab-safe-area bg-[#050508] text-white w-full min-h-screen font-sans overflow-x-hidden lg:w-screen">
      <div className="lab-dashboard-grid flex flex-col lg:grid lg:grid-cols-4 lg:grid-rows-3 gap-4">
        
        {/* Hero Card */}
        <div className="lg:col-span-2 lg:row-span-1 bg-[#0f0f19] border border-white/10 rounded-2xl p-5 md:p-6 flex flex-col justify-between relative group order-1 lg:order-none overflow-hidden">
          <div className="absolute -right-16 -top-20 h-52 w-52 rounded-full bg-[#00a2ff]/10 blur-3xl" aria-hidden="true" />
          <div className="relative flex flex-col items-start justify-between gap-4 sm:flex-row">
            <div className="min-w-0">
              <div className="text-[#00a2ff] text-[10px] font-bold tracking-[0.22em] mb-2 uppercase flex items-center gap-2">
                <FlaskConical size={13} /> Experimental laboratory
              </div>
              <h1 className="truncate text-2xl md:text-3xl font-light leading-tight">
                {experimentMetaRef.current.name}
              </h1>
              <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-white/45">
                {experimentMetaRef.current.question}
              </p>
            </div>
            <div className="flex w-full flex-wrap justify-start gap-2 sm:w-auto sm:shrink-0 sm:justify-end">
              <button type="button" onClick={() => setShowExperiments(true)} className="lab-touch-target inline-flex items-center gap-2 rounded-full border border-[#00a2ff]/25 bg-[#00a2ff]/10 px-3 text-[9px] font-bold uppercase tracking-wider text-[#67c7ff] hover:bg-[#00a2ff]/20" title="Experiment library" aria-label="Open experiment library">
                <BookOpen size={14} /> <span className="hidden xl:inline">Experiments</span>
              </button>
              <button type="button" onClick={() => setShowSnapshots(true)} className="lab-touch-target inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 px-3 text-white/55 hover:bg-white/10 hover:text-white" title="Snapshots" aria-label="Open snapshots">
                <Camera size={14} />
              </button>
              <button type="button" onClick={() => void copyShareLink(captureExperiment(false))} className="lab-touch-target inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 px-3 text-white/55 hover:bg-white/10 hover:text-white" title="Copy shareable experiment link" aria-label="Copy shareable experiment link">
                <Link2 size={14} />
              </button>
              <button type="button" onClick={() => setShowHelp(true)} className="lab-touch-target inline-flex items-center justify-center rounded-full border border-white/10 bg-white/5 px-3 text-white/55 hover:bg-white/10 hover:text-white" title="Physics assumptions" aria-label="Open physics assumptions">
                <Info size={14} />
              </button>
            </div>
          </div>
          <div className="relative mt-4 flex flex-wrap items-center gap-2 text-[9px] uppercase tracking-wider text-white/30">
            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-emerald-300">Canonical model</span>
            <span>Seed {String(experimentMetaRef.current.seed)}</span>
            <span>•</span>
            <span>{Math.floor(portals.length / 2)} linked {Math.floor(portals.length / 2) === 1 ? 'pair' : 'pairs'}</span>
          </div>
        </div>

        {/* Metrics Card */}
        <div className="lg:col-span-1 lg:row-span-1 bg-[#0f0f19] border border-white/10 rounded-2xl p-6 flex flex-col justify-between order-3 lg:order-none relative">
          <div className="text-[#ff9d00] text-xs font-bold tracking-widest uppercase mb-4">Sim Metrics</div>
          <div className="space-y-4">
            <div className="flex justify-between items-end">
              <div>
                <div className="text-2xl md:text-3xl font-mono">{fps}<span className="text-[10px] md:text-lg uppercase text-white/30 ml-1 italic">fps</span></div>
                <div className="text-[9px] uppercase text-white/40">Frame Stability</div>
              </div>
              <div className="text-right">
                <div className="text-lg md:text-xl font-mono text-[#00a2ff]">{entityCount}/{MAX_BALLS}</div>
                <div className="text-[9px] uppercase text-white/40">Entities</div>
              </div>
            </div>
            
            <div className="space-y-1">
              <div className="flex justify-between text-[8px] uppercase font-bold text-white/30">
                <span className="flex items-center">Simulation Speed <HelpTooltip text="Scales the passage of time. Higher values speed up motion; lower values create slow-motion effects." /></span>
                <span>{config.timeScale.toFixed(1)}x</span>
              </div>
              <input 
                aria-label="Simulation speed"
                type="range" min="0.1" max="2.0" step="0.1"
                value={config.timeScale}
                onPointerDown={() => beginHistoryTransaction('Change simulation speed', { resetEnergy: false })}
                onFocus={() => beginHistoryTransaction('Change simulation speed', { resetEnergy: false })}
                onPointerUp={finishHistoryTransaction}
                onBlur={finishHistoryTransaction}
                onChange={e => updateConfig({ timeScale: parseFloat(e.target.value) })}
                className="w-full accent-[#ff9d00] h-1"
              />
            </div>
            
            <div className="space-y-1">
              <div className="flex justify-between text-[8px] uppercase font-bold text-white/30">
                <span className="flex items-center">Integrator Precision <HelpTooltip text="Sub-steps per frame. Higher values prevent high-speed objects from passing through walls by calculating physics more frequently." /></span>
                <span>{config.substeps} steps</span>
              </div>
              <input 
                aria-label="Integrator precision"
                type="range" min="1" max="24" step="1"
                value={config.substeps}
                onPointerDown={() => beginHistoryTransaction('Change integrator precision', { resetEnergy: false })}
                onFocus={() => beginHistoryTransaction('Change integrator precision', { resetEnergy: false })}
                onPointerUp={finishHistoryTransaction}
                onBlur={finishHistoryTransaction}
                onChange={e => updateConfig({ substeps: parseInt(e.target.value) })}
                className="w-full accent-[#ff9d00] h-1"
              />
            </div>
          </div>
        </div>

        {/* Physics Params Card */}
        <div className="lg:col-span-1 lg:row-span-1 bg-[#0f0f19] border border-white/10 rounded-2xl p-6 order-4 lg:order-none min-h-[180px] relative">
          <div className="text-[#00a2ff] text-xs font-bold tracking-widest uppercase mb-4 flex items-center justify-between">
            Physics Tuning
            <Settings2 size={14} className="opacity-50" />
          </div>
          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-1">
              <div className="flex justify-between text-[8px] uppercase font-bold text-white/30">
                <span className="flex items-center">Damping <HelpTooltip text="Simulates air resistance. 1.0 is a perfect vacuum; lower values cause objects to lose energy over time." /></span>
                <span>{((1-config.friction)*1000).toFixed(0)}m</span>
              </div>
              <input 
                aria-label="Air damping"
                type="range" min="0.95" max="1.0" step="0.001"
                value={config.friction}
                onPointerDown={() => beginHistoryTransaction('Change damping')}
                onFocus={() => beginHistoryTransaction('Change damping')}
                onPointerUp={finishHistoryTransaction}
                onBlur={finishHistoryTransaction}
                onChange={e => updateConfig({ friction: parseFloat(e.target.value) })}
                className="w-full accent-[#00a2ff] h-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <div className="flex justify-between text-[8px] uppercase font-bold text-white/30">
                  <span className="flex items-center">Elastic <HelpTooltip text="The 'bounciness' of walls and object collisions. Close to 1.0 preserves almost all kinetic energy." /></span>
                  <span>{config.elasticity.toFixed(2)}</span>
                </div>
                <input 
                  aria-label="Collision elasticity"
                  type="range" min="0.1" max="0.95" step="0.05"
                  value={config.elasticity}
                  onPointerDown={() => beginHistoryTransaction('Change elasticity')}
                  onFocus={() => beginHistoryTransaction('Change elasticity')}
                  onPointerUp={finishHistoryTransaction}
                  onBlur={finishHistoryTransaction}
                  onChange={e => updateConfig({ elasticity: parseFloat(e.target.value) })}
                  className="w-full accent-[#00a2ff] h-1"
                />
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-[8px] uppercase font-bold text-white/30">
                  <span className="flex items-center">Physical Gravity <HelpTooltip text="The single global downward acceleration multiplier applied to all sandbox entities." /></span>
                  <span>{config.gravity.toFixed(1)}x</span>
                </div>
                <input 
                  aria-label="Gravity strength"
                  type="range" min="0" max="5" step="0.1"
                  value={config.gravity}
                  onPointerDown={() => beginHistoryTransaction('Change gravity')}
                  onFocus={() => beginHistoryTransaction('Change gravity')}
                  onPointerUp={finishHistoryTransaction}
                  onBlur={finishHistoryTransaction}
                  onChange={e => updateConfig({ gravity: parseFloat(e.target.value) })}
                  className="w-full accent-[#00a2ff] h-1"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 pt-1">
              <div className="space-y-1">
                <div className="flex justify-between text-[8px] uppercase font-bold text-white/30">
                  <span className="flex items-center">Launch Size <HelpTooltip text="Sets the radius of new objects spawned in the sandbox." /></span>
                  <span>{config.size}px</span>
                </div>
                <input 
                  aria-label="New probe radius"
                  type="range" min="5" max="40" step="1"
                  value={config.size}
                  onPointerDown={() => beginHistoryTransaction('Change launch size')}
                  onFocus={() => beginHistoryTransaction('Change launch size')}
                  onPointerUp={finishHistoryTransaction}
                  onBlur={finishHistoryTransaction}
                  onChange={e => updateConfig({ size: parseInt(e.target.value) })}
                  className="w-full accent-white/20 h-1"
                />
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-[8px] uppercase font-bold text-white/30">
                  <span className="flex items-center">Launch Mass <HelpTooltip text="The physical mass used for momentum translation during collisions." /></span>
                  <span>{config.mass}Kg</span>
                </div>
                <input 
                  aria-label="New probe mass"
                  type="range" min="5" max="100" step="5"
                  value={config.mass}
                  onPointerDown={() => beginHistoryTransaction('Change launch mass')}
                  onFocus={() => beginHistoryTransaction('Change launch mass')}
                  onPointerUp={finishHistoryTransaction}
                  onBlur={finishHistoryTransaction}
                  onChange={e => updateConfig({ mass: parseInt(e.target.value) })}
                  className="w-full accent-white/20 h-1"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Portal Bridge Settings */}
        <div className="lg:col-span-1 lg:row-span-2 bg-[#0f0f19] border border-white/10 rounded-2xl p-5 flex min-h-0 flex-col order-5 lg:order-none relative">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="text-white/40 text-xs font-bold tracking-widest uppercase flex items-center gap-2">
              <Target size={13} className="text-[#00a2ff]" />
              {selection ? 'Selection inspector' : 'Experiment setup'}
            </div>
            {selection && (
              <button type="button" onClick={() => setSelection(null)} className="lab-touch-target inline-flex items-center justify-center rounded-full text-white/30 hover:bg-white/10 hover:text-white" aria-label="Clear selection">
                <X size={15} />
              </button>
            )}
          </div>

          <div className="lab-scroll-area min-h-0 flex-1 overflow-y-auto pr-1">
            {selectedBall ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.06] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs font-semibold text-cyan-100">
                      <CircleDot size={15} /> {selectedBall.label}
                    </div>
                    <span className="font-mono text-[9px] text-white/35">{selectedBall.id}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[9px] uppercase tracking-wide text-white/30">
                    <div><span className="block text-lg font-mono text-white/80">{Math.hypot(selectedBall.vx, selectedBall.vy).toFixed(1)}</span>speed px/s</div>
                    <div><span className="block text-lg font-mono text-white/80">{(0.5 * selectedBall.mass * (selectedBall.vx ** 2 + selectedBall.vy ** 2)).toExponential(2)}</span>kinetic</div>
                  </div>
                </div>

                <label className="block text-[9px] font-bold uppercase tracking-wider text-white/35">
                  Label
                  <input value={selectedBall.label} onFocus={() => beginHistoryTransaction('Rename ball')} onBlur={finishHistoryTransaction} onChange={event => patchSelectedBall({ label: event.target.value })} className="mt-1 min-h-11 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-xs normal-case text-white outline-none focus:border-[#00a2ff]/60" />
                </label>

                <div className="grid grid-cols-2 gap-2">
                  {([
                    ['X position', 'x', selectedBall.x, 1],
                    ['Y position', 'y', selectedBall.y, 1],
                    ['X velocity', 'vx', selectedBall.vx, 5],
                    ['Y velocity', 'vy', selectedBall.vy, 5],
                    ['Radius', 'radius', selectedBall.radius, 1],
                    ['Mass', 'mass', selectedBall.mass, 1],
                  ] as const).map(([label, key, value, step]) => (
                    <label key={key} className="text-[8px] font-bold uppercase tracking-wider text-white/30">
                      {label}
                      <input type="number" value={Number(value.toFixed(2))} step={step} onFocus={() => beginHistoryTransaction(`Change ball ${key}`)} onBlur={finishHistoryTransaction} onChange={event => patchSelectedBall({ [key]: Number(event.target.value) })} className="mt-1 min-h-11 w-full rounded-lg border border-white/10 bg-black/30 px-2 font-mono text-[11px] text-white outline-none focus:border-cyan-300/50" />
                    </label>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={duplicateSelectedBall} className="lab-touch-target rounded-xl border border-white/10 bg-white/5 text-[9px] font-bold uppercase tracking-wider text-white/55 hover:bg-white/10 hover:text-white"><Copy size={13} className="mr-2 inline" />Duplicate</button>
                  <button type="button" onClick={deleteSelection} className="lab-touch-target rounded-xl border border-red-400/20 bg-red-400/5 text-[9px] font-bold uppercase tracking-wider text-red-300/70 hover:bg-red-400/15"><Trash2 size={13} className="mr-2 inline" />Delete</button>
                </div>
              </div>
            ) : selectedPortal && selectedMotion ? (
              <div className="space-y-4">
                <div className="rounded-xl border p-3" style={{ borderColor: `${selectedPortal.color}55`, backgroundColor: `${selectedPortal.color}0d` }}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs font-semibold text-white/85"><span className="h-3 w-3 rounded-full" style={{ background: selectedPortal.color, boxShadow: `0 0 12px ${selectedPortal.color}` }} />{selectedPortal.id}</div>
                    <span className="text-[9px] uppercase text-white/30">Mouth {portals.findIndex(item => item.id === selectedPortal.id) + 1}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {([
                    ['X position', 'x', selectedPortal.x, 1],
                    ['Y position', 'y', selectedPortal.y, 1],
                    ['Angle °', 'angle', selectedPortal.angle * 180 / Math.PI, 1],
                    ['Width', 'width', selectedPortal.width, 5],
                  ] as const).map(([label, key, value, step]) => (
                    <label key={key} className="text-[8px] font-bold uppercase tracking-wider text-white/30">
                      {label}
                      <input type="number" value={Number(value.toFixed(2))} step={step} onFocus={() => beginHistoryTransaction(`Change portal ${key}`)} onBlur={finishHistoryTransaction} onChange={event => patchSelectedPortal({ [key]: key === 'angle' ? Number(event.target.value) * Math.PI / 180 : Number(event.target.value) })} className="mt-1 min-h-11 w-full rounded-lg border border-white/10 bg-black/30 px-2 font-mono text-[11px] text-white outline-none focus:border-[#00a2ff]/50" />
                    </label>
                  ))}
                </div>

                <div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 p-3">
                  <div><div className="text-[9px] font-bold uppercase tracking-wider text-white/55">Two-sided matter</div><p className="mt-1 text-[9px] text-white/25">Gravity remains reciprocal.</p></div>
                  <button type="button" role="switch" aria-label="Allow matter through both sides of this portal mouth" aria-checked={isPortalTwoSided(selectedPortal, config.twoSided)} onClick={() => runInstantEdit('Change mouth sidedness', () => patchSelectedPortal({ twoSided: !isPortalTwoSided(selectedPortal, config.twoSided) }))} className="lab-touch-target inline-flex items-center justify-center rounded-full">
                    <span className={`relative h-6 w-11 rounded-full transition-colors ${isPortalTwoSided(selectedPortal, config.twoSided) ? 'bg-[#00a2ff]' : 'bg-white/10'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${isPortalTwoSided(selectedPortal, config.twoSided) ? 'left-6' : 'left-1'}`} /></span>
                  </button>
                </div>

                <div className="space-y-3 border-t border-white/10 pt-4">
                  <div className="flex items-center justify-between">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-white/55 flex items-center gap-2"><Orbit size={13} className="text-[#ff9d00]" />Programmed motion</div>
                    <button type="button" role="switch" aria-label="Enable programmed motion for this portal mouth" aria-checked={selectedMotion.enabled} onClick={() => runInstantEdit('Toggle portal motion', () => patchSelectedMotion({ enabled: !selectedMotion.enabled, kind: selectedMotion.kind === 'static' ? 'linear' : selectedMotion.kind }))} className="lab-touch-target inline-flex items-center justify-center rounded-full"><span className={`relative h-6 w-11 rounded-full transition-colors ${selectedMotion.enabled ? 'bg-[#ff9d00]' : 'bg-white/10'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${selectedMotion.enabled ? 'left-6' : 'left-1'}`} /></span></button>
                  </div>
                  <label className="block text-[8px] font-bold uppercase tracking-wider text-white/30">Path
                    <select value={selectedMotion.kind} onChange={event => runInstantEdit('Change portal path', () => patchSelectedMotion({ kind: event.target.value as PortalMotionSpec['kind'], enabled: event.target.value !== 'static' }))} className="mt-1 min-h-11 w-full rounded-lg border border-white/10 bg-[#09090e] px-3 text-[11px] text-white outline-none focus:border-[#ff9d00]/50">
                      <option value="static">Static</option><option value="linear">Linear oscillation</option><option value="circular">Circular path</option><option value="oscillate">Position + rotation</option>
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      ['Amplitude px', 'amplitude', selectedMotion.amplitude, 5],
                      ['Frequency Hz', 'frequency', selectedMotion.frequency, 0.05],
                      ['Axis °', 'axisAngle', selectedMotion.axisAngle * 180 / Math.PI, 5],
                      ['Rotation °', 'angularAmplitude', selectedMotion.angularAmplitude * 180 / Math.PI, 5],
                    ] as const).map(([label, key, value, step]) => (
                      <label key={key} className="text-[8px] font-bold uppercase tracking-wider text-white/30">{label}<input type="number" value={Number(value.toFixed(2))} step={step} onFocus={() => beginHistoryTransaction(`Change motion ${key}`)} onBlur={finishHistoryTransaction} onChange={event => patchSelectedMotion({ [key]: key === 'axisAngle' || key === 'angularAmplitude' ? Number(event.target.value) * Math.PI / 180 : Number(event.target.value) })} className="mt-1 min-h-11 w-full rounded-lg border border-white/10 bg-black/30 px-2 font-mono text-[11px] text-white outline-none focus:border-[#ff9d00]/50" /></label>
                    ))}
                  </div>
                </div>

                <button type="button" onClick={deleteSelection} className="lab-touch-target w-full rounded-xl border border-red-400/20 bg-red-400/5 text-[9px] font-bold uppercase tracking-wider text-red-300/70 hover:bg-red-400/15"><Trash2 size={13} className="mr-2 inline" />Delete linked pair</button>
              </div>
            ) : (
              <div className="space-y-4">
                 <div className="rounded-xl border border-dashed border-white/10 bg-black/15 p-5 text-center">
                  <Target size={22} className="mx-auto text-white/20" />
                  <p className="mt-3 text-xs text-white/55">Select a probe or mouth on the canvas.</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-white/25">Inspect live position, velocity, clearance, sidedness, and motion paths.</p>
                 </div>
                {(objectsRef.current.length > 0 || portals.length > 0) && (
                  <div className="space-y-2" aria-label="Experiment entities">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-white/35">Select an entity</div>
                    <div className="grid grid-cols-2 gap-2">
                      {objectsRef.current.map(body => (
                        <button key={body.id} type="button" onClick={() => { setSelection({ kind: 'ball', id: body.id }); setObservationTab('inspector'); }} className="lab-touch-target truncate rounded-xl border border-cyan-300/15 bg-cyan-300/[0.04] px-3 text-left text-[9px] text-cyan-100/70 hover:bg-cyan-300/10">
                          <CircleDot size={12} className="mr-1.5 inline" />{body.label}
                        </button>
                      ))}
                      {portals.map(portalState => (
                        <button key={portalState.id} type="button" onClick={() => { setSelection({ kind: 'portal', id: portalState.id }); setObservationTab('inspector'); }} className="lab-touch-target truncate rounded-xl border border-white/10 bg-white/[0.03] px-3 text-left text-[9px] text-white/55 hover:bg-white/[0.08]">
                          <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: portalState.color }} />{portalState.id}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <button type="button" onClick={addPortalPair} className="lab-touch-target w-full rounded-xl border border-[#00a2ff]/25 bg-[#00a2ff]/10 text-[9px] font-bold uppercase tracking-wider text-[#67c7ff] hover:bg-[#00a2ff]/20"><Plus size={14} className="mr-2 inline" />Add linked pair</button>
                <div className="space-y-2">
                  <div className="flex justify-between text-[9px] font-bold uppercase tracking-wider text-white/35"><span>New-mouth width</span><span>{config.portalWidth}px</span></div>
                  <input aria-label="New portal mouth width" type="range" min="40" max="250" step="5" value={config.portalWidth} onPointerDown={() => beginHistoryTransaction('Change portal default width')} onFocus={() => beginHistoryTransaction('Change portal default width')} onPointerUp={finishHistoryTransaction} onBlur={finishHistoryTransaction} onChange={event => updateConfig({ portalWidth: Number(event.target.value) })} className="w-full" />
                </div>
                <button type="button" onClick={() => runInstantEdit('Apply matter sidedness', () => {
                  const next = !config.twoSided;
                  updateConfig({ twoSided: next });
                  portalsRef.current = portalsRef.current.map(portalState => ({ ...portalState, twoSided: next }));
                  setPortals([...portalsRef.current]);
                })} className="lab-touch-target w-full rounded-xl border border-white/10 bg-white/5 px-3 text-[9px] font-bold uppercase tracking-wider text-white/55 hover:bg-white/10">Apply {config.twoSided ? 'one-sided' : 'two-sided'} to all mouths</button>
              </div>
            )}
          </div>

          <div className="mt-4 rounded-xl border border-[#00a2ff]/20 bg-[#00a2ff]/5 p-3">
            <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-wider text-white/45"><span>Gravity coupling</span><span className="font-mono text-[#00a2ff]">FULL · CANONICAL</span></div>
            <p className="mt-1.5 text-[9px] leading-relaxed text-white/25">Matter sidedness and motion never silently change the reciprocal scalar-potential model.</p>
          </div>
        </div>

        {/* Main Spacetime Grid Visualization (Canvas) */}
        <div ref={containerRef} className="lab-canvas-panel lg:col-span-2 lg:row-span-2 bg-[#0a0a0c] border border-white/10 rounded-2xl relative overflow-hidden h-[65vh] lg:h-auto order-2 lg:order-none">
          <canvas
            ref={canvasRef}
            role="img"
            aria-label="Interactive portal simulation. Use the Selection inspector entity list for keyboard access."
            onPointerDown={handleStart}
            onPointerMove={handleMove}
            onPointerUp={handleEnd}
            onPointerCancel={handleEnd}
            className="w-full h-full cursor-crosshair block touch-none"
          />
          
          <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full border border-white/10 bg-black/75 p-1.5 backdrop-blur-md md:right-5 md:top-5">
            <button type="button" onClick={addBall} disabled={entityCount >= MAX_BALLS} className="lab-touch-target inline-flex items-center justify-center rounded-full text-white/65 hover:bg-white/10 hover:text-white disabled:opacity-25" title="Add probe" aria-label="Add probe"><Plus size={16} /></button>
            <button type="button" onClick={addPortalPair} className="lab-touch-target inline-flex items-center justify-center rounded-full text-white/65 hover:bg-white/10 hover:text-white" title="Add linked portal pair" aria-label="Add linked portal pair"><Link2 size={16} /></button>
            <button type="button" onClick={toggleLayout} className="lab-touch-target inline-flex items-center justify-center rounded-full text-white/65 hover:bg-white/10 hover:text-white" title="Cycle first-pair layout" aria-label="Cycle portal layout"><Layout size={16} /></button>
            <button type="button" onClick={() => runInstantEdit('Toggle vacuum', () => updateConfig({ vacuum: !configRef.current.vacuum }))} className={`lab-touch-target inline-flex items-center justify-center rounded-full hover:bg-white/10 ${config.vacuum ? 'text-[#ff9d00]' : 'text-white/35'}`} title="Toggle vacuum damping" aria-label="Toggle vacuum damping"><Wind size={16} /></button>
            <button type="button" onClick={reset} className="lab-touch-target inline-flex items-center justify-center rounded-full text-red-300/65 hover:bg-red-400/15 hover:text-red-300" title="Reset probes" aria-label="Reset probes"><Trash2 size={16} /></button>
          </div>

          <div className="absolute left-3 top-3 pointer-events-none md:left-5 md:top-5">
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/65 px-3 py-2 font-mono text-[9px] backdrop-blur-md md:text-[10px]">
              <span className={`h-2 w-2 rounded-full ${playing ? 'animate-pulse bg-emerald-400' : 'bg-[#ff9d00]'}`} />
              ENGINE <span className={playing ? 'text-emerald-400' : 'text-[#ff9d00]'}>{playing ? 'RUNNING' : 'PAUSED'}</span>
            </div>
          </div>

          <div className="absolute bottom-3 left-1/2 w-[calc(100%-1.5rem)] max-w-3xl -translate-x-1/2 md:bottom-5 md:w-[calc(100%-2.5rem)]">
            <TransportControls
              playing={playing}
              onToggle={togglePlayback}
              onStep={singleStep}
              onRewind={rewindTimeline}
              simTime={simTime}
              timelineIndex={timelineUi.index}
              timelineMax={timelineUi.max}
              onScrub={scrubTimeline}
              canUndo={historyUi.canUndo}
              canRedo={historyUi.canRedo}
              onUndo={undo}
              onRedo={redo}
            />
          </div>
        </div>

        {/* Heat Legend / Energy */}
        <div className="lg:col-span-1 lg:row-span-2 bg-[#0f0f19] border border-white/10 rounded-2xl p-4 flex min-h-0 flex-col order-6 lg:order-none relative">
          <div className="mb-3 flex items-center justify-between px-1">
            <div className="text-white/40 text-xs font-bold tracking-widest uppercase flex items-center gap-2"><Activity size={13} className="text-[#ff9d00]" />Observation desk</div>
            <span className="font-mono text-[9px] text-white/25">{events.length} events</span>
          </div>
          <div className="mb-3 grid grid-cols-3 gap-1 rounded-xl border border-white/[0.07] bg-black/25 p-1">
            {([
              ['inspector', 'Tools'],
              ['events', 'Events'],
              ['energy', 'Energy'],
            ] as const).map(([tab, label]) => (
              <button key={tab} type="button" onClick={() => setObservationTab(tab)} className={`min-h-11 min-w-0 overflow-hidden rounded-lg text-[8px] font-bold uppercase tracking-[0.06em] transition-colors ${observationTab === tab ? 'bg-white/10 text-white' : 'text-white/30 hover:bg-white/5 hover:text-white/60'}`}>{label}</button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            {observationTab === 'events' ? (
              <EventLogPanel events={events} selectedId={selectedEventId} onSelect={id => setSelectedEventId(current => current === id ? null : id)} onClear={() => { setEvents([]); setSelectedEventId(null); eventMarkersRef.current = []; }} />
            ) : observationTab === 'energy' ? (
              <div className="lab-scroll-area h-full overflow-y-auto">
                <EnergyChart samples={energySamples} kinetic={energyNow.kinetic} potential={energyNow.potential} total={energyNow.total} drift={energyNow.drift} />
                <div className="mx-1 mt-3 rounded-xl border border-[#ff9d00]/20 bg-[#ff9d00]/5 p-3">
                  <div className="flex items-center justify-between gap-3 text-[9px] font-bold uppercase tracking-wider text-white/45"><span>Moving-contact ΔK</span><span className="font-mono text-[#ffbd55]">{actuatorWork.toExponential(3)}</span></div>
                  <p className="mt-1.5 text-[9px] leading-relaxed text-white/25">Net body kinetic-energy change at moving-mouth contacts. This observable can include restitution loss; it is not presented as a complete actuator-work proof.</p>
                </div>
              </div>
            ) : (
              <div className="lab-scroll-area h-full space-y-4 overflow-y-auto px-1 pb-2">
                <div className="grid grid-cols-2 gap-2">
                  {([
                    ['Velocity', 'showVelocityVectors'],
                    ['Gravity', 'showAccelerationVectors'],
                    ['Portal frames', 'showPortalFrames'],
                    ['Clearance', 'showClearance'],
                    ['Grid', 'showGrid'],
                    ['Field arrows', 'showFlow'],
                    ['Heatmap', 'showHeatmap'],
                    ['Streamlines', 'showStreamlines'],
                    ['Debug axes', 'debugOverlay'],
                  ] as const).map(([label, key]) => (
                    <button key={key} type="button" aria-pressed={config[key]} onClick={() => runInstantEdit(`Toggle ${label}`, () => updateConfig({ [key]: !configRef.current[key] }), { resetEnergy: false, resetTimeline: false })} className={`lab-touch-target rounded-xl border text-[9px] font-bold uppercase tracking-wider transition-colors ${config[key] ? 'border-[#00a2ff]/45 bg-[#00a2ff]/12 text-[#67c7ff]' : 'border-white/10 bg-white/[0.03] text-white/30 hover:bg-white/[0.07]'}`}>{label}</button>
                  ))}
                </div>

                <div className="space-y-2 border-t border-white/[0.07] pt-4">
                  <div className="flex justify-between text-[9px] font-bold uppercase tracking-wider text-white/35"><span>Trail intensity</span><span>{config.trailIntensity.toFixed(1)}×</span></div>
                  <input aria-label="Trail intensity" type="range" min="0" max="3" step="0.1" value={config.trailIntensity} onPointerDown={() => beginHistoryTransaction('Change trails', { resetEnergy: false, resetTimeline: false })} onFocus={() => beginHistoryTransaction('Change trails', { resetEnergy: false, resetTimeline: false })} onPointerUp={finishHistoryTransaction} onBlur={finishHistoryTransaction} onChange={event => updateConfig({ trailIntensity: Number(event.target.value) })} className="w-full" />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-[9px] font-bold uppercase tracking-wider text-white/35"><span>Grid warp</span><span>{config.gridIntensity}px</span></div>
                  <input aria-label="Grid warp" type="range" min="0" max="100" step="5" value={config.gridIntensity} onPointerDown={() => beginHistoryTransaction('Change grid warp', { resetEnergy: false, resetTimeline: false })} onFocus={() => beginHistoryTransaction('Change grid warp', { resetEnergy: false, resetTimeline: false })} onPointerUp={finishHistoryTransaction} onBlur={finishHistoryTransaction} onChange={event => updateConfig({ gridIntensity: Number(event.target.value) })} className="w-full" />
                </div>
                {config.showFlow && (
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-[8px] font-bold uppercase tracking-wider text-white/30">Flow density<input type="number" min="8" max="30" value={config.flowDensity} onFocus={() => beginHistoryTransaction('Change flow density', { resetEnergy: false, resetTimeline: false })} onBlur={finishHistoryTransaction} onChange={event => updateConfig({ flowDensity: Number(event.target.value) })} className="mt-1 min-h-11 w-full rounded-lg border border-white/10 bg-black/30 px-2 font-mono text-[11px] text-white" /></label>
                    <label className="text-[8px] font-bold uppercase tracking-wider text-white/30">Arrow scale<input type="number" min="0.5" max="2.5" step="0.1" value={config.flowScale} onFocus={() => beginHistoryTransaction('Change arrow scale', { resetEnergy: false, resetTimeline: false })} onBlur={finishHistoryTransaction} onChange={event => updateConfig({ flowScale: Number(event.target.value) })} className="mt-1 min-h-11 w-full rounded-lg border border-white/10 bg-black/30 px-2 font-mono text-[11px] text-white" /></label>
                  </div>
                )}

                <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3 text-[9px] leading-relaxed text-white/30"><span className="text-cyan-300">Cyan</span> arrows show velocity. <span className="text-amber-300">Amber</span> arrows show sampled acceleration. Expanding event rings mark traversal, rim, and rear-plate contacts.</div>
                <button type="button" onClick={flushBuffer} disabled={entityCount === 0} className="lab-touch-target w-full rounded-xl border border-red-400/15 bg-red-400/5 text-[9px] font-bold uppercase tracking-wider text-red-300/55 hover:bg-red-400/10 disabled:opacity-25">Remove all probes</button>
              </div>
            )}
          </div>
        </div>

      </div>

      <TheoryOverlay open={showHelp} onClose={() => setShowHelp(false)} />
      <ExperimentLibrary open={showExperiments} onClose={() => setShowExperiments(false)} experiments={experimentCards} onLoad={handleLoadExperimentCard} onSurprise={handleSurprise} />
      <SnapshotPanel open={showSnapshots} onClose={() => setShowSnapshots(false)} snapshots={savedSnapshots} onSave={saveSnapshot} onRestore={restoreSnapshot} onDelete={deleteSnapshot} onShare={shareSnapshot} />

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-[200] -translate-x-1/2 rounded-full border border-white/15 bg-black/90 px-4 py-2.5 text-xs text-white/80 shadow-2xl backdrop-blur-xl" role="status">
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      
    </div>
  );
}
