// Big Screen Mode, phone side: no 3D scene, just a sketchbook controller.
// Reads the flick with the same detector as solo play and sends the raw peaks
// to the big screen, which runs the physics.
import Peer, { type DataConnection } from 'peerjs';
import { initAudio, sfx } from '../audio/sfx';
import { FlickDetector, requestMotionPermission } from '../input/motion';
import { FLICK_HINT, flickGuide, Meters, starRow } from '../ui/sketchui';
import { PEER_PREFIX, type ToHost, type ToPhone } from './protocol';

export function runController(code: string): void {
  document.body.innerHTML = `
    <div id="ctl-fill"></div>
    <div id="ctl">
      <header><span>Room ${code}</span><span id="ctl-conn">not connected</span></header>
      <div id="ctl-mid">
        <div id="ctl-meters"></div>
        <div id="ctl-guide"></div>
        <div id="ctl-main">Ready?</div>
        <div id="ctl-stars"></div>
        <p id="ctl-sub">Connect, then flick to throw the bottle on the big screen.</p>
      </div>
      <div class="actions">
        <button id="ctl-test" class="toggle hidden">Test mode</button>
        <button id="ctl-reset" class="hidden">Reset</button>
        <button id="ctl-btn">Connect</button>
      </div>
    </div>`;

  const $ = (id: string) => document.getElementById(id)!;
  const main = $('ctl-main');
  const sub = $('ctl-sub');
  const conn$ = $('ctl-conn');
  const btn = $('ctl-btn') as HTMLButtonElement;
  const btnTest = $('ctl-test') as HTMLButtonElement;
  const btnReset = $('ctl-reset') as HTMLButtonElement;
  const guide = $('ctl-guide');
  const show = (el: HTMLElement, on: boolean) => el.classList.toggle('hidden', !on);
  const stars = $('ctl-stars');
  const fillEl = $('ctl-fill');
  // the colour wash: a flat disc with an ink rim, growing from the middle
  const washFill = (seconds: number, color: string) => {
    const size = 2 * Math.hypot(window.innerWidth, window.innerHeight);
    fillEl.style.transition = 'none';
    fillEl.style.width = fillEl.style.height = '0px';
    fillEl.style.background = color;
    void fillEl.offsetWidth;
    fillEl.style.transition = `width ${seconds}s cubic-bezier(.2,.7,.3,1), height ${seconds}s cubic-bezier(.2,.7,.3,1)`;
    fillEl.style.width = fillEl.style.height = `${size}px`;
  };
  const clearFill = () => {
    fillEl.style.transition = 'width .4s ease-in, height .4s ease-in';
    fillEl.style.width = fillEl.style.height = '0px';
  };
  const say = (m: string, s = '', n = 0) => {
    main.textContent = m;
    sub.textContent = s;
    stars.innerHTML = n ? starRow(n) : '';
  };

  const detector = new FlickDetector();
  guide.innerHTML = flickGuide();
  const meters = new Meters($('ctl-meters'));

  let conn: DataConnection | null = null;
  let peer: Peer | null = null;
  let retry = 0;
  let testMode = false;

  const send = (m: ToHost) => {
    if (conn?.open) conn.send(m);
  };

  detector.onFlick = (s) => {
    meters.flick(s.rot, s.acc);
    navigator.vibrate?.(30);
    if (testMode) {
      // practice only: nothing is thrown, re-arm for the next one
      say('Practice', `${Math.round(s.rot)}°/s · ${s.acc.toFixed(0)} m/s²`);
      setTimeout(() => detector.arm(false), 300);
      return;
    }
    send({ t: 'flick', s });
    say('Flip', 'Watch the big screen');
  };

  function setTest(on: boolean) {
    testMode = on;
    btnTest.classList.toggle('on', on);
    document.body.classList.toggle('test', on);
    send({ t: 'test', on });
    if (on) {
      say('Test mode', 'Swing it like a bottle held by the cap. Nothing is thrown.');
      detector.arm();
    } else say('Get ready', '');
  }

  btnTest.addEventListener('click', () => setTest(!testMode));
  btnReset.addEventListener('click', () => {
    send({ t: 'reset' });
    navigator.vibrate?.(15);
  });

  function handle(m: ToPhone) {
    if (testMode) return; // the big screen keeps the bottle in hand
    if (m.t === 'state') {
      if (m.state === 'ready') {
        clearFill();
        say('Flick', FLICK_HINT);
        detector.arm();
      } else if (m.state === 'flight') {
        detector.disarm();
        say('Flip', 'Watch the big screen');
      } else {
        detector.disarm();
        say('Get ready', '');
      }
    } else {
      say(m.main, m.sub || 'Back in your hand in a moment', m.stars);
      if (m.fill > 0) washFill(m.fill, m.tier === 'CAP' ? '#ff6a4d' : '#ffd23f');
      if (m.tier === 'CAP') sfx.cap();
      else if (m.tier === 'CLEAN') sfx.nice();
      else if (m.tier === 'WOBBLE') sfx.wobble();
      else sfx.oof();
      if (m.tier !== 'MISS') navigator.vibrate?.(m.tier === 'CAP' ? [40, 60, 40, 60, 120] : 80);
      // the big screen puts the bottle back in hand and sends 'ready'
    }
  }

  function connect() {
    conn$.textContent = 'connecting…';
    peer?.destroy();
    peer = new Peer();
    peer.on('open', () => {
      const c = peer!.connect(PEER_PREFIX + code, { reliable: true });
      conn = c;
      c.on('open', () => {
        retry = 0;
        conn$.textContent = 'connected';
        show(btnTest, true);
        show(btnReset, true);
        send({ t: 'hello' });
        if (testMode) send({ t: 'test', on: true });
        else say('Connected', 'Watch the big screen');
      });
      c.on('data', (raw) => handle(raw as ToPhone));
      c.on('close', lost);
    });
    peer.on('error', (err) => {
      if ((err as { type?: string }).type === 'peer-unavailable') {
        conn$.textContent = 'not connected';
        say('Room closed', 'Scan the code on the big screen again.');
        btn.textContent = 'Try again';
        show(btn, true);
      } else lost();
    });
  }

  function lost() {
    detector.disarm();
    show(btnTest, false);
    show(btnReset, false);
    conn$.textContent = 'reconnecting…';
    if (retry++ < 5) setTimeout(connect, 1000 * retry);
    else {
      conn$.textContent = 'not connected';
      say('Connection lost', 'Check both devices are online.');
      btn.textContent = 'Try again';
      show(btn, true);
    }
  }

  // live meters every frame; stream the phone's pitch ~30x/s
  let lastTilt = 0;
  function tick(now: number) {
    meters.live(detector.live, detector.liveAcc);
    // the big screen's bottle follows your hand until it's released
    if (conn?.open && now - lastTilt > 33) {
      lastTilt = now;
      send({ t: 'tilt', a: detector.tilt });
    }
    requestAnimationFrame(tick);
  }

  btn.addEventListener('click', async () => {
    initAudio();
    sfx.select();
    const perm = await requestMotionPermission();
    if (perm !== 'granted') {
      say('Motion access needed', 'Your wrist is the controller. Reload and choose Allow.');
      return;
    }
    detector.start();
    requestAnimationFrame(tick);
    show(btn, false);
    retry = 0;
    connect();
  });
}
