export function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) {
    return 1;
  }
  return Math.trunc(seed) >>> 0 || 1;
}

export function hash32(value: number, seed: number): number {
  const normalizedValue = Number.isFinite(value) ? Math.trunc(value) >>> 0 : 0;
  let hashed = (normalizedValue ^ normalizeSeed(seed) ^ 0x9e3779b9) >>> 0;
  hashed = Math.imul(hashed ^ (hashed >>> 16), 0x21f0aaad) >>> 0;
  hashed = Math.imul(hashed ^ (hashed >>> 15), 0x735a2d97) >>> 0;
  return (hashed ^ (hashed >>> 15)) >>> 0;
}

export function mulberry32(seed: number): () => number {
  let state = normalizeSeed(seed);
  return function random(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}

export function randomSeed(): number {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return values[0] || 1;
  }
  return (Math.floor(Math.random() * 0xffffffff) + 1) >>> 0;
}
