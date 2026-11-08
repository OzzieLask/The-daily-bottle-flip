// Maps the peaks of a wrist flick to bottle launch values. Pure, Node-safe.
import { GEO, P } from '../config';
import { BottleSim, idealOmega, idealReleaseOmega, type HeldSnapshot, type Launch, type SimResult } from '../physics/bottleSim';

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

/** Bottle spin (rad/s) when let go from a phone swing of `phoneRate` rad/s. */
export function swingSpin(phoneRate: number): number {
  return phoneRate * P.swingGain * P.releaseSpin;
}

/** The hand's upward lift from flick power: grows gently, then levels off at liftMax. */
export function lift(acc: number): number {
  return P.liftMax * Math.tanh((acc * P.launchScale) / P.liftMax);
}

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

/**
 * The real throw: the bottle is let go from the swing. `omega` is its spin at
 * that moment (rad/s, signed), `acc` the flick's peak power for the hand's lift.
 * The spin magnet pulls near-misses toward the ideal spin for this exact pose.
 */
export function mapRelease(snap: HeldSnapshot, omega: number, acc: number): MappedFlick {
  const dir = Math.sign(omega) || 1;
  const vy = lift(acc);
  const ideal = idealReleaseOmega(snap, 0, vy, dir);
  const err = (Math.abs(omega) - Math.abs(ideal)) / Math.abs(ideal);
  // Overshoot forgiveness: up to 40% too fast counts only (1 - forgive) as much.
  // Past that it passes straight through, so big double-flip swings still work.
  let w0 = omega;
  if (err > 0) {
    const win = 0.4 * Math.abs(ideal);
    const over = Math.abs(omega) - Math.abs(ideal);
    const soft = Math.min(over, win) * (1 - P.overshootForgive) + Math.max(0, over - win);
    w0 = dir * (Math.abs(ideal) + soft);
  }
  const e2 = (Math.abs(w0) - Math.abs(ideal)) / Math.abs(ideal);
  const w = P.assist * Math.exp(-((e2 / P.assistWidth) ** 2));
  return { vx: 0, vy, omega: w0 + w * (ideal - w0), rawOmega: omega, idealOmega: ideal, spinError: err };
}

/**
 * A held bottle swung up to `angleDeg` of phone pitch, as a quick swing would
 * leave it (water pushed by the swing), ready to release.
 */
export function heldAt(angleDeg: number): BottleSim {
  const sim = new BottleSim();
  const py = P.releaseY + GEO.H;
  const theta = angleDeg * DEG * P.swingGain;
  sim.hold(0, 0, P.releaseX, py);
  for (let k = 1; k <= 12; k++) sim.hold(1 / 60, (theta * k) / 12, P.releaseX, py);
  return sim;
}

/** Synthetic release: phone pitch speed `rateDeg` (deg/s) at the release angle. */
export function simulateRelease(rateDeg: number, acc: number, assist = true): { launch: MappedFlick; result: SimResult } {
  const sim = heldAt(P.releaseAngle);
  const omega = swingSpin(rateDeg * DEG);
  const saved = P.assist;
  if (!assist) P.assist = 0;
  const launch = assist ? mapRelease(sim.heldSnapshot(), omega, acc) : rawRelease(omega, acc);
  P.assist = saved;
  sim.release(launch.omega, launch.vx, launch.vy);
  while (!sim.done) sim.step(1 / 240);
  return { launch, result: sim.result! };
}

function rawRelease(omega: number, acc: number): MappedFlick {
  const vy = lift(acc);
  return { vx: 0, vy, omega, rawOmega: omega, idealOmega: NaN, spinError: NaN };
}

// Target phone pitch speed (deg/s) for the meter, for a release at the
// release angle with the water settled. Cached per power bucket.
const targetCache = new Map<string, number>();
export function targetRate(acc: number): number {
  const a = Math.round(acc / 2) * 2;
  const key = [a, P.releaseAngle, P.swingGain, P.releaseSpin, P.releaseCarry, P.fill, P.launchScale, P.liftMax, P.gravity].join();
  let v = targetCache.get(key);
  if (v === undefined) {
    const theta = P.releaseAngle * DEG * P.swingGain;
    const sim = new BottleSim();
    sim.hold(0, 0, P.releaseX, P.releaseY + GEO.H);
    sim.hold(0, theta, P.releaseX, P.releaseY + GEO.H);
    const vy = lift(a);
    const ideal = idealReleaseOmega(sim.heldSnapshot(), 0, vy, Math.sign(theta) || 1);
    v = Math.abs(ideal / (P.swingGain * P.releaseSpin)) / DEG;
    if (targetCache.size > 200) targetCache.clear();
    targetCache.set(key, v);
  }
  return v;
}
