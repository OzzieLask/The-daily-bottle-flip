// Phone motion -> a held swing and a release.
//
// Grip: phone flat on the palm. The bottle hangs from its cap in your hand and
// follows the phone's PITCH (front edge tipping up/down). Pitch comes from
// deviceorientation.beta, a real angle that doesn't drift. If orientation
// isn't available, it falls back to integrating the gyroscope.
//
// Release: while armed, the bottle lets go when the pitch passes
// P.releaseAngle, or at the peak of a swing faster than P.releaseRate (once
// past a minimum angle). The release carries the tilt and pitch speed at that
// moment, plus the flick's peak power, so the throw comes from the swing itself.
import { P } from '../config';

export interface FlickSample {
  rot: number; // peak |pitch speed| during the swing, deg/s
  acc: number; // peak linear acceleration (gravity removed), m/s^2
  tilt: number; // phone pitch past rest at release, rad (signed)
  rate: number; // phone pitch speed at release, rad/s (signed)
  trigger: 'angle' | 'speed';
  source: 'orientation' | 'gyro';
  alpha: number; // raw rotationRate peaks, deg/s (for the log)
  beta: number;
  gamma: number;
  accSource: 'linear' | 'gravity-filtered';
}

export type PermissionResult = 'granted' | 'denied' | 'unsupported';

const DEG = Math.PI / 180;
const MIN_SPEED_RELEASE_DEG = 40; // a speed-peak release only counts past this pitch

type WithPermission = { requestPermission?: () => Promise<'granted' | 'denied'> };

/** Must be called from a user gesture on iOS (asks for motion + orientation). */
export async function requestMotionPermission(): Promise<PermissionResult> {
  if (typeof DeviceMotionEvent === 'undefined') return 'unsupported';
  const ask = async (api: unknown): Promise<boolean> => {
    const req = (api as WithPermission | undefined)?.requestPermission;
    if (typeof req !== 'function') return true;
    try {
      return (await req.call(api)) === 'granted';
    } catch {
      return false;
    }
  };
  const motion = await ask(DeviceMotionEvent);
  if (typeof DeviceOrientationEvent !== 'undefined') await ask(DeviceOrientationEvent);
  return motion ? 'granted' : 'denied';
}

export class FlickDetector {
  armed = false;
  /** True once a devicemotion event with real rotation data has arrived. */
  hasSensor = false;
  onFlick: (f: FlickSample) => void = () => {};
  /** Live |pitch speed| for the speed meter, deg/s. */
  live = 0;
  /** Live linear acceleration for the power meter, m/s^2. */
  liveAcc = 0;
  /** Phone pitch past its rest pose, radians (signed). */
  tilt = 0;
  /** Phone pitch speed, rad/s (signed). */
  rate = 0;

  private usingOrientation = false;
  private pitch = 0; // deg, absolute (orientation) or integrated (gyro)
  private base = 0;
  private lastOT = 0;
  private lastBeta = 0;
  private lastMT = 0;
  private accPeak = 0; // decaying peak, so the release sees the flick's power
  private swing = this.blank();
  private grav = { x: 0, y: 0, z: 0, init: false };

  start(): void {
    window.addEventListener('devicemotion', this.onMotion);
    window.addEventListener('deviceorientation', this.onOrientation);
  }

  stop(): void {
    window.removeEventListener('devicemotion', this.onMotion);
    window.removeEventListener('deviceorientation', this.onOrientation);
  }

  /** Arm a release. With `rebase`, the current pose becomes "rest". */
  arm(rebase = true): void {
    if (rebase) this.rebase();
    this.armed = true;
    this.swing = this.blank();
  }

  disarm(): void {
    this.armed = false;
  }

  rebase(): void {
    this.base = this.pitch;
    this.tilt = 0;
  }

  private blank(): FlickSample {
    return {
      rot: 0,
      acc: 0,
      tilt: 0,
      rate: 0,
      trigger: 'angle',
      source: 'orientation',
      alpha: 0,
      beta: 0,
      gamma: 0,
      accSource: 'linear',
    };
  }

  private onOrientation = (e: DeviceOrientationEvent): void => {
    if (e.beta === null) return;
    const t = e.timeStamp || performance.now();
    if (!this.usingOrientation) {
      // first reading: start the angle here so there's no jump
      this.usingOrientation = true;
      this.pitch = e.beta;
      this.base = e.beta;
      this.lastBeta = e.beta;
      this.lastOT = t;
      return;
    }
    const dt = Math.min(0.1, (t - this.lastOT) / 1000);
    this.lastOT = t;
    let d = e.beta - this.lastBeta;
    if (d > 180) d -= 360; // unwrap across +-180
    if (d < -180) d += 360;
    this.lastBeta = e.beta;
    this.pitch += d;
    if (dt > 0) this.setRate((d / dt) * DEG, dt);
    this.update();
  };

  private onMotion = (e: DeviceMotionEvent): void => {
    const rr = e.rotationRate;
    if (!rr || rr.alpha === null || rr.beta === null || rr.gamma === null) return;
    this.hasSensor = true;
    const t = e.timeStamp || performance.now();
    const dt = this.lastMT ? Math.min(0.1, (t - this.lastMT) / 1000) : 0;
    this.lastMT = t;

    // Linear acceleration: the OS value when available, otherwise
    // accelerationIncludingGravity minus a low-passed gravity estimate.
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
      gr.x += (x - gr.x) * 0.05;
      gr.y += (y - gr.y) * 0.05;
      gr.z += (z - gr.z) * 0.05;
      acc = Math.hypot(x - gr.x, y - gr.y, z - gr.z);
      src = 'gravity-filtered';
    }
    this.liveAcc = acc;
    this.accPeak = Math.max(acc, this.accPeak * Math.exp(-dt / 0.35));

    const s = this.swing;
    s.alpha = Math.max(s.alpha, Math.abs(rr.alpha));
    s.beta = Math.max(s.beta, Math.abs(rr.beta));
    s.gamma = Math.max(s.gamma, Math.abs(rr.gamma));
    s.accSource = src;

    // fallback when there's no orientation: integrate the gyro's pitch axis
    if (!this.usingOrientation && dt > 0) {
      this.pitch += rr.beta * dt;
      this.setRate(rr.beta * DEG, dt);
      this.update();
    }
  };

  private setRate(r: number, dt: number): void {
    // light smoothing: sensor rates are noisy sample to sample
    const k = 1 - Math.exp(-dt / 0.03);
    this.rate += (r - this.rate) * k;
    this.live = Math.abs(this.rate) / DEG;
  }

  private update(): void {
    this.tilt = (this.pitch - this.base) * DEG;
    if (!this.armed) return;
    // "forward" is the direction the held bottle swings up for a flip
    const dir = Math.sign(P.swingGain) || 1;
    const fwdTilt = (this.tilt * dir) / DEG;
    const fwdRate = (this.rate * dir) / DEG;
    const s = this.swing;
    s.source = this.usingOrientation ? 'orientation' : 'gyro';
    if (fwdRate > s.rot) {
      // new peak speed: remember the pose there in case we release at the peak
      s.rot = fwdRate;
      s.tilt = this.tilt;
      s.rate = this.rate;
    }
    if (fwdTilt >= P.releaseAngle && fwdRate > 0) {
      this.fire({ ...s, tilt: this.tilt, rate: this.rate, trigger: 'angle' });
    } else if (s.rot >= P.releaseRate && fwdRate < s.rot * 0.85 && (s.tilt * dir) / DEG >= MIN_SPEED_RELEASE_DEG) {
      this.fire({ ...s, trigger: 'speed' });
    }
  }

  private fire(sample: FlickSample): void {
    this.armed = false;
    sample.acc = this.accPeak;
    this.onFlick(sample);
  }
}
