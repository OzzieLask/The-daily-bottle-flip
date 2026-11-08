// 2.5D bottle physics in the vertical x/y plane, solved with sequential impulses.
//
// Bodies:
//  - the plastic shell: a light rigid body (position, angle) that touches the world
//  - the water: two heavy point-mass "slugs" joined to the shell by a slider
//    joint, so they can only move along the bottle axis, between the base and
//    the shoulder, and never overlap each other
//
// Why two bodies: in flight, centrifugal pull spreads the water toward both
// ends, which raises the moment of inertia and slows the spin. On touchdown
// only the light shell is stopped by the table; the heavy water keeps sliding
// down the axis and slams into the base, planting the bottle instead of
// tipping it. Those two effects are what make a real water-bottle flip landable.
//
// Units are SI. theta is counter-clockwise; a flip spins clockwise (omega < 0).

import { FLOOR_Y, GEO, P } from '../config';

export type Tier = 'CAP' | 'CLEAN' | 'WOBBLE' | 'MISS';
export type MissReason = 'side' | 'fell' | 'noflip' | null;

export interface Launch {
  vx: number;
  vy: number;
  omega: number;
}

export interface SimResult {
  tier: Tier;
  reason: MissReason;
  rotations: number;
  maxTiltDeg: number;
}

export interface ImpactEvent {
  speed: number;
  floor: boolean;
}

/** Convex hull of the bottle outline in body space (origin = base centre). */
const HULL: ReadonlyArray<readonly [number, number]> = [
  [-GEO.baseR, 0],
  [GEO.baseR, 0],
  [-GEO.R, 0.008],
  [GEO.R, 0.008],
  [-GEO.R, GEO.shoulder],
  [GEO.R, GEO.shoulder],
  [-GEO.capR, GEO.H],
  [GEO.capR, GEO.H],
];

const SPECULATIVE = 0.012;
const ITERATIONS = 20;
const TAU = Math.PI * 2;

export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

interface Contact {
  rx: number;
  ry: number;
  gap: number;
  vn0: number;
  ln: number;
  lt: number;
  floor: boolean;
}

interface Slug {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export class BottleSim {
  // shell centre of mass
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  theta = 0;
  omega = 0;
  slugs: [Slug, Slug] = [
    { x: 0, y: 0, vx: 0, vy: 0 },
    { x: 0, y: 0, vx: 0, vy: 0 },
  ];

  // mass properties
  ms = GEO.shellMass;
  Is = 0; // shell + slugs' own spin inertia, about the shell COM
  mi = 0; // mass of one slug
  q = 0; // length of one slug
  lo = 0;
  hi = 0;

  t = 0;
  launched = false;
  done = false;
  result: SimResult | null = null;
  touched = false;
  bounced = false;
  maxTilt = 0;
  lowestGap = 1; // min height of the hull above the counter top
  events: ImpactEvent[] = [];

  private airAfterTouch = 0;
  private restTime = 0;
  private wasInContact = false;
  private contacts: Contact[] = [];
  private lam = { pa: 0, pb: 0, lo: 0, hi: 0, pair: 0 };

  constructor() {
    this.reset();
  }

  /** Back in the hand: upright at the release point, water settled at the base. */
  reset(fill = P.fill): void {
    const span = GEO.waterTop - GEO.waterBottom;
    const lw = Math.max(0.04, Math.min(0.95, fill)) * span;
    this.q = lw / 2;
    this.mi = (1000 * Math.PI * GEO.innerR * GEO.innerR * lw) / 2;
    this.lo = GEO.waterBottom + this.q / 2;
    this.hi = GEO.waterTop - this.q / 2;
    const iShell = GEO.shellMass * ((GEO.H * GEO.H) / 12 + (GEO.R * GEO.R) / 2);
    const iSlug = this.mi * ((this.q * this.q) / 12 + (GEO.innerR * GEO.innerR) / 4);
    this.Is = iShell + 2 * iSlug;

    this.theta = 0;
    this.omega = 0;
    this.x = P.releaseX;
    this.y = P.releaseY + GEO.shellCom;
    this.vx = 0;
    this.vy = 0;
    this.placeSlug(0, this.lo);
    this.placeSlug(1, this.lo + this.q);

    this.t = 0;
    this.launched = false;
    this.done = false;
    this.result = null;
    this.touched = false;
    this.bounced = false;
    this.maxTilt = 0;
    this.lowestGap = 1;
    this.airAfterTouch = 0;
    this.restTime = 0;
    this.wasInContact = false;
    this.events.length = 0;
  }

  private placeSlug(i: number, s: number): void {
    const [ox, oy] = this.origin();
    const g = this.slugs[i];
    g.x = ox - Math.sin(this.theta) * s;
    g.y = oy + Math.cos(this.theta) * s;
    g.vx = this.vx;
    g.vy = this.vy;
  }

  /** Spin the whole system about its combined centre of mass. */
  launch(l: Launch): void {
    const m = this.ms + 2 * this.mi;
    const cx = (this.ms * this.x + this.mi * (this.slugs[0].x + this.slugs[1].x)) / m;
    const cy = (this.ms * this.y + this.mi * (this.slugs[0].y + this.slugs[1].y)) / m;
    const setVel = (b: { x: number; y: number; vx: number; vy: number }) => {
      b.vx = l.vx - l.omega * (b.y - cy);
      b.vy = l.vy + l.omega * (b.x - cx);
    };
    setVel(this);
    this.slugs.forEach(setVel);
    this.omega = l.omega;
    this.launched = true;
  }

  /** World position of the base centre (the mesh origin). */
  origin(): [number, number] {
    return [this.x + Math.sin(this.theta) * GEO.shellCom, this.y - Math.cos(this.theta) * GEO.shellCom];
  }

  /** Axial position of slug i, measured from the base. */
  slugS(i: number): number {
    const [ox, oy] = this.origin();
    const g = this.slugs[i];
    return -(g.x - ox) * Math.sin(this.theta) + (g.y - oy) * Math.cos(this.theta);
  }

  step(dt: number): void {
    if (!this.launched || this.done) return;
    this.events.length = 0;

    const g = P.gravity * dt;
    this.vy -= g;
    for (const s of this.slugs) s.vy -= g;

    this.dampWater(dt);
    this.buildContacts();
    this.solve(dt);

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.theta += this.omega * dt;
    for (const s of this.slugs) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
    this.t += dt;
    this.track(dt);
  }

  /** Viscous drag of the water sliding relative to the bottle. */
  private dampWater(dt: number): void {
    const ux = -Math.sin(this.theta);
    const uy = Math.cos(this.theta);
    const k = 1 - Math.exp(-P.waterDamping * dt);
    const mRed = (this.mi * this.ms) / (this.mi + this.ms);
    for (const s of this.slugs) {
      const rx = s.x - this.x;
      const ry = s.y - this.y;
      const vr = (s.vx - (this.vx - this.omega * ry)) * ux + (s.vy - (this.vy + this.omega * rx)) * uy;
      const j = -vr * k * mRed;
      s.vx += (j * ux) / this.mi;
      s.vy += (j * uy) / this.mi;
      this.vx -= (j * ux) / this.ms;
      this.vy -= (j * uy) / this.ms;
    }
  }

  private buildContacts(): void {
    const sn = Math.sin(this.theta);
    const cs = Math.cos(this.theta);
    const [ox, oy] = this.origin();
    const contacts = this.contacts;
    contacts.length = 0;
    let lowest = 1;
    for (const [bx, by] of HULL) {
      const wx = ox + bx * cs - by * sn;
      const wy = oy + bx * sn + by * cs;
      const overCounter = wx >= P.counterMinX && wx <= P.counterMaxX && wy > -0.06;
      const gap = wy - (overCounter ? 0 : FLOOR_Y);
      if (overCounter) lowest = Math.min(lowest, gap);
      if (gap < SPECULATIVE) {
        const rx = wx - this.x;
        const ry = wy - this.y;
        contacts.push({ rx, ry, gap, vn0: this.vy + this.omega * rx, ln: 0, lt: 0, floor: !overCounter });
      }
    }
    this.lowestGap = lowest;
  }

  private solve(dt: number): void {
    const ux = -Math.sin(this.theta);
    const uy = Math.cos(this.theta);
    const nx = uy; // perpendicular to the axis (body +x)
    const ny = -ux;
    const [ox, oy] = this.origin();
    const invMs = 1 / this.ms;
    const invIs = 1 / this.Is;
    const invMi = 1 / this.mi;
    const [A, B] = this.slugs;
    const axial = (s: Slug) => (s.x - ox) * ux + (s.y - oy) * uy;
    const perp = (s: Slug) => (s.x - ox) * nx + (s.y - oy) * ny;
    const sa = axial(A);
    const sb = axial(B);
    const da = perp(A);
    const db = perp(B);
    const lam = this.lam;
    lam.pa = lam.pb = lam.lo = lam.hi = lam.pair = 0;

    // Impulse between slug and shell along direction (dx, dy), applied at the slug.
    const pairImpulse = (s: Slug, dx: number, dy: number, j: number) => {
      s.vx += dx * j * invMi;
      s.vy += dy * j * invMi;
      this.vx -= dx * j * invMs;
      this.vy -= dy * j * invMs;
      const rx = s.x - this.x;
      const ry = s.y - this.y;
      this.omega -= (rx * dy - ry * dx) * j * invIs;
    };
    // Velocity of slug relative to the shell material point under it, along (dx, dy).
    const relVel = (s: Slug, dx: number, dy: number) => {
      const rx = s.x - this.x;
      const ry = s.y - this.y;
      return (s.vx - (this.vx - this.omega * ry)) * dx + (s.vy - (this.vy + this.omega * rx)) * dy;
    };
    const effMass = (s: Slug, dx: number, dy: number) => {
      const rx = s.x - this.x;
      const ry = s.y - this.y;
      const rn = rx * dy - ry * dx;
      return 1 / (invMi + invMs + rn * rn * invIs);
    };
    const kPa = effMass(A, nx, ny);
    const kPb = effMass(B, nx, ny);
    const kAa = effMass(A, ux, uy);
    const kAb = effMass(B, ux, uy);
    const kPair = 1 / (2 * invMi);

    for (let it = 0; it < ITERATIONS; it++) {
      // --- shell vs world contacts ---
      for (const ct of this.contacts) {
        const vn = this.vy + this.omega * ct.rx;
        let target: number;
        if (ct.gap > 0) target = -ct.gap / dt;
        else {
          const bounce = ct.vn0 < -0.4 ? -P.restitution * ct.vn0 : 0;
          target = Math.max(bounce, Math.min((-ct.gap * 0.2) / dt, 0.3));
        }
        const kn = invMs + ct.rx * ct.rx * invIs;
        const ln = Math.max(0, ct.ln + (target - vn) / kn);
        const dn = ln - ct.ln;
        ct.ln = ln;
        this.vy += dn * invMs;
        this.omega += ct.rx * dn * invIs;

        const vt = this.vx - this.omega * ct.ry;
        const kt = invMs + ct.ry * ct.ry * invIs;
        const maxF = P.friction * ct.ln;
        const lt = Math.max(-maxF, Math.min(maxF, ct.lt - vt / kt));
        const dl = lt - ct.lt;
        ct.lt = lt;
        this.vx += dl * invMs;
        this.omega -= ct.ry * dl * invIs;
      }

      // --- slider joint: slugs stay on the axis ---
      {
        const j = -(relVel(A, nx, ny) + (0.2 * da) / dt) * kPa;
        lam.pa += j;
        pairImpulse(A, nx, ny, j);
      }
      {
        const j = -(relVel(B, nx, ny) + (0.2 * db) / dt) * kPb;
        lam.pb += j;
        pairImpulse(B, nx, ny, j);
      }

      // --- axial limits: A above the base, B below the shoulder ---
      {
        const target = -(sa - this.lo) / dt; // speculative/positional
        const vr = relVel(A, ux, uy);
        const l = Math.max(0, lam.lo + (target - vr) * kAa);
        pairImpulse(A, ux, uy, l - lam.lo);
        lam.lo = l;
      }
      {
        const target = (this.hi - sb) / dt;
        const vr = relVel(B, ux, uy);
        const l = Math.min(0, lam.hi + (target - vr) * kAb);
        pairImpulse(B, ux, uy, l - lam.hi);
        lam.hi = l;
      }
      // --- slugs don't overlap ---
      {
        const target = -(sb - sa - this.q) / dt;
        const vr = (B.vx - A.vx) * ux + (B.vy - A.vy) * uy;
        const l = Math.max(0, lam.pair + (target - vr) * kPair);
        const j = l - lam.pair;
        lam.pair = l;
        B.vx += ux * j * invMi;
        B.vy += uy * j * invMi;
        A.vx -= ux * j * invMi;
        A.vy -= uy * j * invMi;
      }
    }

    let impact = 0;
    let impactFloor = false;
    let touching = false;
    for (const ct of this.contacts) {
      if (ct.ln > 1e-7) {
        touching = true;
        if (!ct.floor) this.touched = true;
        if (-ct.vn0 > impact) {
          impact = -ct.vn0;
          impactFloor = ct.floor;
        }
      }
    }
    // Landing grip: stands in for sideways water slosh and the soft base, which
    // soak up spin on touchdown but aren't modelled directly.
    if (this.contacts.some((ct) => !ct.floor && ct.ln > 1e-7)) {
      this.omega *= Math.exp(-P.landingGrip * dt);
    }
    if (touching && !this.wasInContact && impact > 0.15) this.events.push({ speed: impact, floor: impactFloor });
    this.wasInContact = touching;
  }

  private track(dt: number): void {
    if (this.touched) {
      this.maxTilt = Math.max(this.maxTilt, Math.abs(wrapAngle(this.theta)));
      if (!this.wasInContact) {
        this.airAfterTouch += dt;
        if (this.airAfterTouch > 0.05) this.bounced = true;
      } else {
        this.airAfterTouch = 0;
      }
    }
    const speed = Math.hypot(this.vx, this.vy);
    if (this.wasInContact && speed < 0.03 && Math.abs(this.omega) < 0.25) this.restTime += dt;
    else this.restTime = 0;
    if (this.restTime > 0.35 || this.t > 7) this.finish();
  }

  private finish(): void {
    this.done = true;
    const a = wrapAngle(this.theta);
    const turns = Math.abs(this.theta) / TAU;
    const onCounter = this.y > -0.1;
    const maxTiltDeg = (this.maxTilt * 180) / Math.PI;
    const base = { rotations: turns, maxTiltDeg };

    if (!onCounter) this.result = { tier: 'MISS', reason: 'fell', ...base };
    else if (Math.abs(a) < 0.35) {
      if (turns < 0.75) this.result = { tier: 'MISS', reason: 'noflip', ...base };
      else
        this.result = {
          tier: maxTiltDeg < P.cleanTiltDeg && !this.bounced ? 'CLEAN' : 'WOBBLE',
          reason: null,
          ...base,
        };
    } else if (Math.abs(a) > Math.PI - 0.35) this.result = { tier: 'CAP', reason: null, ...base };
    else this.result = { tier: 'MISS', reason: 'side', ...base };
  }
}

/**
 * The spin that makes the bottle touch the counter after exactly one full turn
 * (perfectly upright) for a given launch speed. Found by bisection on the real
 * sim, so it adapts to fill level and any future daily twist automatically.
 */
export function idealOmega(vx: number, vy: number, turns = 1): number {
  const contactAngle = (omega: number): number => {
    const sim = new BottleSim();
    sim.launch({ vx, vy, omega });
    while (!sim.touched && sim.t < 3) sim.step(1 / 240);
    return sim.theta;
  };
  let lo = -2; // too little spin: theta > -2pi*turns
  let hi = -80;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (contactAngle(mid) > -TAU * turns) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Run a launch to completion without rendering (sweep script and debug map). */
export function simulate(l: Launch, dt = 1 / 240): SimResult {
  const sim = new BottleSim();
  sim.launch(l);
  while (!sim.done) sim.step(dt);
  return sim.result!;
}
