// Shared phone UI in the sketchbook style: the animated flick guide and the
// speed / power meters. Used by solo play and the controller.
import { targetRate } from '../input/flickMap';

export const FLICK_HINT = 'Phone flat on your palm. Tip the front edge up in one quick flick, the bottle lets go on its own.';

/** Ink-line diagram of the flat flick, with a looping motion guide. */
export function flickGuide(): string {
  return `
<svg class="guide" viewBox="0 0 160 140" aria-label="Flat flick upward">
  <path class="trail" d="M80 86 L80 30" />
  <path class="arrow" d="M70 40 L80 28 L90 40" />
  <g class="g-flat">
    <path class="phone" d="M44 88 L104 80 L120 92 L60 100 Z" />
  </g>
  <path class="hand" d="M30 112 C 60 104, 100 100, 132 104" />
  <path class="hand" d="M30 112 C 50 122, 100 122, 132 104" />
</svg>`;
}

const SPEED_MAX = 1200; // deg/s of phone pitch
const POWER_MAX = 60; // m/s^2
const ZONE = 0.08; // +-8% around the target speed

/**
 * Speed (wrist rotation) and power (acceleration) bars with a live fill,
 * the last flick's peak, and a hatched target zone for speed.
 */
export class Meters {
  private speedFill: HTMLElement;
  private powerFill: HTMLElement;
  private speedPeak: HTMLElement;
  private powerPeak: HTMLElement;
  private zone: HTMLElement;
  private speedVal: HTMLElement;
  private powerVal: HTMLElement;
  // vertical bars fill bottom-to-top; horizontal ones left-to-right
  private pos: 'left' | 'bottom';
  private size: 'width' | 'height';

  constructor(el: HTMLElement, vertical = true) {
    el.classList.add('meters', vertical ? 'vertical' : 'horizontal');
    this.pos = vertical ? 'bottom' : 'left';
    this.size = vertical ? 'height' : 'width';
    const meter = (label: string, zone: boolean) => `
      <div class="meter">
        <span class="m-val">–</span>
        <div class="m-track">${zone ? '<div class="m-zone"></div>' : ''}<div class="m-fill"></div><div class="m-peak"></div></div>
        <span class="m-label">${label}</span>
      </div>`;
    el.innerHTML = meter('Speed', true) + meter('Power', false);
    const [s, p] = el.querySelectorAll<HTMLElement>('.meter');
    this.speedFill = s.querySelector('.m-fill')!;
    this.speedPeak = s.querySelector('.m-peak')!;
    this.zone = s.querySelector('.m-zone')!;
    this.speedVal = s.querySelector('.m-val')!;
    this.powerFill = p.querySelector('.m-fill')!;
    this.powerPeak = p.querySelector('.m-peak')!;
    this.powerVal = p.querySelector('.m-val')!;
    this.speedPeak.hidden = this.powerPeak.hidden = true;
    this.setTarget(30);
  }

  /** Live sensor readout. */
  live(rot: number, acc: number): void {
    this.speedFill.style[this.size] = `${pct(rot, SPEED_MAX)}%`;
    this.powerFill.style[this.size] = `${pct(acc, POWER_MAX)}%`;
  }

  /** Mark the last flick's peaks and move the speed target to match its power. */
  flick(rot: number, acc: number): void {
    this.speedPeak.hidden = this.powerPeak.hidden = false;
    this.speedPeak.style[this.pos] = `${pct(rot, SPEED_MAX)}%`;
    this.powerPeak.style[this.pos] = `${pct(acc, POWER_MAX)}%`;
    this.speedVal.textContent = `${Math.round(rot)}°/s`;
    this.powerVal.textContent = `${acc.toFixed(0)} m/s²`;
    this.setTarget(acc);
  }

  setTarget(acc: number): void {
    const t = targetRate(acc);
    this.zone.style[this.pos] = `${pct(t * (1 - ZONE), SPEED_MAX)}%`;
    this.zone.style[this.size] = `${pct(t * 2 * ZONE, SPEED_MAX)}%`;
  }
}

const pct = (v: number, max: number) => Math.max(0, Math.min(100, (v / max) * 100));

// Five-point star outline, centred in a 24x24 box.
const STAR = (() => {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 4.6 : 11;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(12 + r * Math.cos(a)).toFixed(2)},${(12.6 + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
})();

/** `n` gold stars with ink outlines; they pop in one after another. */
export function starRow(n: number): string {
  let html = `<div class="stars" aria-label="${n} of 5 stars">`;
  for (let i = 0; i < n; i++) {
    html += `<svg viewBox="0 0 24 24" style="animation-delay:${0.15 + i * 0.12}s"><polygon points="${STAR}"/></svg>`;
  }
  return html + '</div>';
}
