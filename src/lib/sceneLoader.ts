import type { VoxAsset, VoxSceneData } from "../types";
import { parseVox } from "../vox/parser";
import { readVoxFile } from "./tauri";

const cache = new Map<string, Promise<VoxSceneData>>();
const MAX_CACHED_SCENES = 12;
const MAX_CACHED_FILE_SIZE = 32 * 1024 * 1024;

export function loadVoxScene(asset: VoxAsset): Promise<VoxSceneData> {
  const load = () => readVoxFile(asset.path).then(parseVox);
  if (asset.size > MAX_CACHED_FILE_SIZE) return load();
  const cached = cache.get(asset.thumbnailKey);
  if (cached) return cached;
  const request = load()
    .catch((error) => {
      cache.delete(asset.thumbnailKey);
      throw error;
    });
  cache.set(asset.thumbnailKey, request);
  if (cache.size > MAX_CACHED_SCENES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest) cache.delete(oldest);
  }
  return request;
}
