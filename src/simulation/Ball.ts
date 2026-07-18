import { TELEPORT_COOLDOWN_SECONDS } from './constants';
import { getCrossingIntersection, teleportBodyAtCrossing } from './portalTraversal';
import type { Point, Portal } from './types';

const MAX_TRAIL = 80;

export class Ball {
  x: number;
  y: number;
  oldX: number;
  oldY: number;
  radius: number;
  mass: number;
  cooldown: number;
  vx: number;
  vy: number;
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
    this.vx = 0;
    this.vy = 0;
    this.color = `hsl(${Math.random() * 60 + 190}, 90%, 65%)`;
    this.trail = [];
  }

  update(
    friction: number, 
    gravityFn: (x: number, y: number) => Point, 
    dt: number
  ) {
    const g = gravityFn(this.x, this.y);

    this.oldX = this.x;
    this.oldY = this.y;
    
    // Semi-implicit Euler integration using absolute seconds
    const frictionSub = Math.pow(friction, dt * 60); 
    this.vx = this.vx * frictionSub + g.x * dt;
    this.vy = this.vy * frictionSub + g.y * dt;
    this.x += this.vx * dt; 
    this.y += this.vy * dt;

    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    
    if (Math.random() > 0.8) {
      this.trail.push({ x: this.x, y: this.y });
      if (this.trail.length > MAX_TRAIL) this.trail.shift();
    }
  }

  checkCrossing(portals: Portal[], twoSided: boolean, bounce: number) {
    let selected: { entry: Portal; exit: Portal; crossing: ReturnType<typeof getCrossingIntersection> } | null = null;

    for (let i = 0; i < portals.length; i++) {
      const entry = portals[i];
      const crossing = getCrossingIntersection(
        { x: this.oldX, y: this.oldY },
        { x: this.x, y: this.y },
        entry,
        this.radius,
      );
      if (!crossing) continue;
      if (!selected || crossing.t < selected.crossing!.t) {
        selected = { entry, exit: portals[(i + 1) % portals.length], crossing };
      }
    }

    if (!selected?.crossing || this.cooldown > 0) return;

    const fromFront = selected.crossing.dotPrev > 0;
    if (twoSided || fromFront) {
      teleportBodyAtCrossing(
        this,
        selected.entry,
        selected.exit,
        { x: selected.crossing.interX, y: selected.crossing.interY },
        { x: this.x, y: this.y },
      );
      this.cooldown = TELEPORT_COOLDOWN_SECONDS;
      return;
    }

    this.blockedFaceImpact(selected.entry, selected.crossing.dotPrev, bounce);
  }

  constrain(width: number, height: number, portals: Portal[], bounce: number, twoSided: boolean) {
    // 1. Boundaries
    const margin = this.radius;
    if (this.y > height - margin) { this.y = height - margin; if (this.vy > 0) this.vy = -this.vy * bounce; this.oldX = this.x; this.oldY = this.y; }
    if (this.x < margin) { this.x = margin; if (this.vx < 0) this.vx = -this.vx * bounce; this.oldX = this.x; this.oldY = this.y; }
    if (this.x > width - margin) { this.x = width - margin; if (this.vx > 0) this.vx = -this.vx * bounce; this.oldX = this.x; this.oldY = this.y; }
    if (this.y < margin) { this.y = margin; if (this.vy < 0) this.vy = -this.vy * bounce; this.oldX = this.x; this.oldY = this.y; }

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
            const dot = this.vx * nx + this.vy * ny;
            if (dot < 0) {
              this.vx = (this.vx - 2 * dot * nx) * bounce;
              this.vy = (this.vy - 2 * dot * ny) * bounce;
            }
            this.oldX = this.x;
            this.oldY = this.y;
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

  blockedFaceImpact(p: Portal, dotPrev: number, bounce: number) {
    const nx = p.normal.x;
    const ny = p.normal.y;
    const vNormal = this.vx * nx + this.vy * ny;
    const side = Math.sign(dotPrev) || -1;

    // The one-sided portal's solid back face only exists for motion from the
    // back side into the blocked face. Grazing or separating motion should not
    // be converted into a wall collision just because it is near the plane.
    if (side >= 0 || vNormal <= 0) return;

    const vtx = this.vx - vNormal * nx;
    const vty = this.vy - vNormal * ny;
    const distToPlane = (this.x - p.x) * nx + (this.y - p.y) * ny;

    const clearance = this.radius + 1.1;
    const overlapX = (distToPlane - (side * clearance)) * nx;
    const overlapY = (distToPlane - (side * clearance)) * ny;

    this.x -= overlapX;
    this.y -= overlapY;

    this.vx = vtx - vNormal * bounce * nx;
    this.vy = vty - vNormal * bounce * ny;
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

    // Being close to the back support plane is not enough to create a wall.
    // Only resolve actual penetration of the back plate.
    if (overlap <= 0) return;

    const correctionX = -overlap * nx;
    const correctionY = -overlap * ny;
    this.x += correctionX;
    this.y += correctionY;

    // Preserve full tangential velocity when the correction is not fighting deeper
    // penetration. Only drop the incoming normal component when penetration is
    // actually increasing; tangential motion is always preserved.
    if (vNormal > 0) {
      this.vx -= vNormal * nx;
      this.vy -= vNormal * ny;
    }
    this.oldX = this.x;
    this.oldY = this.y;
  }

  teleport(entry: Portal, exit: Portal, interX: number, interY: number) {
    teleportBodyAtCrossing(this, entry, exit, { x: interX, y: interY }, { x: this.x, y: this.y });
    this.cooldown = TELEPORT_COOLDOWN_SECONDS;
  }

  draw(ctx: CanvasRenderingContext2D, trailIntensity: number, portals: Portal[], twoSided: boolean) {
    const speedSq = this.vx * this.vx + this.vy * this.vy;
    const heat = Math.min(1, speedSq / 720000);
    
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

    const worldTransform = ctx.getTransform();

    ctx.save();
    ctx.beginPath();
    ctx.translate(entry.x, entry.y);
    ctx.rotate(entry.angle);
    ctx.rect(-2000, isFront ? 0 : -2000, 4000, 2000); 
    ctx.clip();
    ctx.setTransform(worldTransform);
    this.renderBody(ctx, this.x, this.y, heat);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.translate(exit.x, exit.y);
    ctx.rotate(exit.angle);
    ctx.rect(-2000, isFront ? -2000 : 0, 4000, 2000); 
    ctx.clip();
    ctx.setTransform(worldTransform);
    this.renderBody(ctx, cloneX, cloneY, heat);
    ctx.restore();
  }
}

