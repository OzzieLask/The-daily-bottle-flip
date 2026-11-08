// Central tuning values. Everything the ?debug panel can tweak lives in `P`.
// Pure module: safe to import from Node (scripts/sweep.ts).

/** Fixed bottle geometry, in metres. A ~500 ml plastic bottle. */
export const GEO = {
  H: 0.208, // base to cap top
  R: 0.033, // body radius
  baseR: 0.027, // flat part of the base (rounded edge beyond this)
  shoulder: 0.14, // where the body starts to narrow
  capR: 0.016,
  innerR: 0.031,
  waterBottom: 0.003,
  waterTop: 0.14, // water slugs stay in the straight body
  shellMass: 0.022,
  shellCom: 0.105,
} as const;

export const FLOOR_Y = -0.9;

export interface Tuning {
  gravity: number;
  fill: number; // 0..1 of the straight body
  restitution: number;
  friction: number;
  waterDamping: number; // 1/s, viscous drag of water relative to bottle
  waterBounce: number; // restitution of water slug hitting an end
  slosh: number; // (reserved) extra centrifugal pull on the water
  landingGrip: number; // 1/s spin damping while touching the counter
  // flick -> launch mapping
  spinScale: number; // rad/s of bottle spin per rad/s of wrist spin
  launchBase: number; // m/s
  launchScale: number; // m/s of upward speed per m/s^2 of peak accel
  minVy: number;
  maxVy: number;
  maxRot: number; // deg/s clamp on wrist spin
  assist: number; // 0..1 strength of the spin magnet (main difficulty dial)
  assistWidth: number; // fraction of ideal spin over which the magnet acts
  launchVx: number; // m/s forward drift
  releaseX: number;
  releaseY: number; // base height above counter at release
  counterMinX: number;
  counterMaxX: number;
  cleanTiltDeg: number;
  slowmo: number; // time scale during landing
}

export const DEFAULTS: Tuning = {
  gravity: 9.81,
  fill: 0.5,
  restitution: 0.1,
  friction: 0.55,
  waterDamping: 5,
  waterBounce: 0.05,
  slosh: 1,
  landingGrip: 45,
  spinScale: 0.9,
  launchBase: 0.9,
  launchScale: 0.045,
  minVy: 0.6,
  maxVy: 4,
  maxRot: 2400,
  assist: 0.3,
  assistWidth: 0.3,
  launchVx: 0.3,
  releaseX: -0.14,
  releaseY: 0.12,
  counterMinX: -0.9,
  counterMaxX: 0.55,
  cleanTiltDeg: 12,
  slowmo: 0.28,
};

export const P: Tuning = { ...DEFAULTS };

export const TUNING_KEY = 'dbf.tuning.v1';

/** Only the debug build restores saved tuning, so players always get DEFAULTS. */
export function loadSavedTuning(): void {
  try {
    const raw = localStorage.getItem(TUNING_KEY);
    if (raw) Object.assign(P, JSON.parse(raw));
  } catch {
    /* ignore */
  }
}

export function saveTuning(): void {
  try {
    localStorage.setItem(TUNING_KEY, JSON.stringify(P));
  } catch {
    /* ignore */
  }
}
