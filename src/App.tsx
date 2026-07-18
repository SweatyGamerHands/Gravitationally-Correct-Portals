/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Settings2,
  Trash2,
  Plus,
  Layout,
  Info,
  Wind,
  Zap,
  Maximize2,
  ChevronRight,
} from 'lucide-react';
import {
  FIXED_TIMESTEP,
  DEFAULT_TWO_SIDED,
  MAX_BALLS,
  MAX_ACCUMULATED_TIME,
  PORTAL_EDGE_RADIUS,
  computeGravityAt,
  findAvailableBallSpawn,
  getBaselineG,
  getPortalLocal,
  getScaledFrameDt,
  movePortalForEditor,
  resolveMovingPortalSweeps,
  syncPinnedBallToPointer,
  type DragState,
} from './simulation/physics';
import { Ball } from './simulation/Ball';
import { withPortalVectors, type Point, type Portal } from './simulation/types';
import { rk4FieldStep } from './simulation/visualization';

// --- Constants & Types ---
const DEFAULT_SUBSTEPS = 12; 
const GRID_RES = 30;
const MAX_GRID_WARP_RADIUS = 28;
const GRID_BREAK_MULTIPLIER = 2.5;

const HelpTooltip = ({ text }: { text: string }) => {
  const [show, setShow] = useState(false);
  return (
    <div className="relative inline-flex items-center ml-1">
      <button 
        tabIndex={-1}
        onClick={(e) => { e.stopPropagation(); setShow(!show); }}
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        className="p-1 -m-1 text-white/20 hover:text-[#00a2ff] transition-colors focus:outline-none"
      >
        <Info size={12} />
      </button>
      <AnimatePresence>
        {show && (
          <motion.div 
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-32 md:w-56 bg-black/95 backdrop-blur-xl border border-white/20 p-2.5 rounded-xl text-[9px] md:text-[11px] text-white leading-relaxed pointer-events-none z-[1000] shadow-2xl ring-1 ring-white/10"
          >
            {text}
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-8 border-transparent border-t-black/95"></div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// --- Main Component ---
export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const objectsRef = useRef<Ball[]>([]);
  const [entityCount, setEntityCount] = useState(0);
  const [portals, setPortals] = useState<Portal[]>([]);
  const [fps, setFps] = useState(0);
  const [config, setConfig] = useState({
    gravity: 1.0,
    friction: 0.994,
    elasticity: 0.55,
    timeScale: 1.0,
    gridIntensity: 20,
    trailIntensity: 1.0,
    size: 15,
    mass: 20,
    substeps: DEFAULT_SUBSTEPS,
    correctGravity: true,
    vacuum: false,
    showGrid: true,
    showFlow: true,
    showStreamlines: true,
    showHeatmap: true,
    debugOverlay: false,
    flowDensity: 15,
    flowScale: 1.0,
    showHelp: false,
    portalWidth: 100,
    portalPull: 1.0,
    twoSided: DEFAULT_TWO_SIDED
  });
  const configRef = useRef(config);
  const portalsRef = useRef(portals);
  
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
    configRef.current = config;
  }, [config]);

  useEffect(() => {
    portalsRef.current = portals;
  }, [portals]);

  const initializeScene = useCallback((width: number, height: number) => {
    // Mark initialization synchronously before mutating refs or scheduling React state.
    initializedRef.current = true;

    const cx = width / 2;
    const cy = height / 2;
    const initialPortals: Portal[] = [
      { id: 'orange', x: cx - width * 0.15, y: cy + height * 0.1, angle: -0.6, color: '#ff9d00', width: initialPortalWidthRef.current, dir: {x:0,y:0}, normal: {x:0,y:0}, handle: {x:0,y:0} },
      { id: 'blue', x: cx + width * 0.15, y: cy - height * 0.1, angle: 2.5, color: '#00a2ff', width: initialPortalWidthRef.current, dir: {x:0,y:0}, normal: {x:0,y:0}, handle: {x:0,y:0} }
    ];

    const initializedPortals = initialPortals.map(withPortalVectors);
    objectsRef.current = [new Ball(width / 2, 100, 15, 20)];
    portalsRef.current = initializedPortals;
    setEntityCount(objectsRef.current.length);
    setPortals(initializedPortals);
  }, []);

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
          setPortals(prev => {
            const updated = prev.map(portal => withPortalVectors({
              ...portal,
              x: portal.x * scaleX,
              y: portal.y * scaleY,
            }));
            portalsRef.current = updated;
            return updated;
          });

          if (dragStateRef.current.type !== 'ball') {
            objectsRef.current.forEach(obj => {
              obj.x *= scaleX;
              obj.y *= scaleY;
              obj.oldX *= scaleX;
              obj.oldY *= scaleY;
              obj.trail = obj.trail.map(point => ({ x: point.x * scaleX, y: point.y * scaleY }));
            });
          }

          lastPos.current = { x: lastPos.current.x * scaleX, y: lastPos.current.y * scaleY };
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
          const dist = Math.sqrt(distSq) || 0.1;
          const overlap = (minDist - dist);
          const nx = dx / dist;
          const ny = dy / dist;
          
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

  // Game Loop
  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    let animationId: number;

    const render = (time: number) => {
      const config = configRef.current;
      const portals = portalsRef.current;
      const objects = objectsRef.current;

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
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.fillStyle = '#0a0a0c';
      ctx.fillRect(0, 0, w, h);

      if (config.showHeatmap) drawHeatmap(ctx, w, h, portals);

      if (config.showGrid) {
        drawGrid(ctx, w, h, portals);
      }
      if (config.showStreamlines) drawStreamlines(ctx, w, h, portals);
      
      if (config.showFlow) {
        drawFlow(ctx, w, h, portals);
      }

      const friction = config.vacuum ? 1.0 : config.friction;
      const bounce = config.elasticity;
      
      // Calculate proper timestep based on actual frame performance
      const realFrameDt = (time - prevTime.current) / 1000;
      prevTime.current = time;
      const scaledFrameDt = getScaledFrameDt(realFrameDt, config.timeScale, MAX_ACCUMULATED_TIME);
      accumulatorRef.current = Math.min(MAX_ACCUMULATED_TIME, accumulatorRef.current + scaledFrameDt);
      const dt = FIXED_TIMESTEP / Math.max(1, config.substeps);

      // Update pinned ball position BEFORE fixed steps so collisions reflect actual pointer location.
      const pinnedIdx = syncPinnedBallToPointer(objectsRef.current, dragStateRef.current, lastPos.current, Math.max(scaledFrameDt, dt));

      while (accumulatorRef.current >= FIXED_TIMESTEP) {
        for (let s = 0; s < Math.max(1, config.substeps); s++) {
        objects.forEach((obj, index) => {
          // DRAG PINNING: Skip physics for the currently held ball
          if (index === pinnedIdx) return;

          // Pass 1: Integrated Motion and Crossing Check
          obj.update(
            friction, 
            (x, y) => getGravityAt(x, y, portals), 
            dt
          );
          obj.checkCrossing(portals, config.twoSided, bounce);
        });
        
        // Pass 2: Ball-Ball Collisions
        // Include all balls but pinned ball receives no displacement from collisions
        resolveCollisions(objects, bounce, pinnedIdx);

        // Pass 3: Final Constraint Pass (Statics)
        objects.forEach((obj, index) => {
          if (index === pinnedIdx) return;
          obj.constrain(w, h, portals, bounce, config.twoSided);
        });
        }
        accumulatorRef.current -= FIXED_TIMESTEP;
      }

      // Draw Portals
      portals.forEach(p => {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);

        // One-sided "Back Plate"
        if (!config.twoSided) {
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
      animationId = requestAnimationFrame(render);
    };

    animationId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationId);
  }, [drawDebugOverlay, drawFlow, drawGrid, drawHeatmap, drawStreamlines, getGravityAt, resolveCollisions]);

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
        updateDragState({ id: pt.id, type: 'handle' });
        lastPortalMotionTimestamp.current = e.timeStamp;
        return;
      }
    }

    const objects = objectsRef.current;
    for (let i = objects.length - 1; i >= 0; i--) {
      const obj = objects[i];
      if (Math.hypot(obj.x - p.x, obj.y - p.y) < obj.radius + 20) {
        updateDragState({ id: String(i), type: 'ball' });
        return;
      }
    }

    for (const pt of currentPortals) {
      if (Math.hypot(pt.x - p.x, pt.y - p.y) < 50) {
        updateDragState({ id: pt.id, type: 'portal' });
        lastPortalMotionTimestamp.current = e.timeStamp;
        return;
      }
    }
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
    resolveMovingPortalSweeps(objectsRef.current, previous, updated, {
      duration,
      twoSided: config.twoSided,
      bounce: config.elasticity,
    });
    lastPortalMotionTimestamp.current = timestamp;
    portalsRef.current = updated;
    setPortals(updated);
  }, []);

  const finishActiveDrag = useCallback(() => {
    lastPortalMotionTimestamp.current = null;
    updateDragState({ id: null, type: null });
  }, [updateDragState]);

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

  const addBall = () => {
    const w = canvasSizeRef.current.width || canvasRef.current?.clientWidth || 800;
    const h = canvasSizeRef.current.height || canvasRef.current?.clientHeight || 600;
    if (objectsRef.current.length >= MAX_BALLS) return;
    const spawn = findAvailableBallSpawn(objectsRef.current, w, h, config.size);
    if (!spawn) return;
    objectsRef.current.push(new Ball(spawn.x, spawn.y, config.size, config.mass));
    setEntityCount(objectsRef.current.length);
  };

  const reset = () => {
    const w = canvasSizeRef.current.width || canvasRef.current?.clientWidth || 800;
    objectsRef.current = [new Ball(w / 2, 100, config.size, config.mass)];
    setEntityCount(objectsRef.current.length);
  };

  const flushBuffer = () => {
    objectsRef.current = [];
    setEntityCount(objectsRef.current.length);
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
    const p1 = { ...current[0], x: l.p1.x, y: l.p1.y, angle: l.p1.a };
    const p2 = { ...current[1], x: l.p2.x, y: l.p2.y, angle: l.p2.a };
    const updated = [withPortalVectors(p1), withPortalVectors(p2)];
    const config = configRef.current;
    resolveMovingPortalSweeps(objectsRef.current, current, updated, {
      duration: 0.25,
      twoSided: config.twoSided,
      bounce: config.elasticity,
    });
    portalsRef.current = updated;
    setPortals(updated);
  };

  return (
    <div className="app-root bg-[#050508] text-white w-full min-h-screen p-4 md:p-6 font-sans overflow-x-hidden lg:overflow-hidden lg:h-screen lg:w-screen">
      <div className="flex flex-col lg:grid lg:grid-cols-4 lg:grid-rows-3 gap-4 lg:h-full">
        
        {/* Hero Card */}
        <div className="lg:col-span-2 lg:row-span-1 bg-[#0f0f19] border border-white/10 rounded-2xl p-6 flex flex-col justify-between relative group order-1">
          <button 
            onClick={() => setConfig(prev => ({ ...prev, showHelp: !prev.showHelp }))}
            className="absolute top-6 right-6 p-2 bg-white/5 border border-white/10 rounded-full hover:bg-white/10 transition-colors opacity-100 lg:opacity-0 group-hover:opacity-100"
            title="System Theory"
          >
            <Info size={16} />
          </button>
          <div>
            <div className="text-[#00a2ff] text-xs font-bold tracking-[0.2em] mb-2 uppercase">System Architecture</div>
            <h1 className="text-3xl md:text-4xl font-light leading-tight">Idealized Portal <br/><span className="font-bold italic">Field Sandbox</span></h1>
          </div>
          <p className="text-white/50 text-xs md:text-sm leading-relaxed max-w-md mt-4 lg:mt-0">
            An idealized Newtonian 2D sandbox: one canonical portal transform drives momentum, aperture-transported gravity, field arrows, heat, streamlines, and crossings.
          </p>
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
                type="range" min="0.1" max="2.0" step="0.1"
                value={config.timeScale}
                onChange={e => setConfig(prev => ({ ...prev, timeScale: parseFloat(e.target.value) }))}
                className="w-full accent-[#ff9d00] h-1"
              />
            </div>
            
            <div className="space-y-1">
              <div className="flex justify-between text-[8px] uppercase font-bold text-white/30">
                <span className="flex items-center">Integrator Precision <HelpTooltip text="Sub-steps per frame. Higher values prevent high-speed objects from passing through walls by calculating physics more frequently." /></span>
                <span>{config.substeps} steps</span>
              </div>
              <input 
                type="range" min="1" max="24" step="1"
                value={config.substeps}
                onChange={e => setConfig(prev => ({ ...prev, substeps: parseInt(e.target.value) }))}
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
                type="range" min="0.95" max="1.0" step="0.001"
                value={config.friction}
                onChange={e => setConfig(prev => ({ ...prev, friction: parseFloat(e.target.value) }))}
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
                  type="range" min="0.1" max="0.95" step="0.05"
                  value={config.elasticity}
                  onChange={e => setConfig(prev => ({ ...prev, elasticity: parseFloat(e.target.value) }))}
                  className="w-full accent-[#00a2ff] h-1"
                />
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-[8px] uppercase font-bold text-white/30">
                  <span className="flex items-center">Physical Gravity <HelpTooltip text="The single global downward acceleration multiplier applied to all sandbox entities." /></span>
                  <span>{config.gravity.toFixed(1)}x</span>
                </div>
                <input 
                  type="range" min="0" max="5" step="0.1"
                  value={config.gravity}
                  onChange={e => setConfig(prev => ({ ...prev, gravity: parseFloat(e.target.value) }))}
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
                  type="range" min="5" max="40" step="1"
                  value={config.size}
                  onChange={e => setConfig(prev => ({ ...prev, size: parseInt(e.target.value) }))}
                  className="w-full accent-white/20 h-1"
                />
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-[8px] uppercase font-bold text-white/30">
                  <span className="flex items-center">Launch Mass <HelpTooltip text="The physical mass used for momentum translation during collisions." /></span>
                  <span>{config.mass}Kg</span>
                </div>
                <input 
                  type="range" min="5" max="100" step="5"
                  value={config.mass}
                  onChange={e => setConfig(prev => ({ ...prev, mass: parseInt(e.target.value) }))}
                  className="w-full accent-white/20 h-1"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Portal Bridge Settings */}
        <div className="lg:col-span-1 lg:row-span-2 bg-[#0f0f19] border border-white/10 rounded-2xl p-6 flex flex-col order-5 lg:order-none relative">
          <div className="text-white/30 text-xs font-bold tracking-widest uppercase mb-6 flex items-center gap-2">
            <Maximize2 size={12} className="text-[#00a2ff]" />
            Portal Dynamics
          </div>
          
          <div className="space-y-6 flex-grow">
            <div className="space-y-2">
              <div className="flex justify-between text-[10px] uppercase font-bold text-white/50">
                <span className="flex items-center">Event Horizon <HelpTooltip text="The physical width of the spacetime aperture. Larger portals have a broader capture range." /></span>
                <span className="text-[#00a2ff]">{config.portalWidth}px</span>
              </div>
              <input 
                type="range" min="40" max="250" step="5"
                value={config.portalWidth}
                onChange={e => {
                  const val = parseInt(e.target.value);
                  setConfig(prev => ({ ...prev, portalWidth: val }));
                  const previous = portalsRef.current;
                  const updated = previous.map(portal => ({ ...portal, width: val }));
                  const config = configRef.current;
                  resolveMovingPortalSweeps(objectsRef.current, previous, updated, {
                    duration: 1 / 30,
                    twoSided: config.twoSided,
                    bounce: config.elasticity,
                  });
                  portalsRef.current = updated;
                  setPortals(updated);
                }}
                className="w-full accent-[#00a2ff] h-1"
              />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-[10px] uppercase font-bold text-white/50">
                <span className="flex items-center">Portal Gravity Leakage <HelpTooltip text="Portal-specific transmission coefficient. Determines how much of the linked side's ambient gravitational field leaks through this aperture." /></span>
                <span className="text-[#ff9d00]">{config.portalPull.toFixed(1)}x</span>
              </div>
              <input 
                type="range" min="0" max="3" step="0.1"
                value={config.portalPull}
                onChange={e => setConfig(prev => ({ ...prev, portalPull: parseFloat(e.target.value) }))}
                className="w-full accent-[#ff9d00] h-1"
              />
            </div>

            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between group">
                <span className="text-[10px] uppercase font-bold text-white/50 group-hover:text-white transition-colors flex items-center">
                  Two-Sided Entry <HelpTooltip text="If ON, objects can enter from either side. If OFF, the white handle and colored arrow mark the permitted front-entry side; the hatched plate is solid." />
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={config.twoSided}
                  aria-label="Toggle two-sided portal entry"
                  className={`w-8 h-4 rounded-full transition-colors relative ${config.twoSided ? 'bg-[#00a2ff]' : 'bg-white/10'}`}
                  onClick={() => setConfig(prev => ({ ...prev, twoSided: !prev.twoSided }))}
                >
                  <div className={`absolute top-1 w-2 h-2 rounded-full transition-all ${config.twoSided ? 'left-5 bg-white' : 'left-1 bg-white/40'}`} />
                </button>
              </div>
              <p className="text-[9px] text-white/20 italic leading-tight">
                {config.twoSided ? "Objects can enter and exit from both sides." : "Arrow + white handle = entry side; hatching = solid back."}
              </p>
            </div>
          </div>

          <div className="mt-8 p-3 bg-black/40 rounded-xl border border-white/5">
            <div className="text-[9px] text-white/40 uppercase mb-2">Topology Status</div>
            <div className="flex justify-between items-center">
              <div className="text-[10px] font-mono text-[#00a2ff]">Stable</div>
              <div className="flex gap-1">
                {[1,2,3].map(i => <div key={i} className="w-1 h-3 bg-[#00a2ff]/40 rounded-full animate-pulse" style={{ animationDelay: `${i*0.2}s` }} />)}
              </div>
            </div>
          </div>
        </div>

        {/* Main Spacetime Grid Visualization (Canvas) */}
        <div ref={containerRef} className="lg:col-span-2 lg:row-span-2 bg-[#0a0a0c] border border-white/10 rounded-2xl relative overflow-hidden h-[65vh] lg:h-auto order-2 lg:order-none">
          <canvas
            ref={canvasRef}
            onPointerDown={handleStart}
            onPointerMove={handleMove}
            onPointerUp={handleEnd}
            onPointerCancel={handleEnd}
            className="w-full h-full cursor-crosshair block touch-none"
          />
          
          {/* Controls Overlay in Canvas */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex flex-wrap justify-center items-center gap-2 md:gap-4 bg-black/80 backdrop-blur-md border border-white/10 px-4 md:px-6 py-2 md:py-3 rounded-[32px] pointer-events-auto max-w-[90%] md:max-w-none w-max">
            <div className="flex items-center gap-2 md:gap-4 border-r border-white/10 pr-2 md:pr-4">
              <button 
                onClick={addBall}
                disabled={entityCount >= MAX_BALLS}
                aria-label="Add ball"
                className="p-2 hover:bg-white/10 rounded-full transition-colors disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                title={entityCount >= MAX_BALLS ? `Ball limit reached (${MAX_BALLS})` : "Add Ball"}
              >
                <Plus size={16} className="md:w-[18px] md:h-[18px]" />
              </button>
              <button 
                onClick={toggleLayout}
                className="p-2 hover:bg-white/10 rounded-full transition-colors" title="Toggle Layout"
              >
                <Layout size={16} className="md:w-[18px] md:h-[18px]" />
              </button>
              <button 
                onClick={reset}
                className="p-2 hover:bg-red-500/20 text-red-500 rounded-full transition-colors" title="Reset Scene"
              >
                <Trash2 size={16} className="md:w-[18px] md:h-[18px]" />
              </button>
            </div>
            
            <div className="flex items-center gap-2 md:gap-4 border-r border-white/10 pr-2 md:pr-4">
              <div className="relative">
                <button 
                  onClick={() => setConfig(prev => ({ ...prev, correctGravity: !prev.correctGravity }))}
                  className={`p-2 rounded-full transition-colors ${config.correctGravity ? 'text-[#00a2ff]' : 'text-neutral-500'}`}
                >
                  <Zap size={16} className="md:w-[18px] md:h-[18px]" />
                </button>
                <HelpTooltip text="Toggles portal frame-transfer: linked-side gravity is transmitted and reoriented through apertures. This does not change the global gravity strength." />
              </div>

              <div className="relative">
                <button 
                  onClick={() => setConfig(prev => ({ ...prev, vacuum: !prev.vacuum }))}
                  className={`p-2 rounded-full transition-colors ${config.vacuum ? 'text-orange-500' : 'text-neutral-500'}`}
                >
                  <Wind size={16} className="md:w-[18px] md:h-[18px]" />
                </button>
                <HelpTooltip text="Vacuum disables air damping for infinite momentum loops. Baseline gravity strength stays controlled by the Physical Gravity slider." />
              </div>
            </div>

          </div>

          <div className="absolute top-4 left-4 md:top-6 md:left-6 pointer-events-none">
            <div className="bg-black/60 backdrop-blur-md border border-white/10 px-2 md:px-3 py-1 rounded-full text-[9px] md:text-[10px] font-mono">
              ENGINE <span className="text-green-500 ml-1">ON</span>
            </div>
          </div>
        </div>

        {/* Heat Legend / Energy */}
        <div className="lg:col-span-1 lg:row-span-2 bg-[#0f0f19] border border-white/10 rounded-2xl p-6 flex flex-col order-6 lg:order-none relative">
          <div className="text-white/30 text-xs font-bold tracking-widest uppercase mb-6 text-center lg:text-left flex items-center justify-between">
            Visual Feedback
            <ChevronRight size={14} className="opacity-30" />
          </div>
          
          <div className="space-y-6 flex-grow">
            <div className="space-y-2">
              <div className="flex justify-between text-[10px] uppercase font-bold text-white/50">
                <span className="flex items-center">Trail Intensity <HelpTooltip text="Brightness and persistence of speed-based chromatic trails." /></span>
                <span className="text-white">{config.trailIntensity.toFixed(1)}x</span>
              </div>
              <input 
                type="range" min="0" max="3" step="0.1"
                value={config.trailIntensity}
                onChange={e => setConfig(prev => ({ ...prev, trailIntensity: parseFloat(e.target.value) }))}
                className="w-full accent-white/50 h-1"
              />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-[10px] uppercase font-bold text-white/50">
                <span className="flex items-center">Grid Warp <HelpTooltip text="Visual sensitivity of the background spacetime fabric to local gravity." /></span>
                <span className="text-white">{config.gridIntensity}px</span>
              </div>
              <input 
                type="range" min="0" max="100" step="5"
                value={config.gridIntensity}
                onChange={e => setConfig(prev => ({ ...prev, gridIntensity: parseInt(e.target.value) }))}
                className="w-full accent-white/50 h-1"
              />
            </div>

            <div className="pt-4 border-t border-white/5 space-y-4">
              <label className="flex items-center justify-between cursor-pointer group">
                <span className="text-[10px] uppercase font-bold text-white/50 group-hover:text-white transition-colors flex items-center">
                  Field Flow Arrows <HelpTooltip text="Overlays the underlying gravitational force vectors as a grid of flowing arrows." />
                </span>
                <div 
                  className={`w-8 h-4 rounded-full transition-colors relative ${config.showFlow ? 'bg-[#00a2ff]' : 'bg-white/10'}`}
                  onClick={() => setConfig(prev => ({ ...prev, showFlow: !prev.showFlow }))}
                >
                  <div className={`absolute top-1 w-2 h-2 rounded-full transition-all ${config.showFlow ? 'left-5 bg-white' : 'left-1 bg-white/40'}`} />
                </div>
              </label>

              <div className="grid grid-cols-3 gap-2 pt-2">
                {[
                  ['Heat', 'showHeatmap'],
                  ['Lines', 'showStreamlines'],
                  ['Debug', 'debugOverlay'],
                ].map(([label, key]) => (
                  <button
                    key={key}
                    onClick={() => setConfig(prev => ({ ...prev, [key]: !prev[key as keyof typeof prev] }))}
                    className={`min-h-11 rounded-xl border text-[9px] uppercase font-bold transition-colors ${config[key as keyof typeof config] ? 'border-[#00a2ff]/60 bg-[#00a2ff]/15 text-[#00a2ff]' : 'border-white/10 bg-white/5 text-white/35'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {config.showFlow && (
                <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="space-y-2">
                    <div className="flex justify-between text-[10px] uppercase font-bold text-white/30">
                      <span className="flex items-center">Flow Density <HelpTooltip text="The resolution or frequency of arrows in the vector field." /></span>
                      <span className="text-white/60">{config.flowDensity}</span>
                    </div>
                    <input 
                      type="range" min="8" max="30" step="1"
                      value={config.flowDensity}
                      onChange={e => setConfig(prev => ({ ...prev, flowDensity: parseInt(e.target.value) }))}
                      className="w-full accent-[#00a2ff]/50 h-1"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-[10px] uppercase font-bold text-white/30">
                      <span className="flex items-center">Arrow Scale <HelpTooltip text="The physical size multiplier for the flow indicators." /></span>
                      <span className="text-white/60">{config.flowScale.toFixed(1)}x</span>
                    </div>
                    <input 
                      type="range" min="0.5" max="2.5" step="0.1"
                      value={config.flowScale}
                      onChange={e => setConfig(prev => ({ ...prev, flowScale: parseFloat(e.target.value) }))}
                      className="w-full accent-[#00a2ff]/50 h-1"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="pt-4 space-y-3 border-t border-white/5">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-white shadow-[0_0_8px_white]"></div>
                <div className="text-[9px] text-white/60 font-mono tracking-tight lowercase">critical phase</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-[#00a2ff]"></div>
                <div className="text-[9px] text-white/60 font-mono tracking-tight lowercase">hyper-state</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-blue-900 border border-white/10"></div>
                <div className="text-[9px] text-white/60 font-mono tracking-tight lowercase">ground state</div>
              </div>
            </div>
          </div>

          <div className="pt-4 flex justify-between items-center mt-auto">
            <button 
              onClick={flushBuffer}
              className="text-[9px] uppercase font-bold text-red-500/50 hover:text-red-500 transition-colors tracking-widest"
            >
              Flush Buffer
            </button>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.5)]"></div>
              <div className="text-[9px] uppercase font-bold text-green-500 tracking-widest">Active</div>
            </div>
          </div>
        </div>

      </div>

      {/* Theory Overlay */}
      <AnimatePresence>
        {config.showHelp && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 flex items-center justify-center p-4 md:p-6 z-[100] bg-black/80 backdrop-blur-xl"
            style={{ position: 'fixed' }}
          >
            <div className="max-w-2xl w-full bg-[#0a0a0f] border border-white/10 rounded-[24px] md:rounded-[40px] p-6 md:p-10 overflow-y-auto max-h-[85vh] shadow-2xl relative">
              <button 
                onClick={() => setConfig(prev => ({ ...prev, showHelp: false }))}
                className="absolute top-4 right-4 md:top-6 md:right-8 text-neutral-500 hover:text-white"
              >
                Close
              </button>

              <h2 className="text-2xl md:text-3xl font-serif italic text-white mb-6 md:mb-8 pr-12">Physics Architecture</h2>
              
              <div className="space-y-6 md:space-y-8 text-sm leading-relaxed text-neutral-400">
                <section>
                  <h3 className="text-[#00a2ff] uppercase text-[10px] font-bold tracking-[0.2em] mb-2 md:mb-3">01. Fixed-Step Integration</h3>
                  <p>
                    This simulation uses <b>fixed-step semi-implicit Euler integration</b> with explicit velocity state. 
                    It advances velocity from the sampled acceleration, then advances position in fixed-size simulation quanta. 
                    This keeps frame-rate variation out of body motion while retaining explicit velocity for collisions.
                  </p>
                </section>

                <section>
                  <h3 className="text-[#00a2ff] uppercase text-[10px] font-bold tracking-[0.2em] mb-2 md:mb-3">02. Gravitational Transmission</h3>
                  <p>
                    Portal pairs act as a bridge for the ambient gravitational field. Gravity is sampled from the linked side, 
                    transformed into the local basis of the entry aperture, and re-emitted. This creates a continuous, reoriented 
                    field through the wormhole.
                  </p>
                </section>

                <section>
                  <h3 className="text-[#00a2ff] uppercase text-[10px] font-bold tracking-[0.2em] mb-2 md:mb-3">03. Spacetime Curvature</h3>
                  <p>
                    The background grid isn't just decoration—it's a <b>deformation map</b>. Each node in the grid calculates 
                    the local acceleration field and shifts its position accordingly.
                  </p>
                </section>

                <section>
                  <h3 className="text-[#00a2ff] uppercase text-[10px] font-bold tracking-[0.2em] mb-2 md:mb-3">04. Interaction</h3>
                  <ul className="list-disc list-inside space-y-1 md:space-y-2">
                    <li><b>Drag</b> a portal to move the aperture physically through the scene. Its swept mouth can teleport balls, while its solid rim and one-sided back can impart momentum.</li>
                    <li><b>Rotate</b> via the white handle to change the exit trajectory.</li>
                    <li><b>Vacuum Mode</b> removes air damping only, allowing balls to preserve momentum in a vertical loop while gravity strength remains unchanged.</li>
                  </ul>
                </section>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      
    </div>
  );
}
