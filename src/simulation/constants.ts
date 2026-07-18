import type { Point } from './types';

export const BASE_G = 800;
export const FIXED_TIMESTEP = 1 / 120;
export const MAX_ACCUMULATED_TIME = 0.12;
export const MAX_FRAME_DT = 1 / 30;
export const PORTAL_APERTURE_RADIUS_EPSILON = 0.001;
// Matches the rendered solid endpoint caps in App.tsx.
export const PORTAL_EDGE_RADIUS = 4;
export const PORTAL_COLLISION_EPSILON = 0.001;
export const PORTAL_BACK_PLATE_HALF_THICKNESS = 1.1;
export const TRAVERSAL_EPSILON = 0.75;
export const TELEPORT_COOLDOWN_DISTANCE = 8;
export const TELEPORT_COOLDOWN_SECONDS = 1 / 30;
export const DEFAULT_FIELD_MAX_DEPTH = 3;
export const DEFAULT_FIELD_CLAMP = 1600;
export const DEFAULT_TWO_SIDED = false;
export const WORLD_GRAVITY: Point = { x: 0, y: BASE_G };
