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

import { GEO, P } from '../config';
import { colliders, type Collider } from './world';

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
  /** What it came to rest on: 'island', 'back counter', 'floor'... */
  surface: string;
  /** Obstacles it bounced off before landing (lamp, wall). */
  hits: string[];
  bounced: boolean;
}

/** Everything needed to recreate a held bottle (for predicting a release). */
export interface HeldSnapshot {
  theta: number;
  px: number;
  py: number;
  s: number[];
  v: number[];
  fill: number;
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

/** The same hull as a counter-clockwise polygon, for box corners poking into the bottle. */
const POLY: ReadonlyArray<readonly [number, number]> = [
  [-GEO.baseR, 0],
  [GEO.baseR, 0],
  [GEO.R, 0.008],
  [GEO.R, GEO.shoulder],
  [GEO.capR, GEO.H],
  [-GEO.capR, GEO.H],
  [-GEO.R, GEO.shoulder],
  [-GEO.R, 0.008],
];
const POLY_N = POLY.map(([ax, ay], i) => {
  const [bx, by] = POLY[(i + 1) % POLY.length];
  const len = Math.hypot(bx - ax, by - ay);
  return [(by - ay) / len, -(bx - ax) / len] as const; // outward normal
});

const SPECULATIVE = 0.012;
const ITERATIONS = 20;
const TAU = Math.PI * 2;

export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

interface Contact {
  rx: number; // contact point relative to the shell COM
  ry: number;
  nx: number; // normal: the direction the bottle is pushed
  ny: number;
  gap: number; // >0 apart (speculative), <0 overlapping
  vn0: number;
  ln: number;
  lt: number;
  c: Collider;
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

  /** Test mode: the cap is pinned to the hand and the bottle is driven by the phone. */
  held = false;
  private heldS: [number, number] = [0, 0];
  private heldV: [number, number] = [0, 0];
  private heldPrev = 0;
  private pivotX = 0;
  private pivotY = 0;

  private world: Collider[] = colliders();
  private restOn = '';
  private hits: string[] = [];
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

    this.held = false;
    this.world = colliders();
    this.restOn = '';
    this.hits = [];
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

  /**
   * Test mode: hang the bottle from its cap at (px, py) and swing it to angle
   * `theta` (0 = hanging straight down from the hand). Nothing is released;
   * only the water moves, pushed by gravity and the swing's centrifugal pull,
   * so a flick visibly slams it into the base like a real one.
   */
  hold(dt: number, theta: number, px: number, py: number): void {
    if (!this.held) {
      this.held = true;
      this.heldS = [this.lo, this.lo + this.q];
      this.heldV = [0, 0];
      this.heldPrev = theta;
    }
    const omega = dt > 0 ? (theta - this.heldPrev) / dt : 0;
    this.heldPrev = theta;
    this.theta = theta;
    this.omega = omega;
    this.pivotX = px;
    this.pivotY = py;
    // place the shell so the cap top sits at the pivot
    const sn = Math.sin(theta);
    const cs = Math.cos(theta);
    const ox = px + sn * GEO.H;
    const oy = py - cs * GEO.H;
    this.x = ox - sn * GEO.shellCom;
    this.y = oy + cs * GEO.shellCom;
    this.vx = this.vy = 0;

    // water along the axis, in the frame rotating about the cap (s = H)
    const s = this.heldS;
    const v = this.heldV;
    for (let i = 0; i < 2; i++) {
      const acc = omega * omega * (s[i] - GEO.H) - P.gravity * cs - P.waterDamping * v[i];
      v[i] += acc * dt;
      s[i] += v[i] * dt;
    }
    const { lo, hi, q } = this;
    if (s[0] < lo) {
      s[0] = lo;
      if (v[0] < 0) v[0] = -v[0] * P.waterBounce;
    }
    if (s[1] > hi) {
      s[1] = hi;
      if (v[1] > 0) v[1] = -v[1] * P.waterBounce;
    }
    if (s[1] - s[0] < q) {
      const mid = Math.min(hi - q / 2, Math.max(lo + q / 2, (s[0] + s[1]) / 2));
      s[0] = mid - q / 2;
      s[1] = mid + q / 2;
      const vm = (v[0] + v[1]) / 2;
      v[0] = v[1] = vm;
    }
  }

  heldSnapshot(): HeldSnapshot {
    return {
      theta: this.theta,
      px: this.pivotX,
      py: this.pivotY,
      s: [...this.heldS],
      v: [...this.heldV],
      fill: P.fill,
    };
  }

  static fromHeld(snap: HeldSnapshot): BottleSim {
    const sim = new BottleSim();
    sim.reset(snap.fill);
    sim.hold(0, snap.theta, snap.px, snap.py);
    sim.heldS = [snap.s[0], snap.s[1]];
    sim.heldV = [snap.v[0], snap.v[1]];
    return sim;
  }

  /**
   * Let go. The bottle leaves the hand spinning at `omega` about the cap, so
   * every part keeps the velocity the swing gave it, plus the hand's lift.
   */
  release(omega: number, liftX: number, liftY: number): void {
    if (!this.held) return;
    const sn = Math.sin(this.theta);
    const cs = Math.cos(this.theta);
    const ux = -sn;
    const uy = cs;
    const [ox, oy] = this.origin();
    const px = this.pivotX;
    const py = this.pivotY;
    // the swing's speed about the hand, partly carried over (releaseCarry), plus the hand's lift
    const k = P.releaseCarry;
    const swing = (b: { x: number; y: number; vx: number; vy: number }) => {
      b.vx = -omega * (b.y - py) * k + liftX;
      b.vy = omega * (b.x - px) * k + liftY;
    };
    swing(this);
    this.slugs.forEach((g, i) => {
      g.x = ox + ux * this.heldS[i];
      g.y = oy + uy * this.heldS[i];
      swing(g);
      g.vx += ux * this.heldV[i];
      g.vy += uy * this.heldV[i];
    });
    this.omega = omega;
    this.held = false;
    this.launched = true;
  }

  /** Axial position of slug i, measured from the base. */
  slugS(i: number): number {
    if (this.held) return this.heldS[i];
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
    const add = (wx: number, wy: number, nx: number, ny: number, gap: number, c: Collider) => {
      const rx = wx - this.x;
      const ry = wy - this.y;
      const vn0 = (this.vx - this.omega * ry) * nx + (this.vy + this.omega * rx) * ny;
      contacts.push({ rx, ry, nx, ny, gap, vn0, ln: 0, lt: 0, c });
    };
    const reach = GEO.H + SPECULATIVE; // bottle fits in a circle this big around its base

    for (const c of this.world) {
      if (ox < c.minX - reach || ox > c.maxX + reach || oy < c.minY - reach || oy > c.maxY + reach) continue;

      // bottle corners against the box
      for (const [bx, by] of HULL) {
        const wx = ox + bx * cs - by * sn;
        const wy = oy + bx * sn + by * cs;
        if (c.kind === 'land' && wx >= c.minX && wx <= c.maxX && wy > c.maxY - 0.06) {
          lowest = Math.min(lowest, wy - c.maxY);
        }
        const dx = wx < c.minX ? c.minX - wx : wx > c.maxX ? wx - c.maxX : 0;
        const dy = wy < c.minY ? c.minY - wy : wy > c.maxY ? wy - c.maxY : 0;
        if (dx === 0 && dy === 0) {
          // inside: push out through the nearest face
          const faces = [wy - c.minY, c.maxY - wy, wx - c.minX, c.maxX - wx];
          const i = faces.indexOf(Math.min(...faces));
          const n = [
            [0, -1],
            [0, 1],
            [-1, 0],
            [1, 0],
          ][i];
          add(wx, wy, n[0], n[1], -faces[i], c);
        } else {
          const gap = Math.hypot(dx, dy);
          if (gap < SPECULATIVE) {
            const nx = dx === 0 ? 0 : wx < c.minX ? -dx / gap : dx / gap;
            const ny = dy === 0 ? 0 : wy < c.minY ? -dy / gap : dy / gap;
            add(wx, wy, nx, ny, gap, c);
          }
        }
      }

      // box corners poking into the bottle (catching an edge)
      for (const [kx, ky] of [
        [c.minX, c.maxY],
        [c.maxX, c.maxY],
        [c.minX, c.minY],
        [c.maxX, c.minY],
      ]) {
        // corner in body space
        const qx = (kx - ox) * cs + (ky - oy) * sn;
        const qy = -(kx - ox) * sn + (ky - oy) * cs;
        let best = -Infinity;
        let bi = 0;
        for (let i = 0; i < POLY.length; i++) {
          const d = (qx - POLY[i][0]) * POLY_N[i][0] + (qy - POLY[i][1]) * POLY_N[i][1];
          if (d > best) {
            best = d;
            bi = i;
          }
        }
        if (best < SPECULATIVE) {
          // push the bottle away from the corner, against that edge's normal
          const [enx, eny] = POLY_N[bi];
          add(kx, ky, -(enx * cs - eny * sn), -(enx * sn + eny * cs), best, c);
        }
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
        const { rx, ry, nx, ny } = ct;
        const tx = -ny; // tangent
        const ty = nx;
        const pvx = this.vx - this.omega * ry; // shell velocity at the contact point
        const pvy = this.vy + this.omega * rx;
        const vn = pvx * nx + pvy * ny;
        let target: number;
        if (ct.gap > 0) target = -ct.gap / dt;
        else {
          const bounce = ct.vn0 < -0.4 ? -P.restitution * ct.vn0 : 0;
          target = Math.max(bounce, Math.min((-ct.gap * 0.2) / dt, 0.3));
        }
        const rn = rx * ny - ry * nx;
        const kn = invMs + rn * rn * invIs;
        const ln = Math.max(0, ct.ln + (target - vn) / kn);
        const dn = ln - ct.ln;
        ct.ln = ln;
        this.vx += nx * dn * invMs;
        this.vy += ny * dn * invMs;
        this.omega += rn * dn * invIs;

        const qvx = this.vx - this.omega * ry;
        const qvy = this.vy + this.omega * rx;
        const vt = qvx * tx + qvy * ty;
        const rt = rx * ty - ry * tx;
        const kt = invMs + rt * rt * invIs;
        const maxF = P.friction * ct.ln;
        const lt = Math.max(-maxF, Math.min(maxF, ct.lt - vt / kt));
        const dl = lt - ct.lt;
        ct.lt = lt;
        this.vx += tx * dl * invMs;
        this.vy += ty * dl * invMs;
        this.omega += rt * dl * invIs;
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
    let onTop = false;
    for (const ct of this.contacts) {
      if (ct.ln > 1e-7) {
        touching = true;
        const top = ct.c.kind === 'land' && ct.ny > 0.7; // standing on a counter top
        if (top) {
          this.touched = true;
          onTop = true;
          this.restOn = ct.c.name;
        } else if (ct.c.kind === 'floor') this.restOn = 'floor';
        else if (ct.c.kind === 'obstacle') {
          // the lamp or the wall: a trick-shot bounce if it happens mid-air
          if (!this.touched && !this.hits.includes(ct.c.name)) this.hits.push(ct.c.name);
        }
        if (-ct.vn0 > impact) {
          impact = -ct.vn0;
          impactFloor = ct.c.kind === 'floor';
        }
      }
    }
    // Landing grip: stands in for sideways water slosh and the soft base, which
    // soak up spin on touchdown but aren't modelled directly.
    if (onTop) this.omega *= Math.exp(-P.landingGrip * dt);
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
    const onCounter = this.restOn !== 'floor' && this.restOn !== '' && this.y > -0.5;
    const maxTiltDeg = (this.maxTilt * 180) / Math.PI;
    const base = {
      rotations: turns,
      maxTiltDeg,
      surface: onCounter ? this.restOn : 'floor',
      hits: [...this.hits],
      bounced: this.bounced,
    };

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
    while (!sim.touched && !sim.done && sim.t < 3) sim.step(1 / 240);
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

/**
 * The release spin (signed like `dir`) that makes the bottle touch the counter
 * upright after one full turn from hanging, for a given held pose and lift.
 */
export function idealReleaseOmega(snap: HeldSnapshot, liftX: number, liftY: number, dir: number): number {
  const contactAngle = (w: number): number => {
    const sim = BottleSim.fromHeld(snap);
    sim.release(dir * w, liftX, liftY);
    while (!sim.touched && !sim.done && sim.t < 3) sim.step(1 / 240);
    return sim.theta * dir;
  };
  // Big spins can hit the lamp or reach the back counter, so contact angle
  // isn't monotonic over the whole range: scan up from slow spins for the
  // first bracket that completes a turn, then bisect inside it.
  let lo = 1;
  let hi = 0;
  for (let w = 2; w <= 40; w += 1.5) {
    if (contactAngle(w) >= TAU) {
      hi = w;
      break;
    }
    lo = w;
  }
  if (hi === 0) return dir * 40;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (contactAngle(mid) < TAU) lo = mid;
    else hi = mid;
  }
  return (dir * (lo + hi)) / 2;
}

/** Run a launch to completion without rendering (sweep script and debug map). */
export function simulate(l: Launch, dt = 1 / 240): SimResult {
  const sim = new BottleSim();
  sim.launch(l);
  while (!sim.done) sim.step(dt);
  return sim.result!;
}
