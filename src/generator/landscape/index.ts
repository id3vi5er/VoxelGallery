import { VoxelGrid } from "./grid";
import { buildLandscapePalette } from "./palette";
import { hashSeed, Rng } from "./random";
import { scatterDetails } from "./scatter";
import { clampLandscapeSettings, MAX_SAVE_VOXELS, toVoxelUnits } from "./settings";
import { buildTerrainField, carveTerrain, type TerrainField } from "./terrain";
import { growTree } from "./trees";
import type { LandscapeResult, LandscapeSettings, TreeAlgorithm } from "./types";

export * from "./types";
export {
  DEFAULT_LANDSCAPE_SETTINGS,
  LANDSCAPE_LIMITS,
  LANDSCAPE_PRESETS,
  MAX_AXIS,
  MAX_SAVE_VOXELS,
  MIN_AXIS,
  METERS_PER_VOXEL_STEPS,
  MIN_METERS_PER_VOXEL,
  MAX_METERS_PER_VOXEL,
  clampLandscapeSettings,
  scaleMetricLengths,
  toVoxelUnits,
} from "./settings";
export type { LandscapePreset, Limit } from "./settings";
export { randomSeedText } from "./random";
export { buildLandscapePalette } from "./palette";

const MAX_TREES = 6000;

function pickAlgorithm(
  settings: LandscapeSettings,
  rng: Rng,
  altitude: number,
  nearWater: boolean,
): Exclude<TreeAlgorithm, "mixed"> {
  if (settings.trees.algorithm !== "mixed") return settings.trees.algorithm;
  if (nearWater && altitude < 0.35 && rng.chance(0.55)) return "palm";
  if (altitude > 0.55 || settings.season === "winter") return rng.chance(0.75) ? "conifer" : "recursive";
  if (rng.chance(0.08)) return "dead";
  return rng.chance(0.5) ? "recursive" : "lsystem";
}

function plantTrees(
  grid: VoxelGrid,
  field: TerrainField,
  settings: LandscapeSettings,
  materialIndex: ReturnType<typeof buildLandscapePalette>["index"],
  rng: Rng,
): { trees: number; voxels: number; shortened: number; skipped: number } {
  if (!settings.trees.enabled || settings.trees.density <= 0) {
    return { trees: 0, voxels: 0, shortened: 0, skipped: 0 };
  }
  const before = grid.voxelCount;
  const { sizeX, sizeY, heights, slope, moisture, waterZ } = field;
  const sizeZ = settings.size.z;
  const spacing = Math.max(2, Math.round(17 - settings.trees.density * 14));
  const treeLineZ = settings.trees.treeLine * sizeZ;
  const groundMaterials = new Set([
    materialIndex.grass, materialIndex.grassDark, materialIndex.grassLight,
    materialIndex.dirt, materialIndex.sand, materialIndex.gravel,
  ]);
  let trees = 0;
  let shortened = 0;
  let skipped = 0;

  // Visit the placement grid in random order. Planting stops once the tree count or
  // the voxel budget runs out, and walking the grid row by row would spend the whole
  // budget on the first rows and leave the rest of the map bare on one side.
  const cells: number[] = [];
  for (let cellY = 2; cellY < sizeY - 2; cellY += spacing) {
    for (let cellX = 2; cellX < sizeX - 2; cellX += spacing) cells.push(cellX + cellY * sizeX);
  }
  for (let index = cells.length - 1; index > 0; index -= 1) {
    const swap = rng.int(0, index);
    [cells[index], cells[swap]] = [cells[swap], cells[index]];
  }

  planting: {
    for (const cell of cells) {
      if (trees >= MAX_TREES || grid.voxelCount > MAX_SAVE_VOXELS) break planting;
      const offset = settings.trees.jitter * spacing * 0.5;
      const x = Math.round((cell % sizeX) + rng.jitter() * offset);
      const y = Math.round(Math.floor(cell / sizeX) + rng.jitter() * offset);
      if (x < 2 || y < 2 || x >= sizeX - 2 || y >= sizeY - 2) continue;

      const column = x + y * sizeX;
      const height = heights[column];
      if (waterZ > 0 && height <= waterZ + settings.water.beach) continue;
      if (height >= treeLineZ) continue;
      if (slope[column] > settings.trees.slopeLimit) continue;
      if (!groundMaterials.has(grid.get(x, y, height - 1))) continue;
      // Humid spots grow denser forests than dry ones.
      if (rng.next() > 0.35 + moisture[column] * 0.65) continue;

      // A tall tree in metres needs many voxels at a fine scale. Rather than dropping
      // every location that cannot hold the full height — which used to leave whole
      // regions bare without saying so — grow a shorter tree and report the shortfall.
      const headroom = sizeZ - height - 2;
      if (headroom < 4) { skipped += 1; continue; }
      const wanted = rng.range(settings.trees.minHeight, settings.trees.maxHeight + 1);
      const treeHeight = Math.min(wanted, headroom);
      if (treeHeight < wanted * 0.9) shortened += 1;
      const altitude = height / sizeZ;
      const nearWater = waterZ > 0 && height - waterZ <= settings.water.beach + 3;
      const algorithm = pickAlgorithm(settings, rng, altitude, nearWater);
      growTree(grid, x, y, height - 1, settings.trees, rng, materialIndex, { algorithm, height: treeHeight });
      trees += 1;
    }
  }
  return { trees, voxels: grid.voxelCount - before, shortened, skipped };
}

export function generateLandscape(input: LandscapeSettings): LandscapeResult {
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  const metric = clampLandscapeSettings(input);
  // Every length the user sets is metric; the generator itself thinks in voxels.
  const settings = toVoxelUnits(metric);
  const seed = hashSeed(settings.seed || "voxel");
  const palette = buildLandscapePalette(settings.season);
  const grid = new VoxelGrid(settings.size.x, settings.size.y, settings.size.z);

  const field = buildTerrainField(settings, seed);
  const { terrainVoxels, waterVoxels } = carveTerrain(grid, field, settings, palette);
  const treeResult = plantTrees(grid, field, settings, palette.index, new Rng(seed ^ 0x5bf03635));
  const scatterVoxels = scatterDetails(grid, field, settings, palette.index, new Rng(seed ^ 0x2f8a1c77));

  const voxels = grid.toVoxels();
  const surfaceFaces = grid.countSurfaceFaces();
  const finished = typeof performance !== "undefined" ? performance.now() : Date.now();

  const perVoxel = metric.metersPerVoxel;
  const round = (value: number) => Math.round(value * 10) / 10;

  return {
    scene: {
      name: `landscape-${metric.terrain.algorithm}-${metric.seed || "seed"}`.toLowerCase(),
      description: `${metric.terrain.algorithm} · ${metric.size.x}×${metric.size.y}×${metric.size.z} voxel · ${round(metric.size.x * perVoxel)}×${round(metric.size.y * perVoxel)}×${round(metric.size.z * perVoxel)} m at ${perVoxel} m/voxel · seed "${metric.seed}"`,
      size: metric.size,
      palette: palette.colors,
      voxels,
    },
    stats: {
      extent: {
        x: round(metric.size.x * perVoxel),
        y: round(metric.size.y * perVoxel),
        z: round(metric.size.z * perVoxel),
      },
      metersPerVoxel: perVoxel,
      voxels: voxels.length,
      terrainVoxels,
      waterVoxels,
      treeVoxels: treeResult.voxels,
      scatterVoxels,
      trees: treeResult.trees,
      treesShortened: treeResult.shortened,
      treesSkipped: treeResult.skipped,
      surfaceFaces,
      fileBytes: voxels.length * 4 + 1100,
      durationMs: Math.round(finished - started),
    },
  };
}

/** Yields one frame before the heavy work so the UI can paint its spinner. */
export async function generateLandscapeAsync(settings: LandscapeSettings): Promise<LandscapeResult> {
  await new Promise((resolve) => setTimeout(resolve, 16));
  return generateLandscape(settings);
}
