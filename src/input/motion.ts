// Phone motion sensors -> one flick.
//
// Hold the phone upright (portrait) and snap the wrist up-and-back. A flick
// starts when the total rotation rate crosses START_DPS, then we record peaks
// for a short window and fire once. All raw peaks are kept for the debug log
// so the mapping can be tuned from real devices.

export interface FlickSample {
  rot: number; // peak total rotation rate, deg/s
  acc: number; // peak linear acceleration magnitude, m/s^2 (gravity removed)
  alpha: number; // peak |rotationRate.alpha|, deg/s
  beta: number; // peak |rotationRate.beta|, deg/s (the up-and-back axis)
  gamma: number; // peak |rotationRate.gamma|, deg/s
  accSource: 'linear' | 'gravity-filtered';
  samples: number;
  durationMs: number;
}

export type PermissionResult = 'granted' | 'denied' | 'unsupported';

const START_DPS = 300;
const WINDOW_MS = 240;
const END_DPS = 150;

type DME = typeof DeviceMotionEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

export function needsPermissionTap(): boolean {
  return typeof DeviceMotionEvent !== 'undefined' && typeof (DeviceMotionEvent as DME).requestPermission === 'function';
}

/** Must be called from a user gesture on iOS. */
export async function requestMotionPermission(): Promise<PermissionResult> {
  if (typeof DeviceMotionEvent === 'undefined') return 'unsupported';
  const dme = DeviceMotionEvent as DME;
  if (typeof dme.requestPermission !== 'function') return 'granted';
  try {
    return (await dme.requestPermission()) === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

export class FlickDetector {
  armed = false;
  /** True once a devicemotion event with real rotation data has arrived. */
  hasSensor = false;
  onFlick: (f: FlickSample) => void = () => {};
  /** Live rotation magnitude for the HUD meter, deg/s. */
  live = 0;

  private capturing = false;
  private t0 = 0;
  private peak: FlickSample = this.blank();
  private grav = { x: 0, y: 0, z: 0, init: false };

  start(): void {
    window.addEventListener('devicemotion', this.handle);
  }

  stop(): void {
    window.removeEventListener('devicemotion', this.handle);
  }

  arm(): void {
    this.armed = true;
    this.capturing = false;
  }

  disarm(): void {
    this.armed = false;
    this.capturing = false;
  }

  private blank(): FlickSample {
    return { rot: 0, acc: 0, alpha: 0, beta: 0, gamma: 0, accSource: 'linear', samples: 0, durationMs: 0 };
  }

  private handle = (e: DeviceMotionEvent): void => {
    const rr = e.rotationRate;
    if (!rr || rr.alpha === null || rr.beta === null || rr.gamma === null) return;
    this.hasSensor = true;
    const a = Math.abs(rr.alpha);
    const b = Math.abs(rr.beta);
    const g = Math.abs(rr.gamma);
    const rot = Math.hypot(a, b, g);
    this.live = rot;

    // Linear acceleration: use the OS value when available, otherwise
    // subtract a low-passed gravity estimate from accelerationIncludingGravity.
    let acc = 0;
    let src: FlickSample['accSource'] = 'linear';
    const la = e.acceleration;
    if (la && la.x !== null && la.y !== null && la.z !== null) {
      acc = Math.hypot(la.x, la.y, la.z);
    } else if (e.accelerationIncludingGravity) {
      const ag = e.accelerationIncludingGravity;
      const x = ag.x ?? 0;
      const y = ag.y ?? 0;
      const z = ag.z ?? 0;
      const gr = this.grav;
      if (!gr.init) Object.assign(gr, { x, y, z, init: true });
      if (!this.capturing) {
        const k = 0.1;
        gr.x += (x - gr.x) * k;
        gr.y += (y - gr.y) * k;
        gr.z += (z - gr.z) * k;
      }
      acc = Math.hypot(x - gr.x, y - gr.y, z - gr.z);
      src = 'gravity-filtered';
    }

    if (!this.armed) return;
    const now = e.timeStamp || performance.now();

    if (!this.capturing) {
      if (rot < START_DPS) return;
      this.capturing = true;
      this.t0 = now;
      this.peak = this.blank();
    }
    const p = this.peak;
    p.rot = Math.max(p.rot, rot);
    p.acc = Math.max(p.acc, acc);
    p.alpha = Math.max(p.alpha, a);
    p.beta = Math.max(p.beta, b);
    p.gamma = Math.max(p.gamma, g);
    p.accSource = src;
    p.samples++;
    p.durationMs = now - this.t0;

    const ended = p.durationMs > WINDOW_MS || (p.samples > 2 && rot < END_DPS);
    if (ended) {
      this.capturing = false;
      this.armed = false;
      this.onFlick({ ...p });
    }
  };
}
