import type { AssetColorMetadata } from "../types";
import type { PreviewQuality, VoxMeshData } from "../vox/geometry";
import { PreviewBudgetError } from "../vox/geometry";

export interface PreparedVoxPreview extends VoxMeshData {
  version: number;
  modelCount: number;
  metadata: AssetColorMetadata;
}

interface WorkerRequest {
  id: number;
  bytes: ArrayBuffer;
  quality: PreviewQuality;
  cacheKey?: string;
}

interface WorkerSuccess {
  id: number;
  result: PreparedVoxPreview;
}

interface WorkerFailure {
  id: number;
  error: { message: string; code?: string };
}

type Pending = { resolve: (result: PreparedVoxPreview) => void; reject: (error: Error) => void };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("../vox/preview.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<WorkerSuccess | WorkerFailure>) => {
    const job = pending.get(event.data.id);
    if (!job) return;
    pending.delete(event.data.id);
    if ("result" in event.data) {
      job.resolve(event.data.result);
      return;
    }
    job.reject(event.data.error.code === "PREVIEW_BUDGET_EXCEEDED"
      ? new PreviewBudgetError(event.data.error.message)
      : new Error(event.data.error.message));
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || "Der Vorschau-Worker ist unerwartet fehlgeschlagen.");
    for (const job of pending.values()) job.reject(error);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

export function prepareVoxPreview(bytes: Uint8Array, quality: PreviewQuality, signal?: AbortSignal, cacheKey?: string): Promise<PreparedVoxPreview> {
  if (signal?.aborted) return Promise.reject(new DOMException("Vorschau wurde abgebrochen.", "AbortError"));
  const id = nextId++;
  // Keep the caller's bytes intact so an exact failure can be retried as LOD.
  const transferable = bytes.slice().buffer;
  return new Promise((resolve, reject) => {
    const abort = () => {
      pending.delete(id);
      reject(new DOMException("Vorschau wurde abgebrochen.", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    pending.set(id, {
      resolve: (result) => { signal?.removeEventListener("abort", abort); resolve(result); },
      reject: (error) => { signal?.removeEventListener("abort", abort); reject(error); },
    });
    const request: WorkerRequest = { id, bytes: transferable, quality, cacheKey };
    getWorker().postMessage(request, [transferable]);
  });
}
