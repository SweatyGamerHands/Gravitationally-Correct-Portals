import type { Point } from './types';

export type PhysicsEventType = 'traversal' | 'rim-impact' | 'back-plate-impact';
export type PhysicsEventFact = string | number | boolean;

export type PhysicsEvent = {
  type: PhysicsEventType;
  bodyId: string;
  portalIds: {
    entry: string;
    exit?: string;
  };
  /** World-space event location at the instant of contact or traversal. */
  position: Point;
  beforeSpeed: number;
  afterSpeed: number;
  explanation: {
    message: string;
    facts: Record<string, PhysicsEventFact>;
  };
};

export type PhysicsEventBody = {
  id?: string;
  label?: string;
  vx: number;
  vy: number;
};

export const bodySpeed = (body: Pick<PhysicsEventBody, 'vx' | 'vy'>) => (
  Math.hypot(body.vx, body.vy)
);

export const bodyEventId = (body: PhysicsEventBody) => body.id ?? 'body';
export const bodyEventLabel = (body: PhysicsEventBody) => body.label ?? body.id ?? 'Body';
