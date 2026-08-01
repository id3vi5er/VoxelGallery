export type Vector3Tuple = [number, number, number];

export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface VoxVoxel {
  x: number;
  y: number;
  z: number;
  colorIndex: number;
}

export interface VoxModel {
  size: Vector3Tuple;
  voxels: Uint8Array;
  voxelCount: number;
}

export interface VoxTransform {
  matrix: [number, number, number, number, number, number, number, number, number];
  translation: Vector3Tuple;
}

export interface VoxInstance {
  modelId: number;
  transform: VoxTransform;
}

export interface VoxSceneData {
  version: number;
  models: VoxModel[];
  palette: RgbaColor[];
  instances: VoxInstance[];
}

export interface LibraryFolder {
  id: string;
  name: string;
  path: string;
  addedAt: number;
}

export interface ScannedVoxFile {
  path: string;
  name: string;
  relativePath: string;
  size: number;
  modifiedMs: number;
}

export interface VoxAsset extends ScannedVoxFile {
  id: string;
  libraryId: string;
  thumbnailKey: string;
}

export interface AssetColorMetadata {
  colors: Array<{ hex: string; count: number; index: number }>;
  colorCount: number;
  dominantHue: number;
}

export interface LibraryScanError {
  libraryId: string;
  message: string;
}
