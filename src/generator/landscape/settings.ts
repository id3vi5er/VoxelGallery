import type { LandscapeSettings } from "./types";

/** VOX stores coordinates as single bytes, so no axis may exceed 256. */
export const MAX_AXIS = 256;
export const MIN_AXIS = 16;
/** The Tauri save command rejects files above 10 MB (4 bytes per voxel plus header). */
export const MAX_SAVE_VOXELS = 2_400_000;
/** Selectable voxel scales from coarse world building to fine detail. */
export const METERS_PER_VOXEL_STEPS = [10, 5, 2.5, 2, 1, 0.5, 0.25, 0.2, 0.1] as const;
export const MIN_METERS_PER_VOXEL = 0.1;
export const MAX_METERS_PER_VOXEL = 10;

export const DEFAULT_LANDSCAPE_SETTINGS: LandscapeSettings = {
  seed: "waldtal",
  // A 256³ grid at 0.1 m covers 25.6 m of world, so every length below describes a
  // clearing at ten centimetre detail rather than a whole valley.
  size: { x: 256, y: 256, z: 256 },
  metersPerVoxel: 0.1,
  season: "summer",
  snowLine: 1,
  terrain: {
    algorithm: "hills",
    scale: 12,
    octaves: 5,
    persistence: 0.5,
    lacunarity: 2,
    amplitude: 0.22,
    baseHeight: 0.1,
    exponent: 1.1,
    warp: 0.35,
    terraces: 0,
    erosion: 2,
    crustDepth: 0.4,
  },
  water: { enabled: true, level: 0.13, beach: 0.4 },
  trees: {
    enabled: true,
    algorithm: "mixed",
    density: 0.95,
    minHeight: 7,
    maxHeight: 13,
    branchAngle: 32,
    iterations: 4,
    branchSplit: 3,
    lengthFalloff: 0.74,
    trunkThickness: 0.18,
    crownRadius: 2.6,
    leafDensity: 0.72,
    slopeLimit: 0.55,
    treeLine: 0.85,
    jitter: 0.6,
  },
  scatter: { rocks: 0.4, grass: 0.5, flowers: 0.3 },
};

export interface Limit {
  min: number;
  max: number;
  step: number;
}

// Lengths are metric and a voxel can be as small as 0.1 m, so the lower bounds have
// to reach well below a metre — otherwise a miniature scene cannot be expressed.
export const LANDSCAPE_LIMITS = {
  size: { min: MIN_AXIS, max: MAX_AXIS, step: 8 },
  scale: { min: 0.5, max: 120, step: 0.5 },
  octaves: { min: 1, max: 8, step: 1 },
  persistence: { min: 0.2, max: 0.85, step: 0.01 },
  lacunarity: { min: 1.4, max: 3.4, step: 0.05 },
  amplitude: { min: 0.05, max: 1, step: 0.01 },
  baseHeight: { min: 0, max: 0.6, step: 0.01 },
  exponent: { min: 0.4, max: 3, step: 0.05 },
  warp: { min: 0, max: 1.5, step: 0.05 },
  terraces: { min: 0, max: 16, step: 1 },
  erosion: { min: 0, max: 8, step: 1 },
  crustDepth: { min: 0, max: 32, step: 0.25 },
  waterLevel: { min: 0, max: 0.8, step: 0.01 },
  beach: { min: 0, max: 12, step: 0.25 },
  snowLine: { min: 0.3, max: 1, step: 0.01 },
  density: { min: 0, max: 1, step: 0.01 },
  treeHeight: { min: 0.3, max: 60, step: 0.1 },
  branchAngle: { min: 10, max: 70, step: 1 },
  iterations: { min: 1, max: 7, step: 1 },
  branchSplit: { min: 2, max: 5, step: 1 },
  lengthFalloff: { min: 0.45, max: 0.95, step: 0.01 },
  trunkThickness: { min: 0.02, max: 5, step: 0.02 },
  crownRadius: { min: 0.1, max: 20, step: 0.1 },
  leafDensity: { min: 0.05, max: 1, step: 0.01 },
  slopeLimit: { min: 0, max: 1, step: 0.01 },
  treeLine: { min: 0.1, max: 1, step: 0.01 },
  jitter: { min: 0, max: 1, step: 0.05 },
  scatter: { min: 0, max: 1, step: 0.05 },
} as const;

function clamp(value: number, limit: Limit): number {
  if (!Number.isFinite(value)) return limit.min;
  return Math.min(limit.max, Math.max(limit.min, value));
}

/** Keeps every value inside the range the generator and the VOX format can handle. */
export function clampLandscapeSettings(settings: LandscapeSettings): LandscapeSettings {
  const limits = LANDSCAPE_LIMITS;
  const minHeight = clamp(settings.trees.minHeight, limits.treeHeight);
  const maxHeight = Math.max(minHeight, clamp(settings.trees.maxHeight, limits.treeHeight));
  return {
    ...settings,
    seed: settings.seed.slice(0, 64),
    metersPerVoxel: Number.isFinite(settings.metersPerVoxel)
      ? Math.min(MAX_METERS_PER_VOXEL, Math.max(MIN_METERS_PER_VOXEL, settings.metersPerVoxel))
      : 1,
    size: {
      x: Math.round(clamp(settings.size.x, limits.size)),
      y: Math.round(clamp(settings.size.y, limits.size)),
      z: Math.round(clamp(settings.size.z, limits.size)),
    },
    snowLine: clamp(settings.snowLine, limits.snowLine),
    terrain: {
      ...settings.terrain,
      scale: clamp(settings.terrain.scale, limits.scale),
      octaves: Math.round(clamp(settings.terrain.octaves, limits.octaves)),
      persistence: clamp(settings.terrain.persistence, limits.persistence),
      lacunarity: clamp(settings.terrain.lacunarity, limits.lacunarity),
      amplitude: clamp(settings.terrain.amplitude, limits.amplitude),
      baseHeight: clamp(settings.terrain.baseHeight, limits.baseHeight),
      exponent: clamp(settings.terrain.exponent, limits.exponent),
      warp: clamp(settings.terrain.warp, limits.warp),
      terraces: Math.round(clamp(settings.terrain.terraces, limits.terraces)),
      erosion: Math.round(clamp(settings.terrain.erosion, limits.erosion)),
      crustDepth: clamp(settings.terrain.crustDepth, limits.crustDepth),
    },
    water: {
      ...settings.water,
      level: clamp(settings.water.level, limits.waterLevel),
      beach: clamp(settings.water.beach, limits.beach),
    },
    trees: {
      ...settings.trees,
      density: clamp(settings.trees.density, limits.density),
      minHeight,
      maxHeight,
      branchAngle: clamp(settings.trees.branchAngle, limits.branchAngle),
      iterations: Math.round(clamp(settings.trees.iterations, limits.iterations)),
      branchSplit: Math.round(clamp(settings.trees.branchSplit, limits.branchSplit)),
      lengthFalloff: clamp(settings.trees.lengthFalloff, limits.lengthFalloff),
      trunkThickness: clamp(settings.trees.trunkThickness, limits.trunkThickness),
      crownRadius: clamp(settings.trees.crownRadius, limits.crownRadius),
      leafDensity: clamp(settings.trees.leafDensity, limits.leafDensity),
      slopeLimit: clamp(settings.trees.slopeLimit, limits.slopeLimit),
      treeLine: clamp(settings.trees.treeLine, limits.treeLine),
      jitter: clamp(settings.trees.jitter, limits.jitter),
    },
    scatter: {
      rocks: clamp(settings.scatter.rocks, limits.scatter),
      grass: clamp(settings.scatter.grass, limits.scatter),
      flowers: clamp(settings.scatter.flowers, limits.scatter),
    },
  };
}

/**
 * Multiplies every metric length by `factor`.
 *
 * A finer voxel scale means the same grid covers less world, so real world sizes
 * quickly outgrow the map: at 0.1 m per voxel a 96 wide grid spans 9.6 m, while a
 * 26 m hill and an 8 m tree do not remotely fit into it. Scaling the lengths along
 * with the voxel size keeps the composition identical and only reinterprets how much
 * world a voxel stands for.
 */
export function scaleMetricLengths(settings: LandscapeSettings, factor: number): LandscapeSettings {
  if (!Number.isFinite(factor) || factor === 1) return settings;
  return clampLandscapeSettings({
    ...settings,
    terrain: {
      ...settings.terrain,
      scale: settings.terrain.scale * factor,
      crustDepth: settings.terrain.crustDepth * factor,
    },
    water: { ...settings.water, beach: settings.water.beach * factor },
    trees: {
      ...settings.trees,
      minHeight: settings.trees.minHeight * factor,
      maxHeight: settings.trees.maxHeight * factor,
      trunkThickness: settings.trees.trunkThickness * factor,
      crownRadius: settings.trees.crownRadius * factor,
    },
  });
}

/**
 * Every length in `LandscapeSettings` is metric so the same landscape can be built
 * at any resolution. This converts those metres into the voxel units the generator
 * works in — call it after clamping, never before.
 */
export function toVoxelUnits(settings: LandscapeSettings): LandscapeSettings {
  const perVoxel = settings.metersPerVoxel;
  // No shortcut for a one metre voxel: the guards below (a crust of at least one
  // voxel, a capped beach band) have to run at every scale, otherwise a sub-metre
  // crust rounds to zero and silently turns the terrain into a solid block.
  const convert = (meters: number) => meters / perVoxel;
  return {
    ...settings,
    terrain: {
      ...settings.terrain,
      scale: convert(settings.terrain.scale),
      // A crust of "some metres" must stay at least one voxel thick, otherwise a
      // coarse scale would silently switch the terrain to an expensive solid fill.
      crustDepth: settings.terrain.crustDepth > 0 ? Math.max(1, Math.round(convert(settings.terrain.crustDepth))) : 0,
    },
    water: {
      ...settings.water,
      // The beach is an elevation band above the water line. Converted to voxels it
      // can otherwise swallow the whole terrain at fine scales and leave no ground
      // that trees or scatter are allowed to use.
      beach: Math.min(Math.round(convert(settings.water.beach)), Math.round(settings.size.z * 0.12)),
    },
    trees: {
      ...settings.trees,
      minHeight: convert(settings.trees.minHeight),
      maxHeight: convert(settings.trees.maxHeight),
      trunkThickness: convert(settings.trees.trunkThickness),
      crownRadius: convert(settings.trees.crownRadius),
    },
  };
}

export interface LandscapePreset {
  id: string;
  /** i18n key for the button label. */
  labelKey: string;
  settings: LandscapeSettings;
}

function preset(base: Partial<LandscapeSettings> & { seed: string }): LandscapeSettings {
  const defaults = DEFAULT_LANDSCAPE_SETTINGS;
  return clampLandscapeSettings({
    ...defaults,
    ...base,
    size: { ...defaults.size, ...base.size },
    terrain: { ...defaults.terrain, ...base.terrain },
    water: { ...defaults.water, ...base.water },
    trees: { ...defaults.trees, ...base.trees },
    scatter: { ...defaults.scatter, ...base.scatter },
  });
}

export const LANDSCAPE_PRESETS: LandscapePreset[] = [
  {
    id: "forest",
    labelKey: "presetForest",
    settings: preset({ seed: "waldtal" }),
  },
  {
    id: "alpine",
    labelKey: "presetAlpine",
    settings: preset({
      seed: "hochalpen",
      snowLine: 0.52,
      terrain: { algorithm: "mountains", scale: 9, octaves: 6, persistence: 0.52, lacunarity: 2.1, amplitude: 0.34, baseHeight: 0.06, exponent: 1.25, warp: 0.5, terraces: 0, erosion: 3, crustDepth: 0.5 },
      water: { enabled: true, level: 0.08, beach: 0.2 },
      trees: { ...DEFAULT_LANDSCAPE_SETTINGS.trees, algorithm: "conifer", density: 0.8, minHeight: 6, maxHeight: 11, crownRadius: 2.2, trunkThickness: 0.2, treeLine: 0.62, slopeLimit: 0.72 },
      scatter: { rocks: 0.7, grass: 0.3, flowers: 0.1 },
    }),
  },
  {
    id: "island",
    labelKey: "presetIsland",
    settings: preset({
      seed: "lagune",
      snowLine: 1,
      terrain: { ...DEFAULT_LANDSCAPE_SETTINGS.terrain, algorithm: "islands", scale: 14, amplitude: 0.28, baseHeight: 0.02, exponent: 1.2, erosion: 2 },
      water: { enabled: true, level: 0.14, beach: 0.6 },
      trees: { ...DEFAULT_LANDSCAPE_SETTINGS.trees, algorithm: "palm", density: 0.9, minHeight: 7, maxHeight: 12, crownRadius: 2.4, trunkThickness: 0.22, treeLine: 0.8 },
      scatter: { rocks: 0.3, grass: 0.4, flowers: 0.2 },
    }),
  },
  {
    id: "desert",
    labelKey: "presetDesert",
    settings: preset({
      seed: "duenen",
      snowLine: 1,
      terrain: { ...DEFAULT_LANDSCAPE_SETTINGS.terrain, algorithm: "dunes", scale: 15, octaves: 4, amplitude: 0.25, baseHeight: 0.08, exponent: 1, warp: 0.6, erosion: 1, crustDepth: 0.4 },
      water: { enabled: false, level: 0.08, beach: 0.3 },
      trees: { ...DEFAULT_LANDSCAPE_SETTINGS.trees, algorithm: "palm", density: 0.9, minHeight: 6, maxHeight: 10, crownRadius: 2, trunkThickness: 0.18 },
      scatter: { rocks: 0.5, grass: 0.05, flowers: 0 },
    }),
  },
  {
    id: "canyon",
    labelKey: "presetCanyon",
    settings: preset({
      seed: "schlucht",
      snowLine: 1,
      terrain: { ...DEFAULT_LANDSCAPE_SETTINGS.terrain, algorithm: "canyon", scale: 10, octaves: 5, amplitude: 0.34, baseHeight: 0.05, exponent: 1.1, warp: 0.3, terraces: 9, erosion: 0, crustDepth: 0.5 },
      water: { enabled: true, level: 0.07, beach: 0.3 },
      trees: { ...DEFAULT_LANDSCAPE_SETTINGS.trees, algorithm: "dead", density: 0.72, minHeight: 4, maxHeight: 8, crownRadius: 1.8, trunkThickness: 0.15, slopeLimit: 0.35 },
      scatter: { rocks: 0.8, grass: 0.15, flowers: 0.05 },
    }),
  },
  {
    id: "autumn",
    labelKey: "presetAutumn",
    settings: preset({
      seed: "herbstwald",
      season: "autumn",
      snowLine: 1,
      terrain: { ...DEFAULT_LANDSCAPE_SETTINGS.terrain, algorithm: "hills", scale: 10, amplitude: 0.2, erosion: 3 },
      water: { enabled: true, level: 0.12, beach: 0.4 },
      trees: { ...DEFAULT_LANDSCAPE_SETTINGS.trees, algorithm: "lsystem", density: 0.95, minHeight: 8, maxHeight: 14, branchAngle: 28, iterations: 3, crownRadius: 3, trunkThickness: 0.2, leafDensity: 0.5 },
      scatter: { rocks: 0.3, grass: 0.6, flowers: 0.35 },
    }),
  },
  {
    id: "taiga",
    labelKey: "presetTaiga",
    settings: preset({
      seed: "taiga",
      season: "winter",
      snowLine: 0.3,
      terrain: { ...DEFAULT_LANDSCAPE_SETTINGS.terrain, algorithm: "hills", scale: 13, amplitude: 0.24, erosion: 2, crustDepth: 0.4 },
      water: { enabled: true, level: 0.12, beach: 0.2 },
      trees: { ...DEFAULT_LANDSCAPE_SETTINGS.trees, algorithm: "conifer", density: 0.9, minHeight: 7, maxHeight: 14, crownRadius: 2, trunkThickness: 0.2, treeLine: 0.9 },
      scatter: { rocks: 0.35, grass: 0.2, flowers: 0.05 },
    }),
  },
];
