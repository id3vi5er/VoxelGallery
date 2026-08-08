import { analyzeSceneColors } from "./colors";
import { buildVoxMesh, PreviewBudgetError, type PreviewQuality } from "./geometry";
import { parseVox } from "./parser";
import type { PreparedVoxPreview } from "../lib/preview";
import type { VoxSceneData } from "../types";

interface WorkerRequest {
  id: number;
  bytes: ArrayBuffer;
  quality: PreviewQuality;
  cacheKey?: string;
}

const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_CACHED_FILE_BYTES = 32 * 1024 * 1024;
const sceneCache = new Map<string, { scene: VoxSceneData; bytes: number }>();
let cachedBytes = 0;

function cachedScene(key: string | undefined, bytes: ArrayBuffer): VoxSceneData {
  if (key) {
    const cached = sceneCache.get(key);
    if (cached) {
      sceneCache.delete(key);
      sceneCache.set(key, cached);
      return cached.scene;
    }
  }
  const scene = parseVox(bytes);
  if (key && bytes.byteLength <= MAX_CACHED_FILE_BYTES) {
    sceneCache.set(key, { scene, bytes: bytes.byteLength });
    cachedBytes += bytes.byteLength;
    while (cachedBytes > MAX_CACHE_BYTES) {
      const oldestKey = sceneCache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      cachedBytes -= sceneCache.get(oldestKey)?.bytes ?? 0;
      sceneCache.delete(oldestKey);
    }
  }
  return scene;
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, bytes, quality, cacheKey } = event.data;
  try {
    const scene = cachedScene(cacheKey, bytes);
    const mesh = buildVoxMesh(scene, quality);
    const result: PreparedVoxPreview = {
      ...mesh,
      version: scene.version,
      modelCount: scene.models.length,
      metadata: analyzeSceneColors(scene),
    };
    const transfer: Transferable[] = [];
    for (const chunk of result.chunks) transfer.push(chunk.positions.buffer, chunk.normals.buffer, chunk.colors.buffer, chunk.indices.buffer);
    for (const group of result.instances) transfer.push(group.matrices.buffer);
    self.postMessage({ id, result }, { transfer });
  } catch (error) {
    const value = error instanceof Error ? error : new Error(String(error));
    self.postMessage({
      id,
      error: {
        message: value.message,
        code: error instanceof PreviewBudgetError ? error.code : undefined,
      },
    });
  }
};
