// Messages between the big screen (host) and the phone (controller).
import type { FlickSample } from '../input/motion';
import type { Tier } from '../physics/bottleSim';

export type ToHost =
  | { t: 'hello' }
  | { t: 'flick'; s: FlickSample }
  | { t: 'reset' } // put the bottle back in hand
  | { t: 'test'; on: boolean } // practice mode: mirror the phone, never release
  | { t: 'tilt'; a: number }; // live phone swing (radians) while in test mode

export type ToPhone =
  | { t: 'state'; state: 'wait' | 'ready' | 'flight' }
  | { t: 'result'; tier: Tier; main: string; sub: string; stars: number; fill: number }; // fill: seconds of colour wash, 0 = none

export const PEER_PREFIX = 'dailybottleflip-';

// No 0/O/1/I/L so the code is easy to read off a screen.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newRoomCode(): string {
  let s = '';
  const r = crypto.getRandomValues(new Uint32Array(5));
  for (const n of r) s += ALPHABET[n % ALPHABET.length];
  return s;
}

/** URL the phone opens. In dev it points at this computer's LAN address. */
export function controllerUrl(code: string): string {
  const port = location.port ? `:${location.port}` : '';
  const origin = __LAN_HOST__ ? `https://${__LAN_HOST__}${port}` : location.origin;
  return `${origin}${location.pathname}?pair=${code}`;
}

declare global {
  const __LAN_HOST__: string;
}
