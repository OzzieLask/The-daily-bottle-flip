// How cool was that? 1-5 stars for a landed shot, with the reasons as tags.
// Pure, Node-safe.
import type { SimResult } from './physics/bottleSim';

export interface Score {
  stars: number; // 0 for a miss, otherwise 1..5
  tags: string[];
}

const FLIP_NAME = ['', '', 'Double flip', 'Triple flip', 'Quad flip'];

export function scoreShot(r: SimResult): Score {
  if (r.tier === 'MISS') return { stars: 0, tags: [] };
  const tags: string[] = [];

  // base: a wobbly save < a clean landing < landing on the cap
  let s = r.tier === 'CAP' ? 3 : r.tier === 'CLEAN' ? 2 : 1;
  if (r.tier === 'CAP') tags.push('Cap landing');

  // extra turns beyond the minimum (1 turn upright, half a turn onto the cap)
  const extra = r.tier === 'CAP' ? Math.max(0, Math.round(r.rotations - 0.5)) : Math.max(0, Math.round(r.rotations) - 1);
  if (extra > 0) {
    s += extra;
    tags.push(r.tier === 'CAP' ? `${extra}.5 turns to cap` : (FLIP_NAME[extra + 1] ?? `${extra + 1} flips`));
  }

  // all the way to the back counter
  if (r.surface === 'back counter') {
    s += 2;
    tags.push('Long shot');
  }

  // bounced off the lamp or the wall on the way
  if (r.hits.length) {
    s += 1;
    tags.push(r.hits.includes('lamp') ? 'Off the lamp' : 'Off the wall');
  }

  // barely moved on touchdown
  if (r.tier === 'CLEAN' && r.maxTiltDeg < 4) {
    s += 1;
    tags.push('Dead centre');
  }

  return { stars: Math.max(1, Math.min(5, s)), tags };
}
