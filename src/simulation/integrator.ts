import type { Point } from './types';
import { MAX_FRAME_DT } from './constants';
export const getScaledFrameDt = (realFrameDt: number, timeScale: number, maxFrameDt = MAX_FRAME_DT) => Math.min(maxFrameDt, Math.max(0, realFrameDt)) * timeScale;
export const integrateVelocity = (velocity: Point, acceleration: Point, friction: number, dt: number): Point => { const f = Math.pow(friction, dt * 60); return { x: velocity.x * f + acceleration.x * dt, y: velocity.y * f + acceleration.y * dt }; };
export const integratePosition = (position: Point, velocity: Point, dt: number): Point => ({ x: position.x + velocity.x * dt, y: position.y + velocity.y * dt });
export const simulateLinearDisplacement = (velocity: Point, realElapsedSeconds: number, timeScale: number): Point => ({ x: velocity.x * realElapsedSeconds * timeScale, y: velocity.y * realElapsedSeconds * timeScale });
export type DragState = { id: string | null; type: 'ball' | 'portal' | 'handle' | null };
type Body = { x: number; y: number; oldX: number; oldY: number; vx?: number; vy?: number };
export const getPinnedBallIndex = (dragState: DragState): number => { if (dragState.type !== 'ball' || dragState.id === null) return -1; const n = Number(dragState.id); return Number.isInteger(n) && n >= 0 ? n : -1; };
export const syncPinnedBallToPointer = <T extends Body>(bodies: T[], dragState: DragState, pointer: Point, frameDt?: number): number => { const i = getPinnedBallIndex(dragState); const b = bodies[i]; if (!b) return -1; const px = b.x; const py = b.y; b.oldX = px; b.oldY = py; b.x = pointer.x; b.y = pointer.y; if (frameDt && frameDt > 0 && b.vx !== undefined && b.vy !== undefined) { b.vx = (b.x - px) / frameDt; b.vy = (b.y - py) / frameDt; } return i; };

export type PointerHistorySample = Point & { time: number };
const MAX_POINTER_HISTORY_MS = 180;
const RELEASE_INTERVAL_MS = 45;
const MAX_RELEASE_SPEED = 2600;

export function recordPointerHistory(history: PointerHistorySample[], point: Point, time: number, maxAgeMs = MAX_POINTER_HISTORY_MS) {
  history.push({ ...point, time });
  const cutoff = time - maxAgeMs;
  while (history.length > 1 && history[0].time < cutoff) history.shift();
}

export function computePointerReleaseVelocity(history: PointerHistorySample[], releaseTime = history.at(-1)?.time ?? 0, minIntervalMs = RELEASE_INTERVAL_MS, maxSpeed = MAX_RELEASE_SPEED): Point {
  if (history.length < 2) return { x: 0, y: 0 };
  const latest = history[history.length - 1];
  let anchor = history[0];
  for (let i = history.length - 2; i >= 0; i--) {
    anchor = history[i];
    if (releaseTime - anchor.time >= minIntervalMs) break;
  }
  const dt = Math.max(1e-3, (latest.time - anchor.time) / 1000);
  let vx = (latest.x - anchor.x) / dt;
  let vy = (latest.y - anchor.y) / dt;
  const speed = Math.hypot(vx, vy);
  if (speed < 12) return { x: 0, y: 0 };
  if (speed > maxSpeed) { vx *= maxSpeed / speed; vy *= maxSpeed / speed; }
  return { x: vx, y: vy };
}

export function applyPointerReleaseVelocity<T extends Body>(bodies: T[], dragState: DragState, history: PointerHistorySample[], canceled = false, releaseTime = history.at(-1)?.time ?? 0): number {
  const i = getPinnedBallIndex(dragState);
  const b = bodies[i];
  if (!b || b.vx === undefined || b.vy === undefined) return -1;
  if (canceled) {
    b.vx = 0;
    b.vy = 0;
  } else {
    const v = computePointerReleaseVelocity(history, releaseTime);
    b.vx = v.x;
    b.vy = v.y;
  }
  b.oldX = b.x;
  b.oldY = b.y;
  return i;
}
