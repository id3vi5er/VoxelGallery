import type { VoxelGrid } from "./grid";
import type { MaterialIndex } from "./palette";
import type { Rng } from "./random";
import type { TerrainField } from "./terrain";
import type { LandscapeSettings } from "./types";

/** Boulders, grass tufts and flowers on top of the finished terrain. */
export function scatterDetails(
  grid: VoxelGrid,
  field: TerrainField,
  settings: LandscapeSettings,
  material: MaterialIndex,
  rng: Rng,
): number {
  const before = grid.voxelCount;
  const { sizeX, sizeY, heights, slope, waterZ } = field;
  const columns = sizeX * sizeY;

  const rockCount = Math.round((columns / 900) * settings.scatter.rocks * 12);
  for (let index = 0; index < rockCount; index += 1) {
    const x = rng.int(1, sizeX - 2);
    const y = rng.int(1, sizeY - 2);
    const column = x + y * sizeX;
    const height = heights[column];
    if (waterZ > 0 && height <= waterZ) continue;
    const radiusX = rng.range(1, 2.6);
    const radiusY = rng.range(1, 2.6);
    const radiusZ = rng.range(0.8, 2.1);
    const baseZ = height - 1;
    for (let dz = -1; dz <= Math.ceil(radiusZ); dz += 1) {
      for (let dy = -Math.ceil(radiusY); dy <= Math.ceil(radiusY); dy += 1) {
        for (let dx = -Math.ceil(radiusX); dx <= Math.ceil(radiusX); dx += 1) {
          const distance =
            (dx / radiusX) * (dx / radiusX) +
            (dy / radiusY) * (dy / radiusY) +
            (dz / radiusZ) * (dz / radiusZ);
          if (distance > 1) continue;
          grid.set(x + dx, y + dy, baseZ + dz, rng.chance(0.22) ? material.gravel : material.boulder);
        }
      }
    }
  }

  const plantCount = Math.round((columns / 100) * (settings.scatter.grass * 6 + settings.scatter.flowers * 3));
  for (let index = 0; index < plantCount; index += 1) {
    const x = rng.int(0, sizeX - 1);
    const y = rng.int(0, sizeY - 1);
    const column = x + y * sizeX;
    const height = heights[column];
    if (waterZ > 0 && height <= waterZ + settings.water.beach) continue;
    if (slope[column] > 0.5) continue;
    if (height >= settings.snowLine * settings.size.z) continue;
    const ground = grid.get(x, y, height - 1);
    if (ground !== material.grass && ground !== material.grassDark && ground !== material.grassLight) continue;
    const total = settings.scatter.grass * 6 + settings.scatter.flowers * 3;
    const flower = total > 0 && rng.next() < (settings.scatter.flowers * 3) / total;
    if (flower) {
      grid.setIfEmpty(x, y, height, material.tuft);
      grid.setIfEmpty(x, y, height + 1, rng.chance(0.5) ? material.flowerA : material.flowerB);
    } else {
      grid.setIfEmpty(x, y, height, material.tuft);
      if (rng.chance(0.3)) grid.setIfEmpty(x, y, height + 1, material.tuft);
    }
  }

  return grid.voxelCount - before;
}
