import { invoke } from "@tauri-apps/api/core";
import type { GeneratedVoxelScene } from "./types";

type Bytes = Uint8Array<ArrayBuffer>;

function int32(value: number): Bytes {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, value, true);
  return bytes;
}

function ascii(value: string): Bytes {
  const encoded = new TextEncoder().encode(value);
  return new Uint8Array(encoded);
}

function concat(...arrays: Uint8Array[]): Bytes {
  const result = new Uint8Array(arrays.reduce((sum, item) => sum + item.length, 0));
  let offset = 0;
  arrays.forEach((item) => { result.set(item, offset); offset += item.length; });
  return result;
}

function chunk(id: string, content: Uint8Array, children: Uint8Array = new Uint8Array()): Bytes {
  return concat(ascii(id), int32(content.length), int32(children.length), content, children);
}

export function createGeneratedVoxFile(scene: GeneratedVoxelScene): Bytes {
  const size = chunk("SIZE", concat(int32(scene.size.x), int32(scene.size.y), int32(scene.size.z)));
  const voxelBytes = new Uint8Array(scene.voxels.length * 4);
  scene.voxels.forEach((voxel, index) => {
    voxelBytes.set([voxel.x, voxel.y, voxel.z, voxel.color + 1], index * 4);
  });
  const xyzi = chunk("XYZI", concat(int32(scene.voxels.length), voxelBytes));
  const rgba = new Uint8Array(256 * 4);
  scene.palette.forEach((color, index) => {
    rgba.set([
      Number.parseInt(color.hex.slice(1, 3), 16),
      Number.parseInt(color.hex.slice(3, 5), 16),
      Number.parseInt(color.hex.slice(5, 7), 16),
      255,
    ], index * 4);
  });
  for (let index = scene.palette.length; index < 256; index += 1) rgba.set([0, 0, 0, 255], index * 4);
  const children = concat(size, xyzi, chunk("RGBA", rgba));
  return concat(ascii("VOX "), int32(150), chunk("MAIN", new Uint8Array(), children));
}

export async function saveGeneratedVox(scene: GeneratedVoxelScene, directory: string): Promise<string> {
  const bytes = createGeneratedVoxFile(scene);
  return invoke<string>("save_generated_vox", {
    directory,
    fileName: `${scene.name || "voxel-asset"}.vox`,
    bytes: Array.from(bytes),
  });
}
