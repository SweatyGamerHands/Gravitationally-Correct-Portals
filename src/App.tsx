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
  HelpCircle
} from 'lucide-react';
import { computeGravityAt, getBaselineG, syncPinnedBallToPointer, type DragState } from './simulation/physics';
import { withPortalVectors, type Portal } from './simulation/types';

// --- Constants & Types ---
const DEFAULT_SUBSTEPS = 12; 
const GRID_RES = 30;
const MAX_TRAIL = 80;

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

type Point = { x: number; y: number };

class Ball {
  x: number;
  y: number;
  oldX: number;
  oldY: number;
  radius: number;
  mass: number;
  cooldown: number;
  color: string;
  trail: Point[];

  constructor(x: number, y: number, r: number, m: number) {
    this.x = x;
    this.y = y;
    this.oldX = x;
    this.oldY = y;
    this.radius = r;
    this.mass = m;
    this.cooldown = 0;
    this.color = `hsl(${Math.random() * 60 + 190}, 90%, 65%)`;
    this.trail = [];
  }

  update(
    friction: number, 
    gravityFn: (x: number, y: number) => Point, 
    dt: number
  ) {
    const vx = (this.x - this.oldX);
    const vy = (this.y - this.oldY);
    const g = gravityFn(this.x, this.y);

    this.oldX = this.x;
    this.oldY = this.y;
    
    // Strict Verlet Integration using absolute seconds
    const frictionSub = Math.pow(friction, dt * 60); 
    this.x += vx * frictionSub + g.x * dt * dt; 
    this.y += vy * frictionSub + g.y * dt * dt;

    if (this.cooldown > 0) this.cooldown--;
    
    if (Math.random() > 0.8) {
      this.trail.push({ x: this.x, y: this.y });
      if (this.trail.length > MAX_TRAIL) this.trail.shift();
    }
  }

  checkCrossing(portals: Portal[], twoSided: boolean, bounce: number) {
    for (let i = 0; i < 2; i++) {
        const p1 = portals[i];
        const p2 = portals[(i+1)%2];
        
        const dotPrev = (this.oldX - p1.x) * p1.normal.x + (this.oldY - p1.y) * p1.normal.y;
        const dotCurr = (this.x - p1.x) * p1.normal.x + (this.y - p1.y) * p1.normal.y;
        
        if (Math.sign(dotPrev) !== Math.sign(dotCurr)) {
            const t = Math.abs(dotPrev) / (Math.abs(dotPrev) + Math.abs(dotCurr));
            const interX = this.oldX + (this.x - this.oldX) * t;
            const interY = this.oldY + (this.y - this.oldY) * t;
            const distAlong = (interX - p1.x) * p1.dir.x + (interY - p1.y) * p1.dir.y;
            
            // Check if crossing happens strictly WITHIN the visible aperture geometry
            if (Math.abs(distAlong) <= p1.width / 2) {
                const fromFront = dotPrev > 0;
                if (this.cooldown > 0) continue;

                if (twoSided || fromFront) {
                    this.teleport(p1, p2, interX, interY);
                    return;
                } else {
                    // One-sided portal crossing: Blocked-face Impact (Rebound)
                    this.blockedFaceImpact(p1, dotPrev);
                    return;
                }
            }
        }
    }
  }

  constrain(width: number, height: number, portals: Portal[], bounce: number, twoSided: boolean) {
    // 1. Boundaries
    const margin = this.radius;
    if (this.y > height - margin) { this.y = height - margin; this.oldY = this.y + (this.y - this.oldY) * bounce; }
    if (this.x < margin) { this.x = margin; this.oldX = this.x + (this.x - this.oldX) * bounce; }
    if (this.x > width - margin) { this.x = width - margin; this.oldX = this.x + (this.x - this.oldX) * bounce; }
    if (this.y < margin) { this.y = margin; this.oldY = this.y + (this.y - this.oldY) * bounce; }

    // 2. Portal Statics (Endcaps and Persistent Blocked-Face Support)
    for (const p1 of portals) {
        const tipDist = p1.width / 2;
        const tips = [
          { x: p1.x + p1.dir.x * tipDist, y: p1.y + p1.dir.y * tipDist },
          { x: p1.x - p1.dir.x * tipDist, y: p1.y - p1.dir.y * tipDist }
        ];

        for (const tip of tips) {
          const dx = this.x - tip.x; const dy = this.y - tip.y;
          const distSq = dx * dx + dy * dy;
          const minDist = this.radius + 1; 
          if (distSq < minDist * minDist) {
            const dist = Math.sqrt(distSq) || 0.1;
            const nx = dx / dist; const ny = dy / dist;
            const overlap = minDist - dist;
            this.x += nx * overlap; this.y += ny * overlap;
            const vx = this.x - this.oldX; const vy = this.y - this.oldY;
            const dot = vx * nx + vy * ny;
            if (dot < 0) {
              const rx = vx - 2 * dot * nx; const ry = vy - 2 * dot * ny;
              this.oldX = this.x - rx * bounce; this.oldY = this.y - ry * bounce;
            } else {
               this.oldX += nx * overlap; this.oldY += ny * overlap;
            }
          }
        }

        if (!twoSided) {
          const dx = this.x - p1.x; const dy = this.y - p1.y;
          const distNormal = dx * p1.normal.x + dy * p1.normal.y;
          // Persistent Support: If ball is on back side and within support threshold
          if (distNormal < 0 && distNormal > -(this.radius + 1.4)) {
            const distAlong = dx * p1.dir.x + dy * p1.dir.y;
            if (Math.abs(distAlong) <= p1.width / 2) {
              this.blockedFaceSupport(p1);
            }
          }
        }
    }
  }

  blockedFaceImpact(p: Portal, dotPrev: number) {
    const nx = p.normal.x;
    const ny = p.normal.y;
    const vx = this.x - this.oldX;
    const vy = this.y - this.oldY;
    const vNormal = vx * nx + vy * ny;
    
    const vtx = vx - vNormal * nx;
    const vty = vy - vNormal * ny;
    
    const side = Math.sign(dotPrev); 
    const distToPlane = (this.x - p.x) * nx + (this.y - p.y) * ny;
    
    const clearance = this.radius + 1.1;
    const overlapX = (distToPlane - (side * clearance)) * nx;
    const overlapY = (distToPlane - (side * clearance)) * ny;
    
    this.x -= overlapX;
    this.y -= overlapY;
    
    const restitution = 0.2;
    const rx = vtx - (vNormal * nx) * restitution;
    const ry = vty - (vNormal * ny) * restitution;
    
    this.oldX = this.x - rx;
    this.oldY = this.y - ry;
  }

  blockedFaceSupport(p: Portal) {
    const nx = p.normal.x;
    const ny = p.normal.y;
    const vx = this.x - this.oldX;
    const vy = this.y - this.oldY;
    const vNormal = vx * nx + vy * ny;
    
    const vtx = vx - vNormal * nx;
    const vty = vy - vNormal * ny;
    
    const distToPlane = (this.x - p.x) * nx + (this.y - p.y) * ny;
    const targetDist = -(this.radius + 1.1);
    const overlap = distToPlane - targetDist;
    
    this.x -= overlap * nx;
    this.y -= overlap * ny;
    
    const rx = (vNormal > 0) ? vtx : vx;
    const ry = (vNormal > 0) ? vty : vy;
    
    this.oldX = this.x - rx;
    this.oldY = this.y - ry;
  }

  teleport(entry: Portal, exit: Portal, interX: number, interY: number) {
    const vx = this.x - this.oldX;
    const vy = this.y - this.oldY;

    // 1. Residual post-intersection displacement still owed this frame
    const resX = this.x - interX;
    const resY = this.y - interY;

    // 2. Mapped crossing coordinate onto the Exit Portal plane
    const dLocInter = (interX - entry.x) * entry.dir.x + (interY - entry.y) * entry.dir.y;
    const nLocInter = (interX - entry.x) * entry.normal.x + (interY - entry.y) * entry.normal.y;

    const mappedInterX = exit.x + dLocInter * exit.dir.x - nLocInter * exit.normal.x;
    const mappedInterY = exit.y + dLocInter * exit.dir.y - nLocInter * exit.normal.y;

    // 3. Decompose velocity AND residual motion against Entry Portal basis
    const vAlong = vx * entry.dir.x + vy * entry.dir.y;
    const vNorm = vx * entry.normal.x + vy * entry.normal.y;
    const resAlong = resX * entry.dir.x + resY * entry.dir.y;
    const resNorm = resX * entry.normal.x + resY * entry.normal.y;

    // 4. Reconstruct in Exit Portal basis (inverting normal traversing the space-bridge)
    const newVx = vAlong * exit.dir.x - vNorm * exit.normal.x;
    const newVy = vAlong * exit.dir.y - vNorm * exit.normal.y;
    const newResX = resAlong * exit.dir.x - resNorm * exit.normal.x;
    const newResY = resAlong * exit.dir.y - resNorm * exit.normal.y;

    // 5. Add Explicit Outward Clearance to prevent precision re-collision 
    const flowSign = Math.sign(newVx * exit.normal.x + newVy * exit.normal.y) || 1;
    const clearanceEps = 1.0; 

    // Final accurate coordinate incorporating residual vector from interection plus epsilon
    this.x = mappedInterX + newResX + exit.normal.x * flowSign * clearanceEps;
    this.y = mappedInterY + newResY + exit.normal.y * flowSign * clearanceEps;

    // Reverse map velocity state precisely into oldX
    this.oldX = this.x - newVx;
    this.oldY = this.y - newVy;
    
    this.cooldown = 4;
    this.trail = []; 
  }

  draw(ctx: CanvasRenderingContext2D, trailIntensity: number, portals: Portal[], twoSided: boolean) {
    const vx = this.x - this.oldX;
    const vy = this.y - this.oldY;
    const speedSq = vx * vx + vy * vy;
    const heat = Math.min(1, speedSq / 200);
    
    this.drawTrail(ctx, trailIntensity, heat);

    let overlap: { entry: Portal; exit: Portal; d: number } | null = null;
    for (let i = 0; i < 2; i++) {
        const p = portals[i];
        const distAlong = (this.x - p.x) * p.dir.x + (this.y - p.y) * p.dir.y;
        if (Math.abs(distAlong) < p.width/2 + this.radius) {
            const d = (this.x - p.x) * p.normal.x + (this.y - p.y) * p.normal.y;
            if (Math.abs(d) < this.radius) {
                // If one-sided, only allow dual rendering if the ball center is on the front face (d > 0)
                if (twoSided || d >= 0) {
                  overlap = { entry: p, exit: portals[(i + 1) % 2], d };
                  break;
                }
            }
        }
    }

    if (overlap) {
        this.renderDual(ctx, overlap.entry, overlap.exit, overlap.d, heat);
    } else {
        this.renderBody(ctx, this.x, this.y, heat);
    }
  }

  drawTrail(ctx: CanvasRenderingContext2D, trailIntensity: number, heat: number) {
    if (this.trail.length > 2) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const batchSize = Math.ceil(this.trail.length / 8);
      for (let b = 0; b < this.trail.length - 1; b += batchSize) {
        ctx.beginPath();
        ctx.moveTo(this.trail[b].x, this.trail[b].y);
        const nextBatch = Math.min(b + batchSize, this.trail.length - 1);
        for (let i = b + 1; i <= nextBatch; i++) ctx.lineTo(this.trail[i].x, this.trail[i].y);
        const progress = b / this.trail.length;
        ctx.lineWidth = this.radius * (0.2 + 0.6 * progress);
        ctx.strokeStyle = this.color;
        ctx.globalAlpha = progress * (0.05 + heat * 0.6) * trailIntensity;
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  renderBody(ctx: CanvasRenderingContext2D, x: number, y: number, heat: number) {
    ctx.save();
    ctx.shadowBlur = 10 + heat * 20;
    ctx.shadowColor = heat > 0.5 ? '#fff' : this.color;
    ctx.beginPath();
    ctx.arc(x, y, this.radius, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(x, y, 0, x, y, this.radius);
    grad.addColorStop(0, '#fff');
    grad.addColorStop(0.4, heat > 0.3 ? `hsl(${40 - heat * 40}, 100%, 70%)` : this.color);
    grad.addColorStop(1, heat > 0.3 ? `hsl(${20 - heat * 20}, 100%, 50%)` : this.color);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }

  renderDual(ctx: CanvasRenderingContext2D, entry: Portal, exit: Portal, nLoc: number, heat: number) {
    // Basis Vector Clone Placement
    const dLoc = (this.x - entry.x) * entry.dir.x + (this.y - entry.y) * entry.dir.y;
    // Parameter 'nLoc' passed from overlap check is exactly the Normal distance
    const isFront = nLoc >= 0;
    
    // Mapped clone placement exactly identical to teleport basis mapping
    const cloneX = exit.x + dLoc * exit.dir.x - nLoc * exit.normal.x;
    const cloneY = exit.y + dLoc * exit.dir.y - nLoc * exit.normal.y;

    ctx.save();
    ctx.beginPath();
    ctx.translate(entry.x, entry.y);
    ctx.rotate(entry.angle);
    ctx.rect(-2000, isFront ? 0 : -2000, 4000, 2000); 
    ctx.clip();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.renderBody(ctx, this.x, this.y, heat);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.translate(exit.x, exit.y);
    ctx.rotate(exit.angle);
    ctx.rect(-2000, isFront ? -2000 : 0, 4000, 2000); 
    ctx.clip();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.renderBody(ctx, cloneX, cloneY, heat);
    ctx.restore();
  }
}

// --- Main Component ---
export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [objects, setObjects] = useState<Ball[]>([]);
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
    flowDensity: 15,
    flowScale: 1.0,
    showHelp: false,
    portalWidth: 100,
    portalPull: 1.0,
    twoSided: false
  });
  
  const [layoutIdx, setLayoutIdx] = useState(2);
  
  const [dragState, setDragState] = useState<DragState>({ id: null, type: null });

  const dragStateRef = useRef<DragState>(dragState);
  const updateDragState = useCallback((nextDragState: DragState) => {
    dragStateRef.current = nextDragState;
    setDragState(nextDragState);
  }, []);
  const lastPos = useRef({ x: 0, y: 0 });
  const activePointerId = useRef<number | null>(null);
  const frameCount = useRef(0);
  const lastTime = useRef(performance.now());
  const prevTime = useRef(performance.now());
  const initializedRef = useRef(false);
  const canvasSizeRef = useRef({ width: 0, height: 0 });
  const initialPortalWidthRef = useRef(config.portalWidth);

  // Initialize Portals once; subsequent resize events only resize/scale the existing scene.
  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const canvas = canvasRef.current;
        if (!canvas) return;

        const previousSize = canvasSizeRef.current;
        canvas.width = width;
        canvas.height = height;

        if (!initializedRef.current) {
          const cx = width / 2;
          const cy = height / 2;
          const initialPortals: Portal[] = [
            { id: 'orange', x: cx - width * 0.15, y: cy + height * 0.1, angle: -0.6, color: '#ff9d00', width: initialPortalWidthRef.current, dir: {x:0,y:0}, normal: {x:0,y:0}, handle: {x:0,y:0} },
            { id: 'blue', x: cx + width * 0.15, y: cy - height * 0.1, angle: 2.5, color: '#00a2ff', width: initialPortalWidthRef.current, dir: {x:0,y:0}, normal: {x:0,y:0}, handle: {x:0,y:0} }
          ];

          setPortals(initialPortals.map(withPortalVectors));
          setObjects([new Ball(width / 2, 100, 15, 20)]);
          initializedRef.current = true;
        } else if (previousSize.width > 0 && previousSize.height > 0) {
          const scaleX = width / previousSize.width;
          const scaleY = height / previousSize.height;

          setPortals(prev => prev.map(portal => withPortalVectors({
            ...portal,
            x: portal.x * scaleX,
            y: portal.y * scaleY,
          })));

          setObjects(prev => prev.map(obj => {
            obj.x *= scaleX;
            obj.y *= scaleY;
            obj.oldX *= scaleX;
            obj.oldY *= scaleY;
            obj.trail = obj.trail.map(point => ({ x: point.x * scaleX, y: point.y * scaleY }));
            return obj;
          }));

          lastPos.current = { x: lastPos.current.x * scaleX, y: lastPos.current.y * scaleY };
        }

        canvasSizeRef.current = { width, height };
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  const getGravityAt = useCallback((x: number, y: number, currentPortals: Portal[]) => {
    return computeGravityAt(x, y, currentPortals, config);
  }, [config.gravity, config.correctGravity, config.vacuum, config.portalPull]);

  const drawGrid = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number, currentPortals: Portal[]) => {
    ctx.strokeStyle = 'rgba(0, 162, 255, 0.08)';
    ctx.lineWidth = 1;
    const stepX = w / GRID_RES;
    const stepY = h / GRID_RES;
    
    const currentBaseG = getBaselineG(config.vacuum, config.gravity) || 1; // Secure denominator

    for (let i = 0; i <= GRID_RES; i++) {
      ctx.beginPath();
      for (let j = 0; j <= GRID_RES; j++) {
        const x = i * stepX;
        const y = j * stepY;
        const g = getGravityAt(x, y, currentPortals);
        
        const warpX = x + (g.x / currentBaseG) * config.gridIntensity * 10;
        const warpY = y + (g.y / currentBaseG) * config.gridIntensity * 10;
        if (j === 0) ctx.moveTo(warpX, warpY);
        else ctx.lineTo(warpX, warpY);
      }
      ctx.stroke();
    }

    for (let j = 0; j <= GRID_RES; j++) {
      ctx.beginPath();
      for (let i = 0; i <= GRID_RES; i++) {
        const x = i * stepX;
        const y = j * stepY;
        const g = getGravityAt(x, y, currentPortals);
        
        const warpX = x + (g.x / currentBaseG) * config.gridIntensity * 10;
        const warpY = y + (g.y / currentBaseG) * config.gridIntensity * 10;
        if (i === 0) ctx.moveTo(warpX, warpY);
        else ctx.lineTo(warpX, warpY);
      }
      ctx.stroke();
    }
  }, [getGravityAt, config.gridIntensity, config.vacuum, config.gravity]);
  
  const drawFlow = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number, currentPortals: Portal[]) => {
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
  }, [getGravityAt, config.flowDensity, config.flowScale, config.vacuum, config.gravity]);

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
          
          // 2. Synchronous Shift tracking strictly exact to conserve prior momentum perfectly
          b1.oldX -= posCorrectionX * w1;
          b1.oldY -= posCorrectionY * w1;
          b2.oldX += posCorrectionX * w2;
          b2.oldY += posCorrectionY * w2;
          
          // 3. Explicit Physical Collision Response mapped directly via velocity restitution
          const rVx = (b1.x - b1.oldX) - (b2.x - b2.oldX);
          const rVy = (b1.y - b1.oldY) - (b2.y - b2.oldY);
          const relVelDist = rVx * nx + rVy * ny;
          
          // Objects are strictly approaching each other
          if (relVelDist > 0) {
              const impulse = (1 + bounce) * relVelDist;
              b1.oldX += impulse * nx * w1;
              b1.oldY += impulse * ny * w1;
              b2.oldX -= impulse * nx * w2;
              b2.oldY -= impulse * ny * w2;
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
      // FPS calculation
      frameCount.current++;
      if (time - lastTime.current >= 1000) {
        setFps(frameCount.current);
        frameCount.current = 0;
        lastTime.current = time;
      }

      const w = canvas.width;
      const h = canvas.height;

      ctx.fillStyle = '#0a0a0c';
      ctx.fillRect(0, 0, w, h);

      if (config.showGrid) {
        drawGrid(ctx, w, h, portals);
      }
      
      if (config.showFlow) {
        drawFlow(ctx, w, h, portals);
      }

      const friction = config.vacuum ? 1.0 : config.friction;
      const bounce = config.elasticity;
      
      // Calculate proper timestep based on actual frame performance
      const frameDt = Math.min(1 / 30, (time - prevTime.current) / 1000) * config.timeScale;
      prevTime.current = time;
      const dt = frameDt / config.substeps;

      const pinnedIdx = syncPinnedBallToPointer(objects, dragStateRef.current, lastPos.current);

      for (let s = 0; s < config.substeps; s++) {
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

      // Draw Portals
      portals.forEach(p => {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);

        // One-sided "Back Plate"
        if (!config.twoSided) {
          ctx.beginPath();
          ctx.fillStyle = 'rgba(255,255,255,0.15)';
          ctx.roundRect(-p.width/2 - 2, 2, p.width + 4, 8, 2);
          ctx.fill();
          
          // Warning pattern
          ctx.strokeStyle = 'rgba(255,255,255,0.1)';
          ctx.lineWidth = 1;
          for (let i = -p.width/2; i < p.width/2; i += 10) {
            ctx.beginPath();
            ctx.moveTo(i, 2);
            ctx.lineTo(i + 5, 10);
            ctx.stroke();
          }
        }

        // Edge Caps (Always solid)
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(-p.width/2, 0, 4, 0, Math.PI * 2);
        ctx.arc(p.width/2, 0, 4, 0, Math.PI * 2);
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
      animationId = requestAnimationFrame(render);
    };

    animationId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationId);
  }, [objects, portals, config, drawGrid, drawFlow, getGravityAt, resolveCollisions]);

  const handleStart = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    activePointerId.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    lastPos.current = p;

    for (const pt of portals) {
      if (Math.hypot(pt.handle.x - p.x, pt.handle.y - p.y) < 30) {
        updateDragState({ id: pt.id, type: 'handle' });
        return;
      }
    }
    for (const pt of portals) {
      if (Math.hypot(pt.x - p.x, pt.y - p.y) < 50) {
        updateDragState({ id: pt.id, type: 'portal' });
        return;
      }
    }
    for (let i = objects.length - 1; i >= 0; i--) {
      const obj = objects[i];
      if (Math.hypot(obj.x - p.x, obj.y - p.y) < obj.radius + 20) {
        updateDragState({ id: String(i), type: 'ball' });
        return;
      }
    }
  };

  const handleMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const currentDragState = dragStateRef.current;
    if (!currentDragState.type || activePointerId.current !== e.pointerId) return;
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    if (currentDragState.type === 'portal' || currentDragState.type === 'handle') {
      const updatedPortals = portals.map(pt => {
        if (pt.id !== currentDragState.id) return pt;
        if (currentDragState.type === 'portal') {
          pt.x = p.x;
          pt.y = p.y;
        } else {
          pt.angle = Math.atan2(p.y - pt.y, p.x - pt.x) - Math.PI / 2;
        }
        pt.dir = { x: Math.cos(pt.angle), y: Math.sin(pt.angle) };
        pt.normal = { x: -Math.sin(pt.angle), y: Math.cos(pt.angle) };
        pt.handle = { x: pt.x + pt.normal.x * 60, y: pt.y + pt.normal.y * 60 };
        return { ...pt };
      });
      setPortals(updatedPortals);
    }
    
    // Update global last pointer position for pinning
    lastPos.current = p;
  };

  const handleEnd = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerId.current !== null && e.pointerId !== activePointerId.current) return;
    activePointerId.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    updateDragState({ id: null, type: null });
  };

  useEffect(() => {
    const onWindowPointerMove = (event: PointerEvent) => {
      const currentDragState = dragStateRef.current;
      if (!currentDragState.type || activePointerId.current !== event.pointerId) return;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const p = { x: event.clientX - rect.left, y: event.clientY - rect.top };

      if (currentDragState.type === 'portal' || currentDragState.type === 'handle') {
        const updatedPortals = portals.map(pt => {
          if (pt.id !== currentDragState.id) return pt;
          if (currentDragState.type === 'portal') {
            pt.x = p.x;
            pt.y = p.y;
          } else {
            pt.angle = Math.atan2(p.y - pt.y, p.x - pt.x) - Math.PI / 2;
          }
          pt.dir = { x: Math.cos(pt.angle), y: Math.sin(pt.angle) };
          pt.normal = { x: -Math.sin(pt.angle), y: Math.cos(pt.angle) };
          pt.handle = { x: pt.x + pt.normal.x * 60, y: pt.y + pt.normal.y * 60 };
          return { ...pt };
        });
        setPortals(updatedPortals);
      }

      lastPos.current = p;
    };

    const onWindowPointerEnd = (event: PointerEvent) => {
      if (activePointerId.current === null || event.pointerId !== activePointerId.current) return;
      activePointerId.current = null;
      updateDragState({ id: null, type: null });
    };

    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', onWindowPointerEnd);
    window.addEventListener('pointercancel', onWindowPointerEnd);

    return () => {
      window.removeEventListener('pointermove', onWindowPointerMove);
      window.removeEventListener('pointerup', onWindowPointerEnd);
      window.removeEventListener('pointercancel', onWindowPointerEnd);
    };
  }, [portals, updateDragState]);

  const addBall = () => {
    const w = canvasRef.current?.width || 800;
    setObjects(prev => [...prev, new Ball(w / 2, 100, config.size, config.mass)]);
  };

  const reset = () => {
    const w = canvasRef.current?.width || 800;
    setObjects([new Ball(w / 2, 100, config.size, config.mass)]);
  };

  const toggleLayout = () => {
    const w = canvasRef.current?.width || 800;
    const h = canvasRef.current?.height || 600;
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

    setPortals(prev => {
      const p1 = { ...prev[0], x: l.p1.x, y: l.p1.y, angle: l.p1.a };
      const p2 = { ...prev[1], x: l.p2.x, y: l.p2.y, angle: l.p2.a };
      return [withPortalVectors(p1), withPortalVectors(p2)];
    });
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
            <h1 className="text-3xl md:text-4xl font-light leading-tight">Spacetime Portal <br/><span className="font-bold italic">Sandbox</span></h1>
          </div>
          <p className="text-white/50 text-xs md:text-sm leading-relaxed max-w-md mt-4 lg:mt-0">
            An advanced 2D physics engine utilizing Verlet integration to simulate momentum conservation and gravitational leakage through portals.
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
                <div className="text-lg md:text-xl font-mono text-[#00a2ff]">{objects.length}</div>
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
                  setPortals(prev => prev.map(p => ({ ...p, width: val })));
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
              <label className="flex items-center justify-between cursor-pointer group">
                <span className="text-[10px] uppercase font-bold text-white/50 group-hover:text-white transition-colors flex items-center">
                  Two-Sided Entry <HelpTooltip text="If ON, objects can enter from both front and back. If OFF, capture only happens from the front face." />
                </span>
                <div 
                  className={`w-8 h-4 rounded-full transition-colors relative ${config.twoSided ? 'bg-[#00a2ff]' : 'bg-white/10'}`}
                  onClick={() => setConfig(prev => ({ ...prev, twoSided: !prev.twoSided }))}
                >
                  <div className={`absolute top-1 w-2 h-2 rounded-full transition-all ${config.twoSided ? 'left-5 bg-white' : 'left-1 bg-white/40'}`} />
                </div>
              </label>
              <p className="text-[9px] text-white/20 italic leading-tight">
                {config.twoSided ? "Objects can enter and exit from both sides." : "Portals are unidirectional (front-entry only)."}
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
                className="p-2 hover:bg-white/10 rounded-full transition-colors" title="Add Ball"
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
              onClick={() => setObjects([])}
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
                  <h3 className="text-[#00a2ff] uppercase text-[10px] font-bold tracking-[0.2em] mb-2 md:mb-3">01. Verlet Integration</h3>
                  <p>
                    Unlike standard Euler physics which simply adds velocity to position, this simulation uses <b>Verlet Integration</b>. 
                    It calculates motion based on the difference between the <i>current</i> and <i>previous</i> positions. 
                    This is mathematically more stable for constant constraints (like the portal boundaries).
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
                    the local gravitational potential and shifts its position accordingly.
                  </p>
                </section>

                <section>
                  <h3 className="text-[#00a2ff] uppercase text-[10px] font-bold tracking-[0.2em] mb-2 md:mb-3">04. Interaction</h3>
                  <ul className="list-disc list-inside space-y-1 md:space-y-2">
                    <li><b>Drag</b> the portals to relocate the wormhole.</li>
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
