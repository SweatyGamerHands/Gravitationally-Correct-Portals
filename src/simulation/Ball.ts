import type { Point, Portal } from './types';
import { getPortalLocal, isWithinPortalSplitRenderAperture } from './physics';

const MAX_TRAIL = 80;

export class Ball {
  x: number;
  y: number;
  oldX: number;
  oldY: number;
  vx: number;
  vy: number;
  radius: number;
  mass: number;
  cooldown: number;
  lastExit: { portalId: string; side: number } | null;
  private trailClock: number;
  color: string;
  trail: Point[];

  constructor(x: number, y: number, r: number, m: number) {
    this.x = x;
    this.y = y;
    this.oldX = x;
    this.oldY = y;
    this.vx = 0;
    this.vy = 0;
    this.radius = r;
    this.mass = m;
    this.cooldown = 0;
    this.lastExit = null;
    this.trailClock = 0;
    this.color = `hsl(${Math.random() * 60 + 190}, 90%, 65%)`;
    this.trail = [];
  }

  blockedFaceImpact(p: Portal, dotPrev: number) {
    const nx = p.normal.x;
    const ny = p.normal.y;
    const vNormal = this.vx * nx + this.vy * ny;
    const side = Math.sign(dotPrev) || -1;
    if (side >= 0 || vNormal <= 0) return;
    const vtx = this.vx - vNormal * nx;
    const vty = this.vy - vNormal * ny;
    const distToPlane = (this.x - p.x) * nx + (this.y - p.y) * ny;
    const clearance = this.radius + 1.1;
    const overlapX = (distToPlane - (side * clearance)) * nx;
    const overlapY = (distToPlane - (side * clearance)) * ny;
    this.x -= overlapX;
    this.y -= overlapY;
    const restitution = 0.2;
    this.vx = vtx - vNormal * restitution * nx;
    this.vy = vty - vNormal * restitution * ny;
    this.oldX = this.x;
    this.oldY = this.y;
  }

  blockedFaceSupport(p: Portal) {
    const nx = p.normal.x;
    const ny = p.normal.y;
    const vNormal = this.vx * nx + this.vy * ny;
    const distToPlane = (this.x - p.x) * nx + (this.y - p.y) * ny;
    const targetDist = -(this.radius + 1.1);
    const overlap = distToPlane - targetDist;
    if (overlap <= 0) return;
    this.x -= overlap * nx;
    this.y -= overlap * ny;
    if (vNormal > 0) {
      this.vx -= vNormal * nx;
      this.vy -= vNormal * ny;
    }
    this.oldX = this.x;
    this.oldY = this.y;
  }

  addTrailPoint(segmentBreak = false, dt = 0) {
    if (segmentBreak) {
      this.trail.push({ x: Number.NaN, y: Number.NaN });
      this.trailClock = 0;
      return;
    }
    this.trailClock += dt;
    const last = [...this.trail].reverse().find(p => Number.isFinite(p.x) && Number.isFinite(p.y));
    const dist = last ? Math.hypot(this.x - last.x, this.y - last.y) : Infinity;
    if (!last || this.trailClock >= 1 / 30 || dist >= Math.max(4, this.radius * 0.6)) {
      this.trail.push({ x: this.x, y: this.y });
      this.trailClock = 0;
      while (this.trail.length > MAX_TRAIL) this.trail.shift();
    }
  }

  clearTrailSegment() {
    this.trail = [];
    this.trailClock = 0;
  }

  draw(ctx: CanvasRenderingContext2D, trailIntensity: number, portals: Portal[], twoSided: boolean) {
    const speedSq = this.vx * this.vx + this.vy * this.vy;
    const heat = Math.min(1, speedSq / 720000);
    
    this.drawTrail(ctx, trailIntensity, heat);

    let overlap: { entry: Portal; exit: Portal; d: number } | null = null;
    for (let i = 0; i < 2; i++) {
        const p = portals[i];
        const local = getPortalLocal({ x: this.x, y: this.y }, p);
        if (isWithinPortalSplitRenderAperture(local, p, this.radius) && Math.abs(local.normal) < this.radius) {
            // If one-sided, only allow dual rendering if the ball center is on the front face (d > 0)
            if (twoSided || local.normal >= 0) {
              overlap = { entry: p, exit: portals[(i + 1) % 2], d: local.normal };
              break;
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
        if (!Number.isFinite(this.trail[b].x) || !Number.isFinite(this.trail[b].y)) continue;
        ctx.moveTo(this.trail[b].x, this.trail[b].y);
        const nextBatch = Math.min(b + batchSize, this.trail.length - 1);
        for (let i = b + 1; i <= nextBatch; i++) {
          if (!Number.isFinite(this.trail[i].x) || !Number.isFinite(this.trail[i].y)) { ctx.stroke(); ctx.beginPath(); continue; }
          ctx.lineTo(this.trail[i].x, this.trail[i].y);
        }
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
    const dLoc = getPortalLocal({ x: this.x, y: this.y }, entry).along;
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

