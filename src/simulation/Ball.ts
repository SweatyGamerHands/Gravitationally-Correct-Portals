import { getCrossingIntersection, transformThroughPortal } from './physics';
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
  color: string;
  trail: Point[];

  constructor(x: number, y: number, r: number, m: number) {
    this.x = x; this.y = y; this.oldX = x; this.oldY = y;
    this.radius = r; this.mass = m; this.cooldown = 0;
    this.color = `hsl(${Math.random() * 60 + 190}, 90%, 65%)`; this.trail = [];
  }
  update(friction: number, gravityFn: (x: number, y: number) => Point, dt: number) {
    const vx = this.x - this.oldX; const vy = this.y - this.oldY; const g = gravityFn(this.x, this.y);
    this.oldX = this.x; this.oldY = this.y;
    const frictionSub = Math.pow(friction, dt * 60);
    this.x += vx * frictionSub + g.x * dt * dt; this.y += vy * frictionSub + g.y * dt * dt;
    if (this.cooldown > 0) this.cooldown--;
    if (Math.random() > 0.8) { this.trail.push({ x: this.x, y: this.y }); if (this.trail.length > MAX_TRAIL) this.trail.shift(); }
  }
  checkCrossing(portals: Portal[], twoSided: boolean) {
    for (let i = 0; i < 2; i++) {
      const p1 = portals[i]; const p2 = portals[(i + 1) % 2];
      const cross = getCrossingIntersection({ x: this.oldX, y: this.oldY }, { x: this.x, y: this.y }, p1);
      if (!cross || this.cooldown > 0) continue;
      if (twoSided || cross.dotPrev > 0) return this.teleport(p1, p2, cross.interX, cross.interY);
      return;
    }
  }
  teleport(entry: Portal, exit: Portal, interX: number, interY: number) {
    const velocity = { x: this.x - this.oldX, y: this.y - this.oldY };
    const residual = { x: this.x - interX, y: this.y - interY };
    const dLoc = (interX - entry.x) * entry.dir.x + (interY - entry.y) * entry.dir.y;
    const nLoc = (interX - entry.x) * entry.normal.x + (interY - entry.y) * entry.normal.y;
    const mappedInter = { x: exit.x + dLoc * exit.dir.x - nLoc * exit.normal.x, y: exit.y + dLoc * exit.dir.y - nLoc * exit.normal.y };
    const newV = transformThroughPortal(velocity, entry, exit);
    const newRes = transformThroughPortal(residual, entry, exit);
    const flowSign = Math.sign(newV.x * exit.normal.x + newV.y * exit.normal.y) || 1;
    this.x = mappedInter.x + newRes.x + exit.normal.x * flowSign;
    this.y = mappedInter.y + newRes.y + exit.normal.y * flowSign;
    this.oldX = this.x - newV.x; this.oldY = this.y - newV.y;
    this.cooldown = 4; this.trail = [];
  }
}
