import * as THREE from "three";
import type { Vector3Tuple, VoxModel, VoxSceneData, VoxTransform } from "../types";

export type PreviewQuality = "exact" | "performance";

export interface VoxMeshChunk {
  modelId: number;
  positions: Float32Array;
  normals: Int8Array;
  colors: Uint8Array;
  indices: Uint16Array;
}

export interface VoxMeshInstances {
  modelId: number;
  matrices: Float32Array;
}

export interface VoxMeshData {
  chunks: VoxMeshChunk[];
  instances: VoxMeshInstances[];
  voxelCount: number;
  dimensions: Vector3Tuple;
  bounds: { min: Vector3Tuple; max: Vector3Tuple };
  faceCount: number;
  bufferBytes: number;
  lodFactor: number;
}

export interface VoxGeometryResult {
  geometry: THREE.BufferGeometry;
  voxelCount: number;
  dimensions: Vector3Tuple;
}

interface Grid {
  size: Vector3Tuple;
  boundaries: [number[], number[], number[]];
  occupancy: Uint8Array;
  voxelCount: number;
}

const MAX_MODEL_VOXELS = 20_000_000;
export const MAX_MESH_BYTES = 128 * 1024 * 1024;
const CHUNK_QUADS = 8_192;
const BYTES_PER_QUAD = 4 * 3 * 4 + 4 * 3 + 4 * 3 + 6 * 2;

export class PreviewBudgetError extends Error {
  readonly code = "PREVIEW_BUDGET_EXCEEDED";

  constructor(message = "Die exakte Oberfläche überschreitet das sichere Vorschau-Budget.") {
    super(message);
    this.name = "PreviewBudgetError";
  }
}

function checkedModelSize(model: VoxModel): Vector3Tuple {
  const size = model.size;
  if (size.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new Error("Das Modell enthält ungültige Abmessungen.");
  }
  if (model.voxelCount > MAX_MODEL_VOXELS) {
    throw new Error("Das Modell enthält zu viele Voxel für eine sichere Vorschau.");
  }
  return size;
}

function buildExactGrid(model: VoxModel): Grid {
  const declared = checkedModelSize(model);
  let maxX = -1;
  let maxY = -1;
  let maxZ = -1;
  for (let offset = 0; offset + 3 < model.voxels.length; offset += 4) {
    const x = model.voxels[offset];
    const y = model.voxels[offset + 1];
    const z = model.voxels[offset + 2];
    if (x < declared[0] && y < declared[1] && z < declared[2]) {
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
  }
  const size: Vector3Tuple = [Math.max(1, maxX + 1), Math.max(1, maxY + 1), Math.max(1, maxZ + 1)];
  const volume = size[0] * size[1] * size[2];
  if (!Number.isSafeInteger(volume) || volume > 64 * 1024 * 1024) {
    throw new PreviewBudgetError("Das belegte Modellraster überschreitet das sichere Vorschau-Budget.");
  }
  const occupancy = new Uint8Array(volume);
  let voxelCount = 0;
  const strideZ = size[0] * size[1];
  for (let offset = 0; offset + 3 < model.voxels.length; offset += 4) {
    const x = model.voxels[offset];
    const y = model.voxels[offset + 1];
    const z = model.voxels[offset + 2];
    if (x >= declared[0] || y >= declared[1] || z >= declared[2] || x >= size[0] || y >= size[1] || z >= size[2]) continue;
    const index = x + y * size[0] + z * strideZ;
    if (occupancy[index] === 0) voxelCount += 1;
    occupancy[index] = model.voxels[offset + 3] || 1;
  }
  return {
    size,
    occupancy,
    voxelCount,
    boundaries: [
      Array.from({ length: size[0] + 1 }, (_, index) => index),
      Array.from({ length: size[1] + 1 }, (_, index) => index),
      Array.from({ length: size[2] + 1 }, (_, index) => index),
    ],
  };
}

function indexOf(size: Vector3Tuple, x: number, y: number, z: number): number {
  return x + y * size[0] + z * size[0] * size[1];
}

function occupied(grid: Grid, x: number, y: number, z: number): number {
  if (x < 0 || y < 0 || z < 0 || x >= grid.size[0] || y >= grid.size[1] || z >= grid.size[2]) return 0;
  return grid.occupancy[indexOf(grid.size, x, y, z)];
}

function buildLodGrid(source: Grid, factor: number): Grid {
  const size: Vector3Tuple = source.size.map((value) => Math.ceil(value / factor)) as Vector3Tuple;
  const boundaries = source.size.map((value) =>
    Array.from({ length: Math.ceil(value / factor) + 1 }, (_, index) => Math.min(value, index * factor)),
  ) as [number[], number[], number[]];
  const occupancy = new Uint8Array(size[0] * size[1] * size[2]);
  const surfaceCounts = new Uint32Array(256);
  const volumeCounts = new Uint32Array(256);
  const touched: number[] = [];
  let voxelCount = 0;

  for (let cz = 0; cz < size[2]; cz += 1) {
    for (let cy = 0; cy < size[1]; cy += 1) {
      for (let cx = 0; cx < size[0]; cx += 1) {
        touched.length = 0;
        let containsVoxel = false;
        for (let z = boundaries[2][cz]; z < boundaries[2][cz + 1]; z += 1) {
          for (let y = boundaries[1][cy]; y < boundaries[1][cy + 1]; y += 1) {
            for (let x = boundaries[0][cx]; x < boundaries[0][cx + 1]; x += 1) {
              const color = occupied(source, x, y, z);
              if (!color) continue;
              containsVoxel = true;
              if (volumeCounts[color] === 0 && surfaceCounts[color] === 0) touched.push(color);
              volumeCounts[color] += 1;
              const exposed = Number(!occupied(source, x - 1, y, z)) + Number(!occupied(source, x + 1, y, z)) +
                Number(!occupied(source, x, y - 1, z)) + Number(!occupied(source, x, y + 1, z)) +
                Number(!occupied(source, x, y, z - 1)) + Number(!occupied(source, x, y, z + 1));
              surfaceCounts[color] += exposed;
            }
          }
        }
        if (containsVoxel) {
          let bestColor = touched[0] ?? 1;
          for (const color of touched) {
            if (surfaceCounts[color] > surfaceCounts[bestColor] ||
              (surfaceCounts[color] === surfaceCounts[bestColor] && volumeCounts[color] > volumeCounts[bestColor])) bestColor = color;
          }
          occupancy[indexOf(size, cx, cy, cz)] = bestColor;
          voxelCount += 1;
        }
        for (const color of touched) {
          surfaceCounts[color] = 0;
          volumeCounts[color] = 0;
        }
      }
    }
  }
  return { size, boundaries, occupancy, voxelCount };
}

function toThree(point: readonly number[]): Vector3Tuple {
  return [point[0], point[2], -point[1]];
}

class ChunkWriter {
  private positions: number[] = [];
  private normals: number[] = [];
  private colors: number[] = [];
  private indices: number[] = [];
  readonly chunks: VoxMeshChunk[] = [];
  faceCount = 0;
  bufferBytes = 0;

  constructor(private readonly modelId: number, private readonly budget: number) {}

  quad(points: Vector3Tuple[], normal: Vector3Tuple, color: Vector3Tuple): void {
    if (this.bufferBytes + (this.indices.length / 6 + 1) * BYTES_PER_QUAD > this.budget) throw new PreviewBudgetError();
    const converted = points.map(toThree);
    const convertedNormal = toThree(normal);
    const ax = converted[1][0] - converted[0][0];
    const ay = converted[1][1] - converted[0][1];
    const az = converted[1][2] - converted[0][2];
    const bx = converted[2][0] - converted[0][0];
    const by = converted[2][1] - converted[0][1];
    const bz = converted[2][2] - converted[0][2];
    const dot = (ay * bz - az * by) * convertedNormal[0] +
      (az * bx - ax * bz) * convertedNormal[1] +
      (ax * by - ay * bx) * convertedNormal[2];
    if (dot < 0) {
      [converted[1], converted[3]] = [converted[3], converted[1]];
    }
    const base = this.positions.length / 3;
    for (const point of converted) {
      this.positions.push(...point);
      this.normals.push(...convertedNormal);
      this.colors.push(...color);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.faceCount += 1;
    if (this.indices.length / 6 >= CHUNK_QUADS) this.flush();
  }

  flush(): void {
    if (!this.indices.length) return;
    const chunk: VoxMeshChunk = {
      modelId: this.modelId,
      positions: new Float32Array(this.positions),
      normals: new Int8Array(this.normals),
      colors: new Uint8Array(this.colors),
      indices: new Uint16Array(this.indices),
    };
    this.bufferBytes += chunk.positions.byteLength + chunk.normals.byteLength + chunk.colors.byteLength + chunk.indices.byteLength;
    this.chunks.push(chunk);
    this.positions = [];
    this.normals = [];
    this.colors = [];
    this.indices = [];
  }
}

function meshGrid(grid: Grid, modelId: number, palette: VoxSceneData["palette"], budget: number): ChunkWriter {
  const writer = new ChunkWriter(modelId, budget);
  const linearByte = (value: number) => {
    const srgb = value / 255;
    const linear = srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
    return Math.round(linear * 255);
  };
  const linearPalette = palette.map((color) => [linearByte(color.r), linearByte(color.g), linearByte(color.b)] as Vector3Tuple);
  const axes = [0, 1, 2] as const;
  for (const d of axes) {
    const u = axes[(d + 1) % 3];
    const v = axes[(d + 2) % 3];
    for (const sign of [-1, 1] as const) {
      for (let slice = 0; slice < grid.size[d]; slice += 1) {
        const mask = new Uint16Array(grid.size[u] * grid.size[v]);
        for (let j = 0; j < grid.size[v]; j += 1) {
          for (let i = 0; i < grid.size[u]; i += 1) {
            const coordinate = [0, 0, 0];
            coordinate[d] = slice;
            coordinate[u] = i;
            coordinate[v] = j;
            const color = occupied(grid, coordinate[0], coordinate[1], coordinate[2]);
            coordinate[d] += sign;
            if (color && !occupied(grid, coordinate[0], coordinate[1], coordinate[2])) mask[i + j * grid.size[u]] = color;
          }
        }
        for (let j = 0; j < grid.size[v]; j += 1) {
          for (let i = 0; i < grid.size[u];) {
            const colorIndex = mask[i + j * grid.size[u]];
            if (!colorIndex) { i += 1; continue; }
            let width = 1;
            while (i + width < grid.size[u] && mask[i + width + j * grid.size[u]] === colorIndex) width += 1;
            let height = 1;
            heightLoop: while (j + height < grid.size[v]) {
              for (let offset = 0; offset < width; offset += 1) {
                if (mask[i + offset + (j + height) * grid.size[u]] !== colorIndex) break heightLoop;
              }
              height += 1;
            }
            const plane = grid.boundaries[d][slice + (sign > 0 ? 1 : 0)];
            const lowU = grid.boundaries[u][i];
            const highU = grid.boundaries[u][i + width];
            const lowV = grid.boundaries[v][j];
            const highV = grid.boundaries[v][j + height];
            const makePoint = (cu: number, cv: number): Vector3Tuple => {
              const point = [0, 0, 0];
              point[d] = plane;
              point[u] = cu;
              point[v] = cv;
              return point as Vector3Tuple;
            };
            const color = linearPalette[colorIndex] ?? linearPalette[1] ?? [255, 255, 255];
            const points = [makePoint(lowU, lowV), makePoint(highU, lowV), makePoint(highU, highV), makePoint(lowU, highV)];
            writer.quad(points, axes.map((axis) => axis === d ? sign : 0) as Vector3Tuple, color);
            for (let y = 0; y < height; y += 1) mask.fill(0, i + (j + y) * grid.size[u], i + width + (j + y) * grid.size[u]);
            i += width;
          }
        }
      }
    }
  }
  writer.flush();
  return writer;
}

function transformToThreeMatrix(transform: VoxTransform): Float32Array {
  const m = transform.matrix;
  const t = transform.translation;
  const source = new THREE.Matrix4().set(
    m[0], m[1], m[2], t[0],
    m[3], m[4], m[5], t[1],
    m[6], m[7], m[8], t[2],
    0, 0, 0, 1,
  );
  const basis = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
  return new Float32Array(basis.clone().multiply(source).multiply(basis.clone().invert()).elements);
}

function buildAtFactor(scene: VoxSceneData, factor: number): VoxMeshData {
  const chunks: VoxMeshChunk[] = [];
  const instances: VoxMeshInstances[] = [];
  let bufferBytes = 0;
  let faceCount = 0;
  let voxelCount = 0;
  const bounds = new THREE.Box3();
  bounds.makeEmpty();

  const instanceGroups = new Map<number, typeof scene.instances>();
  for (const instance of scene.instances) {
    const group = instanceGroups.get(instance.modelId) ?? [];
    group.push(instance);
    instanceGroups.set(instance.modelId, group);
  }

  for (const [modelId, modelInstances] of instanceGroups) {
    const model = scene.models[modelId];
    if (!model) continue;
    const exact = buildExactGrid(model);
    const grid = factor === 1 ? exact : buildLodGrid(exact, factor);
    const writer = meshGrid(grid, modelId, scene.palette, MAX_MESH_BYTES - bufferBytes);
    chunks.push(...writer.chunks);
    bufferBytes += writer.bufferBytes;
    faceCount += writer.faceCount;
    voxelCount += exact.voxelCount * modelInstances.length;

    const matrices = new Float32Array(modelInstances.length * 16);
    const localBox = new THREE.Box3(new THREE.Vector3(0, 0, -grid.boundaries[1].at(-1)!), new THREE.Vector3(grid.boundaries[0].at(-1)!, grid.boundaries[2].at(-1)!, 0));
    modelInstances.forEach((instance, index) => {
      const values = transformToThreeMatrix(instance.transform);
      matrices.set(values, index * 16);
      bounds.union(localBox.clone().applyMatrix4(new THREE.Matrix4().fromArray(values)));
    });
    bufferBytes += matrices.byteLength;
    if (bufferBytes > MAX_MESH_BYTES) throw new PreviewBudgetError();
    instances.push({ modelId, matrices });
  }

  if (bounds.isEmpty()) bounds.set(new THREE.Vector3(), new THREE.Vector3(1, 1, 1));
  const size = bounds.getSize(new THREE.Vector3());
  return {
    chunks,
    instances,
    voxelCount,
    dimensions: [Math.round(size.x), Math.round(Math.abs(size.z)), Math.round(size.y)],
    bounds: { min: bounds.min.toArray() as Vector3Tuple, max: bounds.max.toArray() as Vector3Tuple },
    faceCount,
    bufferBytes,
    lodFactor: factor,
  };
}

export function buildVoxMesh(scene: VoxSceneData, quality: PreviewQuality = "exact"): VoxMeshData {
  if (quality === "exact") return buildAtFactor(scene, 1);
  const maximum = Math.max(...scene.models.flatMap((model) => model.size), 2);
  let lastError: unknown;
  for (let factor = 2; factor <= maximum * 2; factor *= 2) {
    try {
      return buildAtFactor(scene, factor);
    } catch (error) {
      if (!(error instanceof PreviewBudgetError)) throw error;
      lastError = error;
    }
  }
  throw lastError ?? new PreviewBudgetError("Auch die vereinfachte Vorschau überschreitet das sichere Budget.");
}

export function buildVoxGeometry(scene: VoxSceneData): VoxGeometryResult {
  const mesh = buildVoxMesh(scene);
  const vertexCount = mesh.chunks.reduce((sum, chunk) => sum + chunk.positions.length / 3, 0);
  const indexCount = mesh.chunks.reduce((sum, chunk) => sum + chunk.indices.length, 0);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Int8Array(vertexCount * 3);
  const colors = new Uint8Array(vertexCount * 3);
  const indices = new Uint32Array(indexCount);
  let vertexOffset = 0;
  let indexOffset = 0;
  for (const chunk of mesh.chunks) {
    positions.set(chunk.positions, vertexOffset * 3);
    normals.set(chunk.normals, vertexOffset * 3);
    colors.set(chunk.colors, vertexOffset * 3);
    for (let index = 0; index < chunk.indices.length; index += 1) indices[indexOffset + index] = chunk.indices[index] + vertexOffset;
    vertexOffset += chunk.positions.length / 3;
    indexOffset += chunk.indices.length;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Int8BufferAttribute(normals, 3, true));
  geometry.setAttribute("color", new THREE.Uint8BufferAttribute(colors, 3, true));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3().fromArray(mesh.bounds.min), new THREE.Vector3().fromArray(mesh.bounds.max));
  geometry.computeBoundingSphere();
  return { geometry, voxelCount: mesh.voxelCount, dimensions: mesh.dimensions };
}

export function createVoxMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.02, side: THREE.FrontSide });
}
