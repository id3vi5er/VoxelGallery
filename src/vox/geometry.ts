import * as THREE from "three";
import type { Vector3Tuple, VoxModel, VoxSceneData, VoxTransform } from "../types";

export interface VoxGeometryResult {
  geometry: THREE.BufferGeometry;
  voxelCount: number;
  dimensions: Vector3Tuple;
}

interface PreparedModel {
  model: VoxModel;
  occupancy: Uint8Array;
  voxelCount: number;
  faceCount: number;
}

const MAX_OCCUPANCY_BYTES = 64 * 1024 * 1024;
const MAX_MODEL_VOXELS = 20_000_000;
const MAX_SURFACE_FACES = 750_000;

const FACE_DEFINITIONS = [
  { direction: [1, 0, 0], normal: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { direction: [-1, 0, 0], normal: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { direction: [0, 1, 0], normal: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
  { direction: [0, -1, 0], normal: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { direction: [0, 0, 1], normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { direction: [0, 0, -1], normal: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] },
] as const;

function modelVolume(model: VoxModel): number {
  const [sizeX, sizeY, sizeZ] = model.size;
  if (
    !Number.isSafeInteger(sizeX) || !Number.isSafeInteger(sizeY) || !Number.isSafeInteger(sizeZ) ||
    sizeX <= 0 || sizeY <= 0 || sizeZ <= 0
  ) {
    throw new Error("Das Modell enthält ungültige Abmessungen.");
  }
  const volume = sizeX * sizeY * sizeZ;
  if (!Number.isSafeInteger(volume) || volume > MAX_OCCUPANCY_BYTES) {
    throw new Error("Das Modellraster ist zu groß für eine sichere Vorschau.");
  }
  return volume;
}

function prepareModel(model: VoxModel): PreparedModel {
  if (model.voxelCount > MAX_MODEL_VOXELS) {
    throw new Error("Das Modell enthält zu viele Voxel für eine sichere Vorschau.");
  }
  const [sizeX, sizeY, sizeZ] = model.size;
  const occupancy = new Uint8Array(modelVolume(model));
  const strideZ = sizeX * sizeY;
  let voxelCount = 0;
  for (let offset = 0; offset + 3 < model.voxels.length; offset += 4) {
    const x = model.voxels[offset];
    const y = model.voxels[offset + 1];
    const z = model.voxels[offset + 2];
    if (x >= sizeX || y >= sizeY || z >= sizeZ) continue;
    const index = x + y * sizeX + z * strideZ;
    if (occupancy[index] === 0) voxelCount += 1;
    occupancy[index] = model.voxels[offset + 3] || 1;
  }

  let faceCount = 0;
  for (let z = 0; z < sizeZ; z += 1) {
    for (let y = 0; y < sizeY; y += 1) {
      for (let x = 0; x < sizeX; x += 1) {
        const index = x + y * sizeX + z * strideZ;
        if (occupancy[index] === 0) continue;
        if (x === 0 || occupancy[index - 1] === 0) faceCount += 1;
        if (x === sizeX - 1 || occupancy[index + 1] === 0) faceCount += 1;
        if (y === 0 || occupancy[index - sizeX] === 0) faceCount += 1;
        if (y === sizeY - 1 || occupancy[index + sizeX] === 0) faceCount += 1;
        if (z === 0 || occupancy[index - strideZ] === 0) faceCount += 1;
        if (z === sizeZ - 1 || occupancy[index + strideZ] === 0) faceCount += 1;
      }
    }
  }
  return { model, occupancy, voxelCount, faceCount };
}

function transformPoint(transform: VoxTransform, point: readonly number[], translate: boolean): Vector3Tuple {
  const [x, y, z] = point;
  const matrix = transform.matrix;
  return [
    matrix[0] * x + matrix[1] * y + matrix[2] * z + (translate ? transform.translation[0] : 0),
    matrix[3] * x + matrix[4] * y + matrix[5] * z + (translate ? transform.translation[1] : 0),
    matrix[6] * x + matrix[7] * y + matrix[8] * z + (translate ? transform.translation[2] : 0),
  ];
}

function toThree([x, y, z]: Vector3Tuple): Vector3Tuple {
  return [x, z, -y];
}

function hasNeighbor(occupancy: Uint8Array, size: Vector3Tuple, x: number, y: number, z: number): boolean {
  const [sizeX, sizeY, sizeZ] = size;
  if (x < 0 || y < 0 || z < 0 || x >= sizeX || y >= sizeY || z >= sizeZ) return false;
  return occupancy[x + y * sizeX + z * sizeX * sizeY] !== 0;
}

export function buildVoxGeometry(scene: VoxSceneData): VoxGeometryResult {
  const preparedModels = new Map<number, PreparedModel>();
  let occupancyBytes = 0;
  let totalFaces = 0;
  let totalVoxels = 0;

  for (const instance of scene.instances) {
    let prepared = preparedModels.get(instance.modelId);
    if (!prepared) {
      const model = scene.models[instance.modelId];
      if (!model) continue;
      occupancyBytes += modelVolume(model);
      if (occupancyBytes > MAX_OCCUPANCY_BYTES) {
        throw new Error("Die Szene benötigt zu viel Arbeitsspeicher für eine sichere Vorschau.");
      }
      prepared = prepareModel(model);
      preparedModels.set(instance.modelId, prepared);
    }
    totalFaces += prepared.faceCount;
    totalVoxels += prepared.voxelCount;
    if (totalFaces > MAX_SURFACE_FACES) {
      throw new Error("Die sichtbare Oberfläche ist zu komplex für eine sichere Vorschau.");
    }
  }

  const positions = new Float32Array(totalFaces * 4 * 3);
  const normals = new Float32Array(totalFaces * 4 * 3);
  const colors = new Float32Array(totalFaces * 4 * 3);
  const indices = new Uint32Array(totalFaces * 6);
  const linearPalette = scene.palette.map((color) =>
    new THREE.Color().setRGB(color.r / 255, color.g / 255, color.b / 255, THREE.SRGBColorSpace),
  );
  let faceIndex = 0;

  for (const instance of scene.instances) {
    const prepared = preparedModels.get(instance.modelId);
    if (!prepared) continue;
    const { model, occupancy } = prepared;
    const [sizeX, sizeY, sizeZ] = model.size;
    const strideZ = sizeX * sizeY;
    for (let z = 0; z < sizeZ; z += 1) {
      for (let y = 0; y < sizeY; y += 1) {
        for (let x = 0; x < sizeX; x += 1) {
          const colorIndex = occupancy[x + y * sizeX + z * strideZ];
          if (colorIndex === 0) continue;
          const color = linearPalette[colorIndex] ?? linearPalette[1];
          for (const face of FACE_DEFINITIONS) {
            const [dx, dy, dz] = face.direction;
            if (hasNeighbor(occupancy, model.size, x + dx, y + dy, z + dz)) continue;
            const faceCenter: Vector3Tuple = [
              x + 0.5 + face.normal[0] * 0.5,
              y + 0.5 + face.normal[1] * 0.5,
              z + 0.5 + face.normal[2] * 0.5,
            ];
            const transformedNormal = toThree(transformPoint(instance.transform, face.normal, false));
            const signs = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
            for (let corner = 0; corner < 4; corner += 1) {
              const [uSign, vSign] = signs[corner];
              const localPoint: Vector3Tuple = [
                faceCenter[0] + (face.u[0] * uSign + face.v[0] * vSign) * 0.5,
                faceCenter[1] + (face.u[1] * uSign + face.v[1] * vSign) * 0.5,
                faceCenter[2] + (face.u[2] * uSign + face.v[2] * vSign) * 0.5,
              ];
              const point = toThree(transformPoint(instance.transform, localPoint, true));
              const attributeOffset = (faceIndex * 4 + corner) * 3;
              positions.set(point, attributeOffset);
              normals.set(transformedNormal, attributeOffset);
              colors.set([color.r, color.g, color.b], attributeOffset);
            }
            const vertexOffset = faceIndex * 4;
            indices.set(
              [vertexOffset, vertexOffset + 1, vertexOffset + 2, vertexOffset, vertexOffset + 2, vertexOffset + 3],
              faceIndex * 6,
            );
            faceIndex += 1;
          }
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const size = geometry.boundingBox?.getSize(new THREE.Vector3()) ?? new THREE.Vector3();
  return {
    geometry,
    voxelCount: totalVoxels,
    dimensions: [Math.round(size.x), Math.round(Math.abs(size.z)), Math.round(size.y)],
  };
}

export function createVoxMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.82,
    metalness: 0.02,
    side: THREE.FrontSide,
  });
}
