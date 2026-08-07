import { fbm2D, ridged2D, valueNoise2D, warp2D, type FbmOptions } from "./noise";
import type { VoxelGrid } from "./grid";
import type { LandscapePalette } from "./palette";
import type { LandscapeSettings } from "./types";

export interface TerrainField {
  /** Number of solid voxels per column, 1 … sizeZ. */
  heights: Int32Array;
  /** Steepness of every column, 0 … 1. */
  slope: Float32Array;
  /** Humidity field driving grass and tree variation, 0 … 1. */
  moisture: Float32Array;
  /** Water surface in voxels; 0 when water is disabled. */
  waterZ: number;
  sizeX: number;
  sizeY: number;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function sampleAlgorithm(
  settings: LandscapeSettings,
  seed: number,
  options: FbmOptions,
  x: number,
  y: number,
): number {
  const { algorithm } = settings.terrain;
  const scale = Math.max(4, settings.terrain.scale);
  const [nx, ny] = warp2D(x / scale, y / scale, seed, settings.terrain.warp * 1.4);

  if (algorithm === "mountains") {
    const ridges = ridged2D(nx, ny, seed, options);
    return clamp01(ridges * 0.82 + fbm2D(nx * 0.5, ny * 0.5, seed + 91, options) * 0.18);
  }
  if (algorithm === "plains") {
    const base = fbm2D(nx * 0.65, ny * 0.65, seed, options);
    return clamp01(0.18 + base * 0.42);
  }
  if (algorithm === "islands") {
    const base = fbm2D(nx, ny, seed, options);
    const dx = (x / Math.max(1, settings.size.x - 1)) * 2 - 1;
    const dy = (y / Math.max(1, settings.size.y - 1)) * 2 - 1;
    const distance = Math.sqrt(dx * dx + dy * dy) / Math.SQRT2;
    const falloff = clamp01(1.12 - Math.pow(distance * 1.35, 2.1));
    return clamp01(base * falloff * 1.25);
  }
  if (algorithm === "canyon") {
    const ridges = ridged2D(nx * 0.8, ny * 0.8, seed, options);
    const floorNoise = fbm2D(nx * 1.6, ny * 1.6, seed + 311, options);
    return clamp01(0.35 + (1 - ridges) * 0.62 + floorNoise * 0.06);
  }
  if (algorithm === "dunes") {
    const drift = fbm2D(nx * 0.7, ny * 0.7, seed, options);
    const wave = 0.5 + 0.5 * Math.sin((nx * 2.6 + drift * 3.4) * Math.PI);
    return clamp01(wave * 0.72 + drift * 0.28);
  }
  return fbm2D(nx, ny, seed, options);
}

/** One 3×3 box pass — removes single voxel spikes without flattening the silhouette. */
function smooth(heights: Float32Array, sizeX: number, sizeY: number, weight: number): void {
  const source = heights.slice();
  for (let y = 0; y < sizeY; y += 1) {
    for (let x = 0; x < sizeX; x += 1) {
      let total = 0;
      let samples = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= sizeX || ny >= sizeY) continue;
          total += source[nx + ny * sizeX];
          samples += 1;
        }
      }
      const index = x + y * sizeX;
      heights[index] = source[index] * (1 - weight) + (total / samples) * weight;
    }
  }
}

/** Thermal erosion: material above the talus angle slides into the lowest neighbor. */
function erode(heights: Float32Array, sizeX: number, sizeY: number, passes: number): void {
  const talus = 0.022;
  for (let pass = 0; pass < passes; pass += 1) {
    for (let y = 0; y < sizeY; y += 1) {
      for (let x = 0; x < sizeX; x += 1) {
        const index = x + y * sizeX;
        let lowestIndex = index;
        let lowest = heights[index];
        if (x > 0 && heights[index - 1] < lowest) { lowest = heights[index - 1]; lowestIndex = index - 1; }
        if (x < sizeX - 1 && heights[index + 1] < lowest) { lowest = heights[index + 1]; lowestIndex = index + 1; }
        if (y > 0 && heights[index - sizeX] < lowest) { lowest = heights[index - sizeX]; lowestIndex = index - sizeX; }
        if (y < sizeY - 1 && heights[index + sizeX] < lowest) { lowest = heights[index + sizeX]; lowestIndex = index + sizeX; }
        const difference = heights[index] - lowest;
        if (difference <= talus) continue;
        const moved = (difference - talus) * 0.35;
        heights[index] -= moved;
        heights[lowestIndex] += moved;
      }
    }
  }
}

export function buildTerrainField(settings: LandscapeSettings, seed: number): TerrainField {
  const { x: sizeX, y: sizeY, z: sizeZ } = settings.size;
  // Octaves finer than a few voxels only add single voxel noise, so cap them at
  // the smallest wavelength the grid can actually resolve.
  const finestWavelength = 3;
  const resolvable = Math.max(1, Math.floor(
    Math.log(Math.max(1, settings.terrain.scale / finestWavelength)) / Math.log(settings.terrain.lacunarity),
  ) + 1);
  const options: FbmOptions = {
    octaves: Math.min(Math.max(1, Math.round(settings.terrain.octaves)), resolvable),
    persistence: settings.terrain.persistence,
    lacunarity: settings.terrain.lacunarity,
  };

  const raw = new Float32Array(sizeX * sizeY);
  let lowest = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;
  for (let y = 0; y < sizeY; y += 1) {
    for (let x = 0; x < sizeX; x += 1) {
      const value = sampleAlgorithm(settings, seed, options, x, y);
      raw[x + y * sizeX] = value;
      if (value < lowest) lowest = value;
      if (value > highest) highest = value;
    }
  }

  // Value noise clusters around its mean, so stretch the field across the full
  // range first. Only then do amplitude and water level mean what the UI promises.
  const span = highest - lowest;
  for (let index = 0; index < raw.length; index += 1) {
    raw[index] = span > 0.0001 ? (raw[index] - lowest) / span : 0.5;
  }
  smooth(raw, sizeX, sizeY, 0.6);

  for (let index = 0; index < raw.length; index += 1) {
    let value = clamp01(raw[index]);
    value = Math.pow(value, Math.max(0.1, settings.terrain.exponent));
    if (settings.terrain.terraces >= 2) {
      const steps = Math.round(settings.terrain.terraces);
      value = Math.floor(value * steps + 0.5) / steps;
    }
    raw[index] = clamp01(settings.terrain.baseHeight + value * settings.terrain.amplitude);
  }

  erode(raw, sizeX, sizeY, Math.max(0, Math.round(settings.terrain.erosion)));

  const heights = new Int32Array(sizeX * sizeY);
  for (let index = 0; index < raw.length; index += 1) {
    heights[index] = Math.min(sizeZ, Math.max(1, Math.round(clamp01(raw[index]) * sizeZ)));
  }

  const slope = new Float32Array(sizeX * sizeY);
  const moisture = new Float32Array(sizeX * sizeY);
  const moistureScale = Math.max(6, settings.terrain.scale * 0.75);
  for (let y = 0; y < sizeY; y += 1) {
    for (let x = 0; x < sizeX; x += 1) {
      const index = x + y * sizeX;
      const here = heights[index];
      let maximum = 0;
      if (x > 0) maximum = Math.max(maximum, Math.abs(here - heights[index - 1]));
      if (x < sizeX - 1) maximum = Math.max(maximum, Math.abs(here - heights[index + 1]));
      if (y > 0) maximum = Math.max(maximum, Math.abs(here - heights[index - sizeX]));
      if (y < sizeY - 1) maximum = Math.max(maximum, Math.abs(here - heights[index + sizeX]));
      slope[index] = clamp01(maximum / 5);
      moisture[index] = valueNoise2D(x / moistureScale, y / moistureScale, seed + 5171);
    }
  }

  return {
    heights,
    slope,
    moisture,
    waterZ: settings.water.enabled ? Math.round(clamp01(settings.water.level) * sizeZ) : 0,
    sizeX,
    sizeY,
  };
}

export interface TerrainCarveResult {
  terrainVoxels: number;
  waterVoxels: number;
}

export function carveTerrain(
  grid: VoxelGrid,
  field: TerrainField,
  settings: LandscapeSettings,
  palette: LandscapePalette,
): TerrainCarveResult {
  const material = palette.index;
  const { sizeX, sizeY, heights, slope, moisture, waterZ } = field;
  const sizeZ = settings.size.z;
  const crustDepth = Math.max(0, Math.round(settings.terrain.crustDepth));
  const snowZ = settings.season === "winter"
    ? Math.min(settings.snowLine, 0.34) * sizeZ
    : settings.snowLine * sizeZ;
  let terrainVoxels = 0;
  let waterVoxels = 0;

  for (let y = 0; y < sizeY; y += 1) {
    for (let x = 0; x < sizeX; x += 1) {
      const index = x + y * sizeX;
      const height = heights[index];
      const surfaceZ = height - 1;
      const steep = slope[index];
      const wet = moisture[index];

      let bottom = 0;
      if (crustDepth > 0) {
        let neighborMin = height;
        if (x > 0) neighborMin = Math.min(neighborMin, heights[index - 1]);
        if (x < sizeX - 1) neighborMin = Math.min(neighborMin, heights[index + 1]);
        if (y > 0) neighborMin = Math.min(neighborMin, heights[index - sizeX]);
        if (y < sizeY - 1) neighborMin = Math.min(neighborMin, heights[index + sizeX]);
        // Reach below the lowest neighbor so cliff walls stay closed even with a thin crust.
        bottom = Math.max(0, Math.min(height - crustDepth, neighborMin - 1));
      }

      let surfaceMaterial: number;
      if (waterZ > 0 && height <= waterZ) {
        surfaceMaterial = waterZ - height > 4 ? material.dirt : material.sand;
      } else if (waterZ > 0 && height - waterZ <= settings.water.beach) {
        surfaceMaterial = material.sand;
      } else if (steep > 0.55) {
        surfaceMaterial = wet > 0.55 ? material.stone : material.stoneDark;
      } else if (surfaceZ >= snowZ) {
        surfaceMaterial = material.snow;
      } else if (wet > 0.66) {
        surfaceMaterial = material.grassDark;
      } else if (wet < 0.36) {
        surfaceMaterial = material.grassLight;
      } else {
        surfaceMaterial = material.grass;
      }
      if (settings.terrain.algorithm === "dunes" && surfaceMaterial !== material.snow && waterZ < height) {
        surfaceMaterial = material.sand;
      }

      for (let z = bottom; z < height; z += 1) {
        const depth = surfaceZ - z;
        let cell: number;
        if (depth === 0) {
          cell = surfaceMaterial;
        } else if (depth <= 2 && surfaceMaterial === material.sand) {
          cell = material.sand;
        } else if (depth <= 2) {
          cell = material.dirt;
        } else if (depth <= 4) {
          cell = material.gravel;
        } else {
          cell = (x + y + z) % 7 === 0 ? material.stoneDark : material.stone;
        }
        grid.set(x, y, z, cell);
        terrainVoxels += 1;
      }

      if (waterZ > 0 && height < waterZ) {
        const limit = Math.min(sizeZ, waterZ);
        for (let z = height; z < limit; z += 1) {
          const deep = limit - z > 3 || waterZ - height > 5;
          grid.set(x, y, z, deep && z < limit - 1 ? material.deepWater : material.water);
          waterVoxels += 1;
        }
      }
    }
  }

  return { terrainVoxels, waterVoxels };
}
