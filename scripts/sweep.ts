// Headless balance sweep: `npm run sweep`.
// 1. Raw landing window (no assist) over phone pitch speed (cols) x power (rows),
//    for a release at P.releaseAngle.
// 2. A player model: releases between 50-75 deg of pitch, at the target speed
//    with Gaussian error, reporting land% / cap% per assist level.
import { P } from '../src/config';
import { heldAt, mapRelease, simulateRelease, swingSpin, targetRate } from '../src/input/flickMap';
import type { Tier } from '../src/physics/bottleSim';

const CH: Record<Tier, string> = { CAP: '@', CLEAN: '#', WOBBLE: '+', MISS: '.' };
const DEG = Math.PI / 180;

function windowMap() {
  const rates = Array.from({ length: 56 }, (_, i) => 250 + i * 20);
  const accs = Array.from({ length: 16 }, (_, i) => 5 + i * 3.5);
  console.log(`raw window, release at ${P.releaseAngle}°: pitch ${rates[0]}..${rates.at(-1)} deg/s →, power rows`);
  for (const acc of [...accs].reverse()) {
    let row = '';
    for (const r of rates) row += CH[simulateRelease(r, acc, false).result.tier];
    console.log(acc.toFixed(1).padStart(5) + ' ' + row);
  }
}

function rng(seed: number) {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

function playerModel() {
  const N = 120;
  console.log(`\nplayer model (${N} releases per cell): land% / cap% by pitch-speed error sd`);
  const sigmas = [0.1, 0.2, 0.3];
  console.log('assist  ' + sigmas.map((s) => `sd ${s}`.padStart(13)).join(''));
  const saved = P.assist;
  for (const a of [0, 0.2, 0.4]) {
    P.assist = a;
    let row = String(a).padEnd(8);
    for (const sd of sigmas) {
      const r = rng(7);
      let land = 0;
      let cap = 0;
      for (let i = 0; i < N; i++) {
        const acc = 15 + r() * 45; // real flicks often hit 40-60 m/s^2
        const sim = heldAt(50 + r() * 25);
        const omega = swingSpin(targetRate(acc) * (1 + sd * gauss(r)) * DEG);
        const m = mapRelease(sim.heldSnapshot(), omega, acc);
        sim.release(m.omega, m.vx, m.vy);
        while (!sim.done) sim.step(1 / 240);
        const t = sim.result!.tier;
        if (t === 'CLEAN' || t === 'WOBBLE') land++;
        if (t === 'CAP') cap++;
      }
      row += `${((land / N) * 100).toFixed(0)}% / ${((cap / N) * 100).toFixed(1)}%`.padStart(13);
    }
    console.log(row);
  }
  P.assist = saved;
}

const t0 = performance.now();
if (!process.argv.includes('--no-map')) windowMap();
playerModel();
console.log(`\n${((performance.now() - t0) / 1000).toFixed(1)} s`);
