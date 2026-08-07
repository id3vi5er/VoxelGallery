import type { GeneratedVoxel } from "../types";

/**
 * Dense occupancy grid. Cells store `material + 1` so that 0 always means "empty",
 * which keeps the whole landscape in a single Uint8Array instead of millions of objects.
 */
export class VoxelGrid {
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  readonly cells: Uint8Array;
  private readonly strideZ: number;
  private filled = 0;

  constructor(sizeX: number, sizeY: number, sizeZ: number) {
    this.sizeX = sizeX;
    this.sizeY = sizeY;
    this.sizeZ = sizeZ;
    this.strideZ = sizeX * sizeY;
    this.cells = new Uint8Array(sizeX * sizeY * sizeZ);
  }

  inside(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sizeX && y < this.sizeY && z < this.sizeZ;
  }

  /** Returns the material index or -1 when the cell is empty or outside the grid. */
  get(x: number, y: number, z: number): number {
    if (!this.inside(x, y, z)) return -1;
    return this.cells[x + y * this.sizeX + z * this.strideZ] - 1;
  }

  set(x: number, y: number, z: number, material: number): void {
    if (!this.inside(x, y, z)) return;
    const offset = x + y * this.sizeX + z * this.strideZ;
    if (this.cells[offset] === 0) this.filled += 1;
    this.cells[offset] = material + 1;
  }

  setIfEmpty(x: number, y: number, z: number, material: number): boolean {
    if (!this.inside(x, y, z)) return false;
    const offset = x + y * this.sizeX + z * this.strideZ;
    if (this.cells[offset] !== 0) return false;
    this.cells[offset] = material + 1;
    this.filled += 1;
    return true;
  }

  get voxelCount(): number {
    return this.filled;
  }

  /** Number of quads a preview mesh would need — used to stay inside the viewer budget. */
  countSurfaceFaces(): number {
    let faces = 0;
    for (let z = 0; z < this.sizeZ; z += 1) {
      for (let y = 0; y < this.sizeY; y += 1) {
        for (let x = 0; x < this.sizeX; x += 1) {
          if (this.cells[x + y * this.sizeX + z * this.strideZ] === 0) continue;
          if (this.get(x - 1, y, z) < 0) faces += 1;
          if (this.get(x + 1, y, z) < 0) faces += 1;
          if (this.get(x, y - 1, z) < 0) faces += 1;
          if (this.get(x, y + 1, z) < 0) faces += 1;
          if (this.get(x, y, z - 1) < 0) faces += 1;
          if (this.get(x, y, z + 1) < 0) faces += 1;
        }
      }
    }
    return faces;
  }

  toVoxels(): GeneratedVoxel[] {
    const voxels: GeneratedVoxel[] = new Array(this.filled);
    let cursor = 0;
    for (let z = 0; z < this.sizeZ; z += 1) {
      for (let y = 0; y < this.sizeY; y += 1) {
        for (let x = 0; x < this.sizeX; x += 1) {
          const value = this.cells[x + y * this.sizeX + z * this.strideZ];
          if (value !== 0) voxels[cursor++] = { x, y, z, color: value - 1 };
        }
      }
    }
    voxels.length = cursor;
    return voxels;
  }
}
