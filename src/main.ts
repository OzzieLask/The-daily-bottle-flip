// Daily Bottle Flip: Phase 1 prototype.
// One kitchen scene, motion-sensor flick, physics bottle, landing tiers.
import './style.css';
import * as THREE from 'three';
import { loadSavedTuning, P } from './config';
import { initAudio, sfx } from './audio/sfx';
import { mapFlick, type MappedFlick } from './input/flickMap';
import { FlickDetector, requestMotionPermission, type FlickSample } from './input/motion';
import { BottleSim, type SimResult } from './physics/bottleSim';
import { RetroRenderer } from './render/retro';
import { BottleMesh } from './scene/bottleMesh';
import { buildKitchen } from './scene/kitchen';
import { appendLog, landRate, lifetime, record, session } from './ui/stats';

const DEBUG = new URLSearchParams(location.search).has('debug');
if (DEBUG) loadSavedTuning();

type State = 'title' | 'card' | 'ready' | 'flight' | 'result' | 'blocked';
let state: State = 'title';

// ---------- DOM ----------
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  canvas: $<HTMLCanvasElement>('game'),
  hud: $('hud'),
  title: $('title'),
  start: $<HTMLButtonElement>('start'),
  card: $('stagecard'),
  prompt: $('prompt'),
  callout: $('callout'),
  calloutMain: $('callout-main'),
  calloutSub: $('callout-sub'),
  stats: $('stats'),
  meter: $('meter'),
  meterFill: $('meter-fill'),
  message: $('message'),
  messageTitle: $('message-title'),
  messageBody: $('message-body'),
  messageBtn: $<HTMLButtonElement>('message-btn'),
};
const show = (el: HTMLElement, on = true) => el.classList.toggle('hidden', !on);

// ---------- world ----------
const retro = new RetroRenderer(ui.canvas);
const scene = new THREE.Scene();
buildKitchen(scene);
const camera = new THREE.PerspectiveCamera(50, 1, 0.02, 12);
const sim = new BottleSim();
const bottle = new BottleMesh(scene);
bottle.sync(sim);

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  retro.resize(w, h);
  camera.aspect = w / h;
  // keep roughly 52 degrees of horizontal view; portrait gets a taller frustum
  const hfov = (52 * Math.PI) / 180;
  const vfov = 2 * Math.atan(Math.tan(hfov / 2) / camera.aspect);
  camera.fov = Math.min(84, Math.max(40, (vfov * 180) / Math.PI));
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- camera ----------
const camPos = new THREE.Vector3(0.1, 0.22, 0.85);
const camLook = new THREE.Vector3(0.05, 0.12, 0);
const wantPos = new THREE.Vector3();
const wantLook = new THREE.Vector3();
let titleT = 0;

function updateCamera(dt: number, slow: boolean) {
  const portrait = camera.aspect < 1;
  const back = portrait ? 1.05 : 0.8;
  if (state === 'title') {
    titleT += dt * 0.25;
    wantLook.set(0, 0.15, -0.05);
    wantPos.set(Math.sin(titleT) * 0.6 + 0.05, 0.35 + Math.sin(titleT * 0.7) * 0.05, Math.cos(titleT) * 0.35 + 0.9);
  } else if (state === 'flight' || state === 'result') {
    const [ox, oy] = sim.origin();
    const fx = Math.min(P.counterMaxX + 0.2, ox);
    const fy = Math.max(0.06, Math.min(0.45, oy + 0.08));
    if (slow || (state === 'result' && sim.y > -0.1)) {
      wantLook.set(fx, Math.max(0.05, sim.y * 0.9), 0);
      wantPos.set(fx + 0.12, 0.09, back * 0.55);
    } else if (sim.y < -0.1) {
      wantLook.set(fx, sim.y, 0);
      wantPos.set(fx + 0.15, 0.1, back);
    } else {
      wantLook.set(fx * 0.7 + 0.02, fy * 0.8, 0);
      wantPos.set(fx * 0.6 + 0.12, 0.16 + fy * 0.4, back);
    }
  } else {
    wantLook.set(P.releaseX + 0.12, 0.13, 0);
    wantPos.set(P.releaseX + 0.24, 0.21, back);
  }
  const k = 1 - Math.exp(-dt * (state === 'title' ? 2 : 5));
  camPos.lerp(wantPos, k);
  camLook.lerp(wantLook, k);
  camera.position.copy(camPos);
  camera.lookAt(camLook);
}

// ---------- input ----------
const detector = new FlickDetector();
detector.onFlick = (f) => onFlick(f, 'sensor');

let lastFlick: { sample: Partial<FlickSample>; launch: MappedFlick; source: 'sensor' | 'debug' } | null = null;

function onFlick(sample: Partial<FlickSample> & { rot: number; acc: number }, source: 'sensor' | 'debug') {
  if (state !== 'ready' && !(state === 'result' && resultAge > 1.0)) return;
  const launch = mapFlick(sample);
  lastFlick = { sample, launch, source };
  debugApi?.markFlick(sample.rot, sample.acc);
  sim.reset();
  sim.launch(launch);
  timeScale = 1;
  touchTime = -1;
  state = 'flight';
  show(ui.prompt, false);
  show(ui.callout, false);
  detector.disarm();
  sfx.whoosh();
}

// ---------- flow ----------
ui.start.addEventListener('click', async () => {
  initAudio();
  sfx.select();
  const perm = await requestMotionPermission();
  if (perm === 'denied' && !DEBUG) {
    block(
      'MOTION ACCESS DENIED',
      'The flip is your wrist, so the game needs motion access. Tap below to ask again, or reload the page and choose Allow.',
      'ASK AGAIN',
      () => ui.start.click(),
    );
    return;
  }
  detector.start();
  show(ui.title, false);
  show(ui.message, false);
  startCard();
  if (!DEBUG) {
    setTimeout(() => {
      if (!detector.hasSensor) {
        block(
          'NO MOTION SENSOR FOUND',
          `This prototype is played by flicking a phone. Open this page on your phone:<br><br>${location.host}${location.pathname}`,
        );
      }
    }, 1800);
  }
});

function block(title: string, body: string, btn?: string, act?: () => void) {
  state = 'blocked';
  show(ui.title, false);
  show(ui.hud, false);
  ui.messageTitle.textContent = title;
  ui.messageBody.innerHTML = body;
  show(ui.messageBtn, !!btn);
  if (btn && act) {
    ui.messageBtn.textContent = btn;
    ui.messageBtn.onclick = act;
  }
  show(ui.message, true);
}

function startCard() {
  state = 'card';
  show(ui.card, true);
  show(ui.hud, true);
  updateStats();
  setTimeout(() => {
    show(ui.card, false);
    if (state === 'card') enterReady();
  }, 2000);
}

function enterReady() {
  state = 'ready';
  sim.reset();
  show(ui.callout, false);
  show(ui.prompt, true);
  detector.arm();
}

// Tap during the result screen (or a stalled flight) puts the bottle back in hand.
window.addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement).closest('#debug, button')) return;
  if (state === 'result' && resultAge > 0.6) enterReady();
});

const CALLOUTS: Record<SimResult['tier'], string> = {
  CAP: 'CAP LANDING!!',
  CLEAN: 'NICE!',
  WOBBLE: 'WOBBLE SAVE!',
  MISS: 'oof',
};

function showResult(r: SimResult) {
  state = 'result';
  resultAge = 0;
  record(r.tier);
  if (lastFlick) {
    appendLog({ at: new Date().toISOString(), ...lastFlick, result: r, ua: navigator.userAgent });
    debugApi?.refreshLog();
  }

  let main = CALLOUTS[r.tier];
  if (r.reason === 'fell') main = 'oof. off the edge';
  if (r.reason === 'noflip') main = 'no flip';
  ui.calloutMain.textContent = main;
  ui.calloutMain.className = r.tier === 'CAP' ? 'cap' : r.tier === 'MISS' ? 'miss' : '';
  const err = lastFlick?.launch.spinError ?? 0;
  const hint =
    r.tier !== 'MISS' ? '' : Math.abs(err) < 0.06 ? 'so close' : err < 0 ? 'flick a bit harder' : 'flick a bit softer';
  ui.calloutSub.innerHTML = [hint, `${r.rotations.toFixed(1)} TURNS`].filter(Boolean).join('<br>');
  // restart the pop animation
  show(ui.callout, false);
  void ui.callout.offsetWidth;
  show(ui.callout, true);

  if (r.tier === 'CAP') sfx.cap();
  else if (r.tier === 'CLEAN') sfx.nice();
  else if (r.tier === 'WOBBLE') sfx.wobble();
  else sfx.oof();
  if (r.tier !== 'MISS') navigator.vibrate?.(r.tier === 'CAP' ? [40, 60, 40, 60, 120] : 60);
  updateStats();
}

function updateStats() {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  ui.stats.innerHTML =
    `WARM-UP · ${session.flips} FLIPS · ${pct(landRate(session))} LANDED · ${session.tiers.CAP} CAP<br>` +
    `<span style="opacity:.7">ALL TIME ${lifetime.flips} · ${pct(landRate(lifetime))}</span>`;
}

// ---------- debug ----------
let debugApi: { refreshLog(): void; markFlick(rot: number, acc: number): void } | null = null;
if (DEBUG) {
  void import('./ui/debug').then(({ mountDebug }) => {
    debugApi = mountDebug({
      fire(rot, acc) {
        if (state === 'title') ui.start.click();
        if (state === 'card') {
          show(ui.card, false);
          enterReady();
        }
        onFlick({ rot, acc }, 'debug');
      },
    });
    // ?debug&auto=ROT,ACC : start and fire one synthetic flick (headless checks)
    const auto = new URLSearchParams(location.search).get('auto');
    if (auto !== null) {
      const [rot, acc] = (auto || '1300,35').split(',').map(Number);
      ui.start.click();
      setTimeout(() => {
        show(ui.card, false);
        enterReady();
        onFlick({ rot, acc }, 'debug');
        // &finish: run the sim to rest immediately (headless browsers render too few frames)
        if (new URLSearchParams(location.search).has('finish')) while (!sim.done) sim.step(SIM_DT);
      }, 600);
    }
  });
}

// ---------- loop ----------
const SIM_DT = 1 / 240;
let acc = 0;
let timeScale = 1;
let touchTime = -1;
let resultAge = 0;
let last = performance.now();
let idleT = 0;

function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  let slow = false;
  if (state === 'flight') {
    if (sim.touched && touchTime < 0) touchTime = sim.t;
    const nearLanding = !sim.touched && sim.vy < 0 && sim.lowestGap < 0.1 && sim.y > -0.05;
    const justLanded = touchTime >= 0 && sim.t - touchTime < 0.3;
    slow = nearLanding || justLanded;
    const target = slow ? P.slowmo : 1;
    timeScale += (target - timeScale) * (1 - Math.exp(-dt * 14));

    acc += dt * timeScale;
    let steps = 0;
    while (acc >= SIM_DT && steps < 40) {
      sim.step(SIM_DT);
      for (const e of sim.events) sfx.thunk(e.speed);
      acc -= SIM_DT;
      steps++;
      if (sim.done) break;
    }
    if (sim.done && sim.result) {
      acc = 0;
      showResult(sim.result);
      detector.arm(); // a new flick from the result screen relaunches
    }
  } else if (state === 'result') {
    resultAge += dt;
  }

  bottle.sync(sim);
  if (state === 'ready' || state === 'card' || state === 'title') {
    // idle sway in the hand
    idleT += dt;
    bottle.group.rotation.z = Math.sin(idleT * 1.7) * 0.03;
    bottle.group.position.y += Math.sin(idleT * 2.3) * 0.004;
  }

  ui.meterFill.style.height = `${Math.min(100, (detector.live / 1800) * 100)}%`;
  show(ui.meter, state === 'ready' || state === 'result');

  updateCamera(dt, slow);
  retro.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
