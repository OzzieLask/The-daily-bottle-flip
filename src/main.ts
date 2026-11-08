// Daily Bottle Flip: Phase 1 prototype.
// A sketched kitchen seen from behind the thrower's hand. The bottle is the only
// thing in colour, and a landing floods the world with colour from the bottle out.
// On a computer it runs as Big Screen Mode: a QR code pairs a phone as the controller.
import * as THREE from 'three';
import { GEO, loadSavedTuning, P } from './config';
import { initAudio, sfx } from './audio/sfx';
import { mapFlick, mapRelease, swingSpin, type MappedFlick } from './input/flickMap';
import { FlickDetector, requestMotionPermission, type FlickSample } from './input/motion';
import type { Host } from './pair/host';
import { BottleSim, type SimResult } from './physics/bottleSim';
import { fill, INK, SketchRenderer } from './render/sketch';
import { BottleMesh } from './scene/bottleMesh';
import { buildKitchen } from './scene/kitchen';
import { XRay } from './scene/xray';
import { FLICK_HINT, flickGuide, Meters, starRow } from './ui/sketchui';
import { scoreShot } from './scoring';
import { appendLog, landRate, record, session } from './ui/stats';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
if (DEBUG) loadSavedTuning();

// Computers (primary pointer is a mouse/trackpad) host Big Screen Mode.
// ?solo forces phone-style play, ?host forces big screen.
const BIG_SCREEN =
  !params.has('solo') && !params.has('auto') && (params.has('host') || matchMedia('(pointer: fine)').matches);
let host: Host | null = null;

type State = 'title' | 'pairing' | 'card' | 'ready' | 'flight' | 'result' | 'blocked';
let state: State = 'title';

// ---------- DOM ----------
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  canvas: $<HTMLCanvasElement>('game'),
  hud: $('hud'),
  title: $('title'),
  start: $<HTMLButtonElement>('start'),
  card: $('stagecard'),
  callout: $('callout'),
  calloutMain: $('callout-main'),
  calloutSub: $('callout-sub'),
  calloutStars: $('callout-stars'),
  guideWrap: $('guide-wrap'),
  guide: $('guide'),
  guideText: $('guide-text'),
  meters: $('hud-meters'),
  stats: $('stats'),
  message: $('message'),
  messageTitle: $('message-title'),
  messageBody: $('message-body'),
  messageBtn: $<HTMLButtonElement>('message-btn'),
  pair: $('pair'),
  pairTitle: $('pair-title'),
  pairCode: $('pair-code'),
  pairStatus: $('pair-status'),
  qr: $<HTMLCanvasElement>('qr'),
  actions: $('hud-actions'),
  btnTest: $<HTMLButtonElement>('btn-test'),
  btnReset: $<HTMLButtonElement>('btn-reset'),
};
const show = (el: HTMLElement, on = true) => el.classList.toggle('hidden', !on);

// ---------- test mode: practise the flick, the bottle never leaves the hand ----------
let testMode = false;
let testBlend = 0;
let remoteTilt = 0;

function setTest(on: boolean) {
  testMode = on;
  ui.btnTest.classList.toggle('on', on);
  if (!BIG_SCREEN) document.body.classList.toggle('test', on);
  if (state === 'ready' || state === 'flight' || state === 'result') enterReady();
}

ui.btnTest.addEventListener('click', () => setTest(!testMode));
ui.btnReset.addEventListener('click', () => resetBottle());

/** Back to the hand from wherever the bottle is. */
function resetBottle() {
  if (state === 'ready' || state === 'flight' || state === 'result') enterReady();
}

const meters = new Meters(ui.meters);

// ---------- world ----------
const renderer = new SketchRenderer(ui.canvas);
const scene = new THREE.Scene();
buildKitchen(scene);
// everything solid in the kitchen, for the x-ray's line-of-sight test
const occluders = scene.children.filter((o) => (o as THREE.Mesh).isMesh);
const xray = new XRay();
const camera = new THREE.PerspectiveCamera(55, 1, 0.02, 12);
const sim = new BottleSim();
const bottle = new BottleMesh(scene);
bottle.sync(sim);

// Test mode: the hand holds the cap here (the bottle's resting cap position),
// and an ink mark shows the rotation axis through the cap plus the circle the
// base sweeps around it.
const PIVOT = { x: P.releaseX, y: P.releaseY + GEO.H };
const ink = new THREE.MeshBasicMaterial({ color: INK });
const pivotMark = new THREE.Group();
pivotMark.position.set(PIVOT.x, PIVOT.y, 0);
const axis = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.16, 6), ink);
axis.rotation.x = Math.PI / 2; // along z: the axis the flick turns about
const hub = new THREE.Mesh(new THREE.SphereGeometry(0.008, 10, 6), ink);
const sweep = new THREE.Mesh(new THREE.TorusGeometry(GEO.H, 0.0011, 4, 72), ink);
const tick = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.03, 0.003), ink); // marks the base on the circle
tick.position.y = -GEO.H;
pivotMark.add(axis, hub, sweep, tick);
pivotMark.visible = false;
scene.add(pivotMark);

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.resize(w, h);
  camera.aspect = w / h;
  const hfov = (64 * Math.PI) / 180;
  const vfov = 2 * Math.atan(Math.tan(hfov / 2) / camera.aspect);
  camera.fov = Math.min(80, Math.max(42, (vfov * 180) / Math.PI));
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- camera: behind the hand, looking down the island ----------
const camPos = new THREE.Vector3(P.releaseX - 0.5, 0.27, 0.07);
const camLook = new THREE.Vector3(0.1, 0.04, 0);
const wantPos = new THREE.Vector3();
const wantLook = new THREE.Vector3();
let titleT = 0;

function updateCamera(dt: number, slow: boolean) {
  const [ox, oy] = sim.origin();
  if (testMode && state === 'ready') {
    // three-quarter side view so the swing around the cap reads as a circle
    wantLook.set(PIVOT.x + 0.02, PIVOT.y - 0.1, 0);
    wantPos.set(PIVOT.x - 0.32, PIVOT.y + 0.02, 0.62);
  } else if (state === 'title' || state === 'pairing') {
    titleT += dt * 0.2;
    wantLook.set(0.2, 0.0, 0);
    wantPos.set(-0.9 + Math.sin(titleT) * 0.15, 0.55 + Math.sin(titleT * 0.7) * 0.05, Math.sin(titleT * 0.8) * 0.5);
  } else if (state === 'flight') {
    if (sim.y < -0.1) {
      wantLook.set(ox, sim.y, 0);
      wantPos.set(ox - 0.7, 0.2, 0.15);
    } else if (slow) {
      wantLook.set(ox + 0.06, Math.max(0.03, oy + 0.06), 0);
      wantPos.set(ox - 0.34, 0.15, 0.06);
    } else {
      wantLook.set(ox * 0.5 + 0.08, Math.max(0.04, sim.y * 0.6), 0);
      wantPos.set(P.releaseX - 0.5, 0.27, 0.07);
    }
  } else if (state === 'result') {
    if (filling()) {
      // pull up and back so the colour can be seen rolling across the room
      const t = Math.min(1, resultAge / 2.2);
      wantLook.set(ox + 0.3 * t, 0.02, 0);
      wantPos.set(ox - 0.35 - 0.6 * t, 0.15 + 0.4 * t, 0.06 + 0.3 * t);
    } else if (sim.y < -0.1) {
      wantLook.set(ox, sim.y, 0);
      wantPos.set(ox - 0.7, 0.2, 0.15);
    } else {
      wantLook.set(ox + 0.04, 0.05, 0);
      wantPos.set(ox - 0.36, 0.16, 0.08);
    }
  } else {
    wantLook.set(0.1, 0.04, 0);
    wantPos.set(P.releaseX - 0.5, 0.27, 0.07);
  }
  const k = 1 - Math.exp(-dt * (state === 'title' ? 1.5 : 4));
  camPos.lerp(wantPos, k);
  camLook.lerp(wantLook, k);
  camera.position.copy(camPos);
  camera.lookAt(camLook);
}

// ---------- colour fill ----------
let fillAge = -1;
let fillDur = 1.6;
const FILL_MAX = 7;
const filling = () => fillAge >= 0;

const FILL_SECONDS = 3.4; // how long the colour takes to roll across the room

function startFill(cap: boolean) {
  const [ox, oy] = sim.origin();
  fill.origin.value.set(ox, oy, 0);
  fill.radius.value = 0;
  fillAge = 0;
  fillDur = cap ? FILL_SECONDS * 0.75 : FILL_SECONDS;
}

function clearFill() {
  fillAge = -1;
  fill.radius.value = 0;
}

// ---------- input ----------
const detector = new FlickDetector();
detector.onFlick = (f) => onFlick(f, 'sensor');

type FlickSource = 'sensor' | 'debug' | 'remote';
let lastFlick: { sample: Partial<FlickSample>; launch: MappedFlick; source: FlickSource } | null = null;

function onFlick(sample: Partial<FlickSample> & { rot: number; acc: number }, source: FlickSource) {
  if (testMode) {
    // practice: the swing would have released here; show it, keep holding
    if (source !== 'remote') meters.flick(sample.rot, sample.acc);
    navigator.vibrate?.(25);
    setTimeout(() => detector.arm(false), 300);
    return;
  }
  if (state !== 'ready') return;
  host?.send({ t: 'state', state: 'flight' });
  let launch: MappedFlick;
  if (sample.tilt !== undefined && sample.rate !== undefined) {
    // the real throw: let go of the swinging bottle at the pose it's in
    const a = sample.tilt * P.swingGain;
    if (source !== 'sensor' || !sim.held) {
      // bring the held bottle to the phone's exact pose (a quick ramp, so the water feels it)
      const from = sim.held ? sim.theta : 0;
      for (let k = 1; k <= 12; k++) sim.hold(1 / 60, from + ((a - from) * k) / 12, PIVOT.x, PIVOT.y);
    }
    launch = mapRelease(sim.heldSnapshot(), swingSpin(sample.rate), sample.acc);
    sim.release(launch.omega, launch.vx, launch.vy);
  } else {
    // synthetic debug flick: the old upright launch
    launch = mapFlick(sample);
    sim.reset();
    sim.launch(launch);
  }
  lastFlick = { sample, launch, source };
  debugApi?.markFlick(sample.rot, sample.acc);
  if (source === 'sensor') meters.flick(sample.rot, sample.acc);
  clearFill();
  timeScale = 1;
  touchTime = -1;
  state = 'flight';
  show(ui.guideWrap, false);
  show(ui.callout, false);
  detector.disarm();
  sfx.whoosh();
}

/** Debug: a swing released at the release angle at `rot` deg/s of phone pitch. */
function syntheticRelease(rot: number, acc: number) {
  const dir = Math.sign(P.swingGain) || 1;
  const DEG = Math.PI / 180;
  return { rot, acc, tilt: dir * P.releaseAngle * DEG, rate: dir * rot * DEG };
}

// ---------- flow ----------
ui.start.addEventListener('click', async () => {
  initAudio();
  sfx.select();
  if (BIG_SCREEN) {
    show(ui.title, false);
    void beginPairing('Scan with your phone');
    return;
  }
  const perm = await requestMotionPermission();
  if (perm === 'denied' && !DEBUG) {
    block('Motion access needed', 'Your wrist is the controller. Tap below to ask again, or reload and choose Allow.', 'Ask again', () =>
      ui.start.click(),
    );
    return;
  }
  detector.start();
  show(ui.title, false);
  show(ui.message, false);
  startCard();
  if (!DEBUG) {
    setTimeout(() => {
      if (!detector.hasSensor) block('No motion sensor', 'Open this page on your phone, or on a computer to pair one.');
    }, 1800);
  }
});

async function beginPairing(title: string) {
  state = 'pairing';
  show(ui.hud, false);
  show(ui.callout, false);
  ui.pairTitle.textContent = title;
  show(ui.pair, true);
  if (host) {
    ui.pairStatus.textContent = 'Waiting for phone…';
    return;
  }
  ui.pairStatus.textContent = 'Connecting…';
  const { startHost } = await import('./pair/host');
  host = await startHost({
    onFlick: (s) => onFlick(s, 'remote'),
    onReset: () => resetBottle(),
    onTest: (on) => setTest(on),
    onTilt: (a) => {
      remoteTilt = a;
    },
    onConnect: () => {
      sfx.select();
      show(ui.pair, false);
      startCard();
    },
    onDisconnect: () => {
      if (testMode) setTest(false);
      if (state !== 'title' && state !== 'blocked') void beginPairing('Phone disconnected');
    },
    onError: (msg) => {
      ui.pairStatus.textContent = msg;
    },
  });
  await host.drawQr(ui.qr);
  ui.pairCode.textContent = host.code;
  ui.pairStatus.textContent = 'Waiting for phone…';
}

function block(title: string, body: string, btn?: string, act?: () => void) {
  state = 'blocked';
  show(ui.title, false);
  show(ui.hud, false);
  ui.messageTitle.textContent = title;
  ui.messageBody.textContent = body;
  show(ui.messageBtn, !!btn);
  if (btn && act) {
    ui.messageBtn.textContent = btn;
    ui.messageBtn.onclick = act;
  }
  show(ui.message, true);
}

function startCard() {
  state = 'card';
  host?.send({ t: 'state', state: 'wait' });
  show(ui.card, true);
  show(ui.hud, true);
  show(ui.actions, !host); // the paired phone has its own buttons
  updateStats();
  setTimeout(() => {
    show(ui.card, false);
    if (state === 'card') enterReady();
  }, 1800);
}

function enterReady() {
  state = 'ready';
  clearFill();
  sim.reset();
  show(ui.callout, false);
  if (host) {
    ui.guide.innerHTML = '';
    ui.guideText.textContent = testMode ? 'Test mode · practise the flick' : 'Flick your phone';
  } else {
    ui.guide.innerHTML = flickGuide();
    ui.guideText.textContent = testMode ? 'Test mode · swing it by the cap' : FLICK_HINT;
  }
  show(ui.guideWrap, true);
  detector.arm();
  host?.send({ t: 'state', state: 'ready' });
}

// Big screen: click anywhere to put the bottle back in hand. Phones use the
// Reset button instead, so a pinching thumb can't reset by accident.
window.addEventListener('pointerdown', (e) => {
  if (!BIG_SCREEN || (e.target as HTMLElement).closest('#debug, button')) return;
  if (state === 'flight' || (state === 'result' && resultAge > 0.6)) enterReady();
});

let bestStars = 0; // this session

const CALLOUTS: Record<SimResult['tier'], string> = {
  CAP: 'Cap landing',
  CLEAN: 'Nice',
  WOBBLE: 'Wobble save',
  MISS: 'Miss',
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
  if (r.reason === 'fell') main = 'Off the edge';
  if (r.reason === 'noflip') main = 'No flip';
  const err = lastFlick?.launch.spinError ?? 0;
  const score = scoreShot(r);
  bestStars = Math.max(bestStars, score.stars);
  const sub =
    r.tier !== 'MISS' ? score.tags.join(' · ') : Math.abs(err) < 0.06 ? 'So close' : err < 0 ? 'A bit faster' : 'A bit slower';
  ui.calloutMain.textContent = main;
  ui.calloutStars.innerHTML = score.stars ? starRow(score.stars) : '';
  ui.calloutSub.textContent = sub;
  // a tick per star as they pop in
  for (let i = 0; i < score.stars; i++) setTimeout(() => sfx.star(i), 150 + i * 120);
  show(ui.callout, false);
  void ui.callout.offsetWidth; // restart the pop animation
  show(ui.callout, true);
  host?.send({
    t: 'result',
    tier: r.tier,
    main,
    sub,
    stars: score.stars,
    fill: r.tier === 'MISS' ? 0 : r.tier === 'CAP' ? FILL_SECONDS * 0.75 : FILL_SECONDS,
  });

  if (r.tier !== 'MISS') startFill(r.tier === 'CAP');
  if (r.tier === 'CAP') sfx.cap();
  else if (r.tier === 'CLEAN') sfx.nice();
  else if (r.tier === 'WOBBLE') sfx.wobble();
  else sfx.oof();
  if (r.tier !== 'MISS') navigator.vibrate?.(r.tier === 'CAP' ? [40, 60, 40, 60, 120] : 60);
  updateStats();
}

function updateStats() {
  const landed = Math.round(landRate(session) * session.flips);
  ui.stats.textContent = session.flips
    ? `${landed} / ${session.flips} landed` + (bestStars ? ` · best ${'★'.repeat(bestStars)}` : '')
    : '';
}

// ---------- debug ----------
let debugApi: { refreshLog(): void; markFlick(rot: number, acc: number): void } | null = null;
if (DEBUG) {
  void import('./ui/debug').then(({ mountDebug }) => {
    debugApi = mountDebug({
      fire(rot, acc) {
        if (state === 'title') ui.start.click();
        if (state === 'card' || state === 'pairing') {
          show(ui.card, false);
          show(ui.pair, false);
          show(ui.hud, true);
          enterReady();
        }
        onFlick(syntheticRelease(rot, acc), 'debug');
      },
    });
    // ?debug&auto=ROT,ACC : start and fire one synthetic flick (headless checks)
    const auto = params.get('auto');
    if (auto !== null) {
      const [rot, acc] = (auto || '440,30').split(',').map(Number);
      ui.start.click();
      const wait = setInterval(() => {
        if (state !== 'card') return;
        clearInterval(wait);
        show(ui.card, false);
        if (params.has('test')) setTest(true);
        enterReady();
        onFlick(syntheticRelease(rot, acc), 'debug');
        // &finish: run the sim to rest immediately (headless browsers render too few frames)
        if (params.has('finish')) while (!sim.done) sim.step(SIM_DT);
      }, 50);
    }
  });
}

// ---------- loop ----------
const SIM_DT = 1 / 240;
const RESULT_HOLD = 5.5; // s on the result before the bottle is back in hand
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
    timeScale += ((slow ? P.slowmo : 1) - timeScale) * (1 - Math.exp(-dt * 14));

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
    }
  } else if (state === 'result') {
    resultAge += dt;
    // back in hand on its own after the colour has had its moment
    if (resultAge > RESULT_HOLD) enterReady();
  }

  if (filling()) {
    fillAge += dt;
    const t = Math.min(1, fillAge / fillDur);
    fill.radius.value = FILL_MAX * (1 - Math.pow(1 - t, 3));
  }

  testBlend += ((testMode ? 1 : 0) - testBlend) * (1 - Math.exp(-dt * 5));
  renderer.test = testBlend;
  const holding = state === 'ready';
  if (holding) {
    // the bottle hangs from the cap in your hand and follows the phone's pitch
    // until it's released; the water sloshes with the swing
    let a = (host ? remoteTilt : detector.tilt) * P.swingGain;
    // desktop debug has no sensor: swing on a loop so test mode can be seen
    if (testMode && DEBUG && !host && !detector.hasSensor) a = Math.sin((now / 1000) * 2.2) * 1.3;
    sim.hold(dt, a, PIVOT.x, PIVOT.y);
  }
  bottle.sync(sim);
  pivotMark.visible = holding && testMode;
  if (holding) {
    // the swing path of the base around the cap
    pivotMark.rotation.z = sim.theta;
  } else if (state === 'ready' || state === 'card' || state === 'title' || state === 'pairing') {
    idleT += dt;
    bottle.group.rotation.z = Math.sin(idleT * 1.7) * 0.03;
    bottle.group.position.y += Math.sin(idleT * 2.3) * 0.004;
  }

  const showMeters = !host && (state === 'ready' || state === 'result' || state === 'flight');
  show(ui.meters, showMeters);
  if (showMeters) meters.live(detector.live, detector.liveAcc);

  if (DEBUG) document.body.dataset.state = `${state} t=${sim.t.toFixed(2)} fill=${fill.radius.value.toFixed(2)} xray=${xray.amount.toFixed(2)} y=${sim.y.toFixed(2)}`;
  updateCamera(dt, slow);
  if (state !== 'title' && state !== 'pairing') xray.update(sim, camera, occluders, dt);
  renderer.render(scene, camera, now / 1000, xray.scene);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
