import { invoke } from "@tauri-apps/api/core";
import type { ScannedVoxFile } from "../types";

export const isTauri = (): boolean => "__TAURI_INTERNALS__" in window;

export async function scanLibrary(path: string): Promise<ScannedVoxFile[]> {
  if (!isTauri()) throw new Error("Ordnerzugriff steht nur in der Desktop-App zur Verfügung.");
  return invoke<ScannedVoxFile[]>("scan_library", { path });
}

export async function readVoxFile(path: string): Promise<Uint8Array> {
  if (!isTauri()) throw new Error("Dateizugriff steht nur in der Desktop-App zur Verfügung.");
  const bytes = await invoke<ArrayBuffer | number[] | Uint8Array>("read_vox", { path });
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  return new Uint8Array(bytes);
}

export async function revealInExplorer(path: string): Promise<void> {
  await invoke("reveal_in_explorer", { path });
}
