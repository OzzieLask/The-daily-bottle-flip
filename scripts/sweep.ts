// Headless balance sweep: `npm run sweep`.
// 1. A map of tiers over wrist spin (columns) x peak accel (rows).
// 2. A player model: flicks aimed at the sweet spot with Gaussian spin error,
//    reporting land% / cap% per assist level, to tune toward the 25-45% target.
import { P } from '../src/config';
import { idealOmega, simulate, type Tier } from '../src/physics/bottleSim';
import { mapFlick } from '../src/input/flickMap';

const CH: Record<Tier, string> = { CAP: '@', CLEAN: '#', WOBBLE: '+', MISS: '.' };
const DEG = Math.PI / 180;

function flickMap() {
  const rots = Array.from({ length: 56 }, (_, i) => 300 + i * 40);
  const accs = Array.from({ length: 22 }, (_, i) => 5 + i * 2.5);
  const counts: Record<Tier, number> = { CAP: 0, CLEAN: 0, WOBBLE: 0, MISS: 0 };
  console.log(`flick space (assist ${P.assist}): rot ${rots[0]}..${rots.at(-1)} deg/s, acc rows`);
  for (const acc of [...accs].reverse()) {
    let row = '';
    for (const rot of rots) {
      const r = simulate(mapFlick({ rot, acc }));
      counts[r.tier]++;
      row += CH[r.tier];
    }
    console.log(acc.toFixed(1).padStart(5) + ' ' + row);
  }
  const n = rots.length * accs.length;
  console.log(
    Object.entries(counts)
      .map(([k, v]) => `${k} ${((v / n) * 100).toFixed(1)}%`)
      .join('  '),
  );
}

function rng(seed: number) {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
}
function gauss(r: () => number) {
  return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
}

function playerModel() {
  const N = 150;
  console.log(`\nplayer model (${N} flicks per cell): land% / cap% by spin error sd`);
  const assists = [0, 0.4, 0.6, 0.75];
  const sigmas = [0.05, 0.1, 0.15, 0.2, 0.3];
  console.log('assist  ' + sigmas.map((s) => `sd ${s}`.padStart(13)).join(''));
  const saved = P.assist;
  // ideal spin depends only on vy: cache it per acc bucket
  const idealCache = new Map<number, number>();
  for (const a of assists) {
    P.assist = a;
    let row = String(a).padEnd(8);
    for (const sd of sigmas) {
      const r = rng(42);
      let land = 0;
      let cap = 0;
      for (let i = 0; i < N; i++) {
        const acc = Math.round(20 + r() * 30);
        const vy = Math.min(P.maxVy, Math.max(P.minVy, P.launchBase + acc * P.launchScale));
        let ideal = idealCache.get(acc);
        if (ideal === undefined) idealCache.set(acc, (ideal = idealOmega(P.launchVx, vy)));
        const rot = (-ideal / (P.spinScale * DEG)) * (1 + sd * gauss(r));
        const res = simulate(mapFlick({ rot, acc }));
        if (res.tier === 'CLEAN' || res.tier === 'WOBBLE') land++;
        if (res.tier === 'CAP') cap++;
      }
      row += `${((land / N) * 100).toFixed(0)}% / ${((cap / N) * 100).toFixed(1)}%`.padStart(13);
    }
    console.log(row);
  }
  P.assist = saved;
}

const t0 = performance.now();
if (!process.argv.includes('--no-map')) flickMap();
playerModel();
console.log(`\n${((performance.now() - t0) / 1000).toFixed(1)} s`);
