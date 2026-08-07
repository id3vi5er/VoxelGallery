/** Seeded value noise with fBm layering — the base of every terrain algorithm. */

export interface FbmOptions {
  octaves: number;
  persistence: number;
  lacunarity: number;
}

function hash2(x: number, y: number, seed: number): number {
  let value = seed ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  value = Math.imul(value ^ (value >>> 13), 0x4bf5cd8d);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function valueNoise2D(x: number, y: number, seed: number): number {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const fx = fade(x - cellX);
  const fy = fade(y - cellY);
  const c00 = hash2(cellX, cellY, seed);
  const c10 = hash2(cellX + 1, cellY, seed);
  const c01 = hash2(cellX, cellY + 1, seed);
  const c11 = hash2(cellX + 1, cellY + 1, seed);
  const top = c00 + (c10 - c00) * fx;
  const bottom = c01 + (c11 - c01) * fx;
  return top + (bottom - top) * fy;
}

/** Fractal Brownian motion in the range 0…1. */
export function fbm2D(x: number, y: number, seed: number, options: FbmOptions): number {
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  let normalization = 0;
  for (let octave = 0; octave < options.octaves; octave += 1) {
    total += valueNoise2D(x * frequency, y * frequency, seed + octave * 7919) * amplitude;
    normalization += amplitude;
    amplitude *= options.persistence;
    frequency *= options.lacunarity;
  }
  return normalization > 0 ? total / normalization : 0;
}

/** Ridged multifractal — sharp crests for mountain ranges and canyons. */
export function ridged2D(x: number, y: number, seed: number, options: FbmOptions): number {
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  let normalization = 0;
  for (let octave = 0; octave < options.octaves; octave += 1) {
    const signal = 1 - Math.abs(valueNoise2D(x * frequency, y * frequency, seed + octave * 6151) * 2 - 1);
    total += signal * signal * amplitude;
    normalization += amplitude;
    amplitude *= options.persistence;
    frequency *= options.lacunarity;
  }
  return normalization > 0 ? total / normalization : 0;
}

/** Offsets the sample position with a second noise field to break up straight features. */
export function warp2D(x: number, y: number, seed: number, strength: number): [number, number] {
  if (strength <= 0) return [x, y];
  const offsetX = valueNoise2D(x * 0.9 + 13.7, y * 0.9 - 4.1, seed + 1013) * 2 - 1;
  const offsetY = valueNoise2D(x * 0.9 - 7.3, y * 0.9 + 9.5, seed + 2027) * 2 - 1;
  return [x + offsetX * strength, y + offsetY * strength];
}
