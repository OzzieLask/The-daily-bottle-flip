// Solid things in the flip plane (z = 0), as axis-aligned boxes in x/y.
// The scene in scene/kitchen.ts is built to match these.
//  - land:     surfaces a bottle can come to rest on and be graded (top faces)
//  - obstacle: things it can bounce off on the way (a "trick shot")
//  - floor:    resting here is a miss
import { FLOOR_Y, P } from '../config';

export type ColliderKind = 'land' | 'obstacle' | 'floor';

export interface Collider {
  name: 'island' | 'back counter' | 'wall' | 'lamp' | 'floor';
  kind: ColliderKind;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export const WALL_X = 1.9;
export const BACK_COUNTER = { minX: WALL_X - 0.6, maxX: WALL_X };
export const LAMP = { x: 0.5, y: 0.95, r: 0.13, h: 0.14 }; // high and to the side: hitting it takes a big throw

export function colliders(): Collider[] {
  return [
    { name: 'island', kind: 'land', minX: P.counterMinX, maxX: P.counterMaxX, minY: FLOOR_Y, maxY: 0 },
    { name: 'back counter', kind: 'land', minX: BACK_COUNTER.minX, maxX: BACK_COUNTER.maxX, minY: FLOOR_Y, maxY: 0 },
    { name: 'wall', kind: 'obstacle', minX: WALL_X, maxX: WALL_X + 0.3, minY: FLOOR_Y, maxY: 2.2 },
    {
      name: 'lamp',
      kind: 'obstacle',
      minX: LAMP.x - LAMP.r,
      maxX: LAMP.x + LAMP.r,
      minY: LAMP.y - LAMP.h / 2,
      maxY: LAMP.y + LAMP.h / 2,
    },
    { name: 'floor', kind: 'floor', minX: -6, maxX: 6, minY: FLOOR_Y - 0.5, maxY: FLOOR_Y },
  ];
}
