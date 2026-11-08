// Maps the peaks of a wrist flick to bottle launch values. Pure, Node-safe.
import { P } from '../config';
import { idealOmega, type Launch } from '../physics/bottleSim';

export interface FlickPeaks {
  rot: number; // peak total rotation rate, deg/s
  acc: number; // peak linear acceleration (gravity removed), m/s^2
}

export interface MappedFlick extends Launch {
  rawOmega: number;
  idealOmega: number;
  /** Spin error before assist, as a fraction of the ideal (-0.1 = 10% under-spun). */
  spinError: number;
}

const DEG = Math.PI / 180;

// idealOmega runs ~22 short sims; memoise on everything it depends on.
const idealCache = new Map<string, number>();
function cachedIdeal(vx: number, vy: number): number {
  const key = [vx, vy.toFixed(3), P.fill, P.gravity, P.releaseX, P.releaseY, P.slosh, P.waterDamping].join();
  let v = idealCache.get(key);
  if (v === undefined) {
    if (idealCache.size > 4000) idealCache.clear();
    idealCache.set(key, (v = idealOmega(vx, vy)));
  }
  return v;
}

export function mapFlick(f: FlickPeaks): MappedFlick {
  const rot = Math.min(Math.max(f.rot, 0), P.maxRot);
  const vy = Math.min(P.maxVy, Math.max(P.minVy, P.launchBase + f.acc * P.launchScale));
  const vx = P.launchVx;
  const raw = -rot * DEG * P.spinScale;
  const ideal = cachedIdeal(vx, vy);
  const err = (raw - ideal) / Math.abs(ideal);

  // Spin magnet: near-misses get pulled toward the ideal spin, wild flicks
  // stay wild. Weight falls off with a Gaussian of width `assistWidth`.
  const w = P.assist * Math.exp(-((err / P.assistWidth) ** 2));
  const omega = raw + w * (ideal - raw);
  return { vx, vy, omega, rawOmega: raw, idealOmega: ideal, spinError: -err };
}
