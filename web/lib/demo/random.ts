// Small deterministic PRNG so demo data is stable for a given seed.
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const range = (r: Rng, min: number, max: number) => min + r() * (max - min);
export const int = (r: Rng, min: number, max: number) => Math.floor(range(r, min, max + 1));
export const pick = <T,>(r: Rng, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];
export const chance = (r: Rng, p: number) => r() < p;

/** Approximately normal, mean 0, sd 1. */
export function gauss(r: Rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = r();
  while (v === 0) v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const HEX = "0123456789abcdef";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function hash(r: Rng, len = 64) {
  let s = "0x";
  for (let i = 0; i < len; i++) s += HEX[Math.floor(r() * 16)];
  return s;
}

export function b58(r: Rng, len = 44) {
  let s = "";
  for (let i = 0; i < len; i++) s += B58[Math.floor(r() * B58.length)];
  return s;
}

export function walk(r: Rng, n: number, start: number, vol: number, drift = 0) {
  const out = [start];
  for (let i = 1; i < n; i++) out.push(Math.max(start * 0.05, out[i - 1] * (1 + drift + gauss(r) * vol)));
  return out;
}

let counter = 0;
export function uid(prefix: string) {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}
