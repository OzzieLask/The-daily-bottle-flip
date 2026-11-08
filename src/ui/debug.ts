// Developer-only tuning panel, loaded when the URL has ?debug.
//  - sliders for every tuning value (saved locally, debug sessions only)
//  - synthetic flicks so feel can be tested on desktop
//  - landing-window heatmap over flick space (wrist spin x peak accel)
//  - raw flick log from real phones, copyable as JSON
import { DEFAULTS, P, saveTuning, TUNING_KEY, type Tuning } from '../config';
import { mapFlick } from '../input/flickMap';
import { simulate, type Tier } from '../physics/bottleSim';
import { clearLog, readLog } from './stats';

type Range = [min: number, max: number, step: number];
const SLIDERS: Partial<Record<keyof Tuning, Range>> = {
  fill: [0.1, 0.9, 0.01],
  assist: [0, 0.95, 0.01],
  assistWidth: [0.05, 0.8, 0.01],
  spinScale: [0.2, 1.2, 0.01],
  launchBase: [0, 2.5, 0.05],
  launchScale: [0.01, 0.12, 0.001],
  launchVx: [0, 0.8, 0.01],
  landingGrip: [0, 120, 1],
  friction: [0.1, 1.2, 0.01],
  restitution: [0, 0.5, 0.01],
  waterDamping: [0, 30, 0.5],
  cleanTiltDeg: [3, 30, 1],
  slowmo: [0.1, 1, 0.01],
  gravity: [5, 15, 0.1],
};

const TIER_RGB: Record<Tier, [number, number, number]> = {
  CAP: [255, 210, 63],
  CLEAN: [110, 231, 183],
  WOBBLE: [58, 155, 255],
  MISS: [40, 34, 60],
};

const ROT_RANGE: [number, number] = [300, 2500];
const ACC_RANGE: [number, number] = [5, 60];

export interface DebugHooks {
  fire(rot: number, acc: number): void;
}

export function mountDebug(hooks: DebugHooks): { refreshLog(): void; markFlick(rot: number, acc: number): void } {
  const root = document.createElement('div');
  root.id = 'debug';
  root.innerHTML = `
    <div class="dbg-head"><span>DEBUG · tuning</span><button data-act="toggle">hide</button></div>
    <h4>Synthetic flick (Space)</h4>
    <label>wrist deg/s<input type="range" id="d-rot" min="${ROT_RANGE[0]}" max="${ROT_RANGE[1]}" step="10" value="1300"><span id="d-rot-v"></span></label>
    <label>peak m/s²<input type="range" id="d-acc" min="${ACC_RANGE[0]}" max="${ACC_RANGE[1]}" step="0.5" value="35"><span id="d-acc-v"></span></label>
    <div id="d-preview" class="log"></div>
    <button data-act="fire">FIRE</button><button data-act="ideal">snap to ideal spin</button>
    <h4>Landing window (rows: accel ↑, cols: wrist spin →)</h4>
    <canvas id="d-map" width="88" height="44"></canvas>
    <div class="legend"><span style="color:#6ee7b7">■ clean</span><span style="color:#3a9bff">■ wobble</span><span style="color:#ffd23f">■ cap</span><span>■ miss</span></div>
    <div id="d-mapstat" class="log"></div>
    <button data-act="map">recompute map</button>
    <h4>Tuning</h4>
    <div id="d-sliders"></div>
    <button data-act="reset">reset defaults</button><button data-act="copytune">copy tuning JSON</button>
    <h4>Flick log (this device)</h4>
    <div id="d-log" class="log"></div>
    <button data-act="copylog">copy log JSON</button><button data-act="clearlog">clear log</button>
  `;
  document.body.appendChild(root);

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const rotIn = $<HTMLInputElement>('#d-rot');
  const accIn = $<HTMLInputElement>('#d-acc');
  const mapCanvas = $<HTMLCanvasElement>('#d-map');
  const mapCtx = mapCanvas.getContext('2d')!;
  let mapImage: ImageData | null = null;
  let marker: [number, number] | null = null;

  const preview = () => {
    $('#d-rot-v').textContent = rotIn.value;
    $('#d-acc-v').textContent = accIn.value;
    const m = mapFlick({ rot: +rotIn.value, acc: +accIn.value });
    $('#d-preview').textContent =
      `vy ${m.vy.toFixed(2)} m/s  ω ${m.omega.toFixed(1)} rad/s\n` +
      `ideal ω ${m.idealOmega.toFixed(1)}  spin err ${(m.spinError * 100).toFixed(0)}%`;
  };
  rotIn.oninput = accIn.oninput = preview;

  // sliders
  const sliders = $('#d-sliders');
  for (const [key, [min, max, step]] of Object.entries(SLIDERS) as [keyof Tuning, Range][]) {
    const row = document.createElement('label');
    row.innerHTML = `${key}<input type="range" min="${min}" max="${max}" step="${step}"><span></span>`;
    const input = row.querySelector('input')!;
    const out = row.querySelector('span')!;
    const sync = () => {
      input.value = String(P[key]);
      out.textContent = String(+P[key].toFixed(3));
    };
    sync();
    input.oninput = () => {
      P[key] = +input.value;
      out.textContent = String(+P[key].toFixed(3));
      saveTuning();
      preview();
      if (!root.classList.contains('collapsed')) scheduleMap();
    };
    (row as HTMLLabelElement & { sync?: () => void }).sync = sync;
    sliders.appendChild(row);
  }

  function drawMap() {
    if (!mapImage) return;
    mapCtx.putImageData(mapImage, 0, 0);
    if (marker) {
      const [x, y] = marker;
      mapCtx.fillStyle = '#ff3df5';
      mapCtx.fillRect(x - 1, y, 3, 1);
      mapCtx.fillRect(x, y - 1, 1, 3);
    }
  }

  let mapTimer = 0;
  function scheduleMap() {
    clearTimeout(mapTimer);
    mapTimer = window.setTimeout(computeMap, 400);
  }

  function computeMap() {
    const W = mapCanvas.width;
    const H = mapCanvas.height;
    const img = mapCtx.createImageData(W, H);
    const counts: Record<Tier, number> = { CAP: 0, CLEAN: 0, WOBBLE: 0, MISS: 0 };
    let y = 0;
    const t0 = performance.now();
    const rowStep = () => {
      // one row per tick keeps the page responsive
      const acc = ACC_RANGE[1] - ((ACC_RANGE[1] - ACC_RANGE[0]) * y) / (H - 1);
      for (let x = 0; x < W; x++) {
        const rot = ROT_RANGE[0] + ((ROT_RANGE[1] - ROT_RANGE[0]) * x) / (W - 1);
        const tier = simulate(mapFlick({ rot, acc })).tier;
        counts[tier]++;
        const [r, g, b] = TIER_RGB[tier];
        const i = (y * W + x) * 4;
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = 255;
      }
      y++;
      mapImage = img;
      drawMap();
      if (y < H) requestAnimationFrame(rowStep);
      else {
        const n = W * H;
        const pct = (k: Tier) => ((counts[k] / n) * 100).toFixed(1) + '%';
        $('#d-mapstat').textContent =
          `area: clean ${pct('CLEAN')} wobble ${pct('WOBBLE')} cap ${pct('CAP')}\n` +
          `(${((performance.now() - t0) / 1000).toFixed(1)} s) — area, not player rate`;
      }
    };
    rowStep();
  }

  function markFlick(rot: number, acc: number) {
    const W = mapCanvas.width;
    const H = mapCanvas.height;
    const x = Math.round(((rot - ROT_RANGE[0]) / (ROT_RANGE[1] - ROT_RANGE[0])) * (W - 1));
    const y = Math.round(((ACC_RANGE[1] - acc) / (ACC_RANGE[1] - ACC_RANGE[0])) * (H - 1));
    marker = [Math.max(0, Math.min(W - 1, x)), Math.max(0, Math.min(H - 1, y))];
    drawMap();
  }

  function refreshLog() {
    const log = readLog();
    const tail = log.slice(-10).reverse();
    $('#d-log').textContent =
      `${log.length} entries\n` +
      tail
        .map(
          (e) =>
            `${e.result.tier.padEnd(6)} rot ${Math.round(e.sample.rot ?? 0)
              .toString()
              .padStart(4)} β ${Math.round(e.sample.beta ?? 0)
              .toString()
              .padStart(4)} acc ${(e.sample.acc ?? 0).toFixed(1).padStart(5)} err ${(e.launch.spinError * 100).toFixed(0)}% ${e.source === 'debug' ? '(syn)' : ''}`,
        )
        .join('\n');
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      prompt('Copy:', text);
    }
  };

  root.addEventListener('click', (ev) => {
    const act = (ev.target as HTMLElement).dataset.act;
    switch (act) {
      case 'toggle':
        setCollapsed(!root.classList.contains('collapsed'));
        break;
      case 'fire':
        hooks.fire(+rotIn.value, +accIn.value);
        break;
      case 'ideal': {
        const m = mapFlick({ rot: +rotIn.value, acc: +accIn.value });
        rotIn.value = String(Math.round(-m.idealOmega / ((P.spinScale * Math.PI) / 180)));
        preview();
        break;
      }
      case 'map':
        computeMap();
        break;
      case 'reset':
        Object.assign(P, DEFAULTS);
        try {
          localStorage.removeItem(TUNING_KEY);
        } catch {
          /* ignore */
        }
        sliders.querySelectorAll('label').forEach((l) => (l as HTMLLabelElement & { sync?: () => void }).sync?.());
        preview();
        computeMap();
        break;
      case 'copytune':
        void copy(JSON.stringify(P, null, 2));
        break;
      case 'copylog':
        void copy(JSON.stringify(readLog(), null, 1));
        break;
      case 'clearlog':
        clearLog();
        refreshLog();
        break;
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      hooks.fire(+rotIn.value, +accIn.value);
    }
  });

  let mapped = false;
  function setCollapsed(c: boolean) {
    root.classList.toggle('collapsed', c);
    $('[data-act="toggle"]').textContent = c ? 'show' : 'hide';
    if (!c && !mapped) {
      mapped = true;
      setTimeout(computeMap, 100);
    }
  }

  preview();
  refreshLog();
  // narrow screens (phones) start collapsed so the game stays visible
  setCollapsed(window.innerWidth < 800);
  return { refreshLog, markFlick };
}
