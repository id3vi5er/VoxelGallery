import type { GeneratedVoxelScene } from "../types";

export type TerrainAlgorithm = "hills" | "mountains" | "plains" | "islands" | "canyon" | "dunes";
export type TreeAlgorithm = "recursive" | "lsystem" | "conifer" | "palm" | "dead" | "mixed";
export type Season = "spring" | "summer" | "autumn" | "winter";

export interface TerrainSettings {
  algorithm: TerrainAlgorithm;
  /** Feature size in metres — larger values produce wider hills. */
  scale: number;
  octaves: number;
  persistence: number;
  lacunarity: number;
  /** Share of the model height the terrain may use (0…1). */
  amplitude: number;
  /** Guaranteed ground floor as a share of the model height (0…1). */
  baseHeight: number;
  /** Height redistribution: < 1 flattens valleys, > 1 sharpens peaks. */
  exponent: number;
  /** Domain warp strength — breaks up regular ridges. */
  warp: number;
  /** 0 disables terracing, otherwise the number of plateau steps. */
  terraces: number;
  /** Thermal erosion passes. */
  erosion: number;
  /** Solid metres below the surface; 0 fills the whole column. */
  crustDepth: number;
}

export interface WaterSettings {
  enabled: boolean;
  /** Water surface as a share of the model height (0…1). */
  level: number;
  /** Beach width in metres above the water line. */
  beach: number;
}

export interface TreeSettings {
  enabled: boolean;
  algorithm: TreeAlgorithm;
  /** Trees per 100 suitable ground voxels. */
  density: number;
  /** Tree height range in metres. */
  minHeight: number;
  maxHeight: number;
  /** Branch spread in degrees. */
  branchAngle: number;
  /** Recursion depth / L-system generations. */
  iterations: number;
  branchSplit: number;
  lengthFalloff: number;
  /** Trunk radius in metres. */
  trunkThickness: number;
  /** Crown radius in metres. */
  crownRadius: number;
  leafDensity: number;
  /** Maximum ground steepness that still gets trees (0…1). */
  slopeLimit: number;
  /** Height above which nothing grows any more (0…1 of the model height). */
  treeLine: number;
  /** Positional randomness of the placement grid (0…1). */
  jitter: number;
}

export interface ScatterSettings {
  rocks: number;
  grass: number;
  flowers: number;
}

export interface LandscapeSettings {
  seed: string;
  /** Model extent in voxels. */
  size: { x: number; y: number; z: number };
  /** Real world size of a single voxel, 0.1 … 10 m. Every length setting is metric. */
  metersPerVoxel: number;
  season: Season;
  snowLine: number;
  terrain: TerrainSettings;
  water: WaterSettings;
  trees: TreeSettings;
  scatter: ScatterSettings;
}

export interface LandscapeStats {
  voxels: number;
  terrainVoxels: number;
  waterVoxels: number;
  treeVoxels: number;
  scatterVoxels: number;
  trees: number;
  /** Trees that had to grow shorter than requested because the model ran out of height. */
  treesShortened: number;
  /** Locations with too little headroom for any tree at all. */
  treesSkipped: number;
  surfaceFaces: number;
  fileBytes: number;
  durationMs: number;
  /** Covered real world area in metres. */
  extent: { x: number; y: number; z: number };
  metersPerVoxel: number;
}

export interface LandscapeResult {
  scene: GeneratedVoxelScene;
  stats: LandscapeStats;
}
