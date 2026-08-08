import { describe, expect, it } from "vitest";
import type { VoxSceneData } from "../types";
import { buildVoxMesh } from "./geometry";

const identity = {
  matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1] as [number, number, number, number, number, number, number, number, number],
  translation: [0, 0, 0] as [number, number, number],
};

function scene(size: [number, number, number], voxels: number[]): VoxSceneData {
  return {
    version: 150,
    palette: Array.from({ length: 256 }, (_, index) => ({ r: index, g: 255 - index, b: (index * 17) % 256, a: 255 })),
    models: [{ size, voxels: new Uint8Array(voxels), voxelCount: voxels.length / 4 }],
    instances: [{ modelId: 0, transform: identity }],
  };
}

describe("greedy voxel meshing", () => {
  it("merges the outside of adjacent voxels with the same color", () => {
    const result = buildVoxMesh(scene([2, 1, 1], [0, 0, 0, 1, 1, 0, 0, 1]));
    expect(result.faceCount).toBe(6);
  });

  it("keeps visible color boundaries", () => {
    const result = buildVoxMesh(scene([2, 1, 1], [0, 0, 0, 1, 1, 0, 0, 2]));
    expect(result.faceCount).toBe(10);
  });

  it("reduces a hollow volume to its outer and inner rectangles", () => {
    const voxels: number[] = [];
    const size = 24;
    for (let z = 0; z < size; z += 1) for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
      if (x === 0 || y === 0 || z === 0 || x === size - 1 || y === size - 1 || z === size - 1) voxels.push(x, y, z, 1);
    }
    const result = buildVoxMesh(scene([size, size, size], voxels));
    expect(result.voxelCount).toBe(size ** 3 - (size - 2) ** 3);
    expect(result.faceCount).toBe(12);
  });

  it("shares geometry between repeated scene instances", () => {
    const input = scene([1, 1, 1], [0, 0, 0, 1]);
    input.instances.push({ modelId: 0, transform: { ...identity, translation: [10, 0, 0] } });
    const result = buildVoxMesh(input);
    expect(result.faceCount).toBe(6);
    expect(result.instances[0].matrices).toHaveLength(32);
    expect(result.voxelCount).toBe(2);
    expect(result.dimensions).toEqual([11, 1, 1]);
  });

  it("uses a stable surface-colored block in performance mode", () => {
    const input = scene([2, 2, 2], [
      0, 0, 0, 2, 1, 0, 0, 2, 0, 1, 0, 2, 1, 1, 0, 2,
      0, 0, 1, 2, 1, 0, 1, 2, 0, 1, 1, 2, 1, 1, 1, 1,
    ]);
    const result = buildVoxMesh(input, "performance");
    expect(result.lodFactor).toBe(2);
    expect(result.voxelCount).toBe(8);
    expect(result.faceCount).toBe(6);
    expect(new Set(result.chunks[0].colors)).not.toEqual(new Set([0]));
  });
});
