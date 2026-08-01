import { useCallback, useEffect, useMemo, useState } from "react";
import type { LibraryFolder, LibraryScanError, VoxAsset } from "../types";
import { scanLibrary } from "./tauri";

const STORAGE_KEY = "voxel-gallery.libraries.v1";

function readStoredLibraries(): LibraryFolder[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter(
      (item): item is LibraryFolder =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as LibraryFolder).id === "string" &&
        typeof (item as LibraryFolder).name === "string" &&
        typeof (item as LibraryFolder).path === "string",
    );
  } catch {
    return [];
  }
}

function folderName(path: string): string {
  const cleaned = path.replace(/[\\/]+$/, "");
  return cleaned.split(/[\\/]/).pop() || path;
}

function stableId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function useLibraries() {
  const [libraries, setLibraries] = useState<LibraryFolder[]>(readStoredLibraries);
  const [assets, setAssets] = useState<VoxAsset[]>([]);
  const [errors, setErrors] = useState<LibraryScanError[]>([]);
  const [isScanning, setIsScanning] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(libraries));
  }, [libraries]);

  const scan = useCallback(async (folders: LibraryFolder[]) => {
    if (!folders.length) {
      setAssets([]);
      setErrors([]);
      return;
    }
    setIsScanning(true);
    const results = await Promise.all(
      folders.map(async (library) => {
        try {
          const files = await scanLibrary(library.path);
          const mapped: VoxAsset[] = files.map((file) => ({
            ...file,
            id: `${library.id}:${stableId(file.path.toLowerCase())}`,
            libraryId: library.id,
            thumbnailKey: `${stableId(file.path.toLowerCase())}-${file.size}-${file.modifiedMs}`,
          }));
          return { assets: mapped, error: null };
        } catch (error) {
          return {
            assets: [] as VoxAsset[],
            error: { libraryId: library.id, message: error instanceof Error ? error.message : String(error) },
          };
        }
      }),
    );
    setAssets(results.flatMap((result) => result.assets));
    setErrors(results.flatMap((result) => (result.error ? [result.error] : [])));
    setIsScanning(false);
  }, []);

  useEffect(() => {
    void scan(libraries);
  }, [libraries, scan]);

  const addLibrary = useCallback((path: string) => {
    const normalized = path.replace(/[\\/]+$/, "");
    setLibraries((current) => {
      if (current.some((library) => library.path.toLowerCase() === normalized.toLowerCase())) return current;
      return [
        ...current,
        { id: stableId(normalized.toLowerCase()), name: folderName(normalized), path: normalized, addedAt: Date.now() },
      ];
    });
  }, []);

  const removeLibrary = useCallback((id: string) => {
    setLibraries((current) => current.filter((library) => library.id !== id));
  }, []);

  const rescan = useCallback(() => scan(libraries), [libraries, scan]);
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const asset of assets) result.set(asset.libraryId, (result.get(asset.libraryId) ?? 0) + 1);
    return result;
  }, [assets]);

  return { libraries, assets, errors, isScanning, addLibrary, removeLibrary, rescan, counts };
}
