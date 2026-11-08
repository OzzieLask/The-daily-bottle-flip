// Local play stats + a raw flick log for tuning. Stored on the device only.
import type { FlickSample } from '../input/motion';
import type { MappedFlick } from '../input/flickMap';
import type { SimResult, Tier } from '../physics/bottleSim';

export interface Stats {
  flips: number;
  tiers: Record<Tier, number>;
}

export interface FlickLogEntry {
  at: string;
  source: 'sensor' | 'debug' | 'remote';
  sample: Partial<FlickSample>;
  launch: MappedFlick;
  result: SimResult;
  ua: string;
}

const STATS_KEY = 'dbf.stats.v1';
const LOG_KEY = 'dbf.flicklog.v1';
const LOG_MAX = 300;

const empty = (): Stats => ({ flips: 0, tiers: { CAP: 0, CLEAN: 0, WOBBLE: 0, MISS: 0 } });

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable: play on without saving */
  }
}

export const lifetime: Stats = read(STATS_KEY, empty());
export const session: Stats = empty();

export function record(tier: Tier): void {
  for (const s of [lifetime, session]) {
    s.flips++;
    s.tiers[tier]++;
  }
  write(STATS_KEY, lifetime);
}

export function landRate(s: Stats): number {
  return s.flips ? (s.tiers.CAP + s.tiers.CLEAN + s.tiers.WOBBLE) / s.flips : 0;
}

export function readLog(): FlickLogEntry[] {
  return read<FlickLogEntry[]>(LOG_KEY, []);
}

export function appendLog(e: FlickLogEntry): void {
  const log = readLog();
  log.push(e);
  write(LOG_KEY, log.slice(-LOG_MAX));
}

export function clearLog(): void {
  write(LOG_KEY, []);
}
