const DATABASE_NAME = "voxel-gallery-cache";
const STORE_NAME = "thumbnails";
const METADATA_STORE_NAME = "metadata";
const DATABASE_VERSION = 2;

let databasePromise: Promise<IDBDatabase> | null = null;

function database(): Promise<IDBDatabase> {
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
        if (!request.result.objectStoreNames.contains(METADATA_STORE_NAME)) request.result.createObjectStore(METADATA_STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Thumbnail-Cache konnte nicht geöffnet werden."));
    });
  }
  return databasePromise;
}

export async function getCachedMetadata<T>(key: string): Promise<T | null> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction(METADATA_STORE_NAME, "readonly").objectStore(METADATA_STORE_NAME).get(key);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function cacheMetadata<T>(key: string, value: T): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(METADATA_STORE_NAME, "readwrite");
    transaction.objectStore(METADATA_STORE_NAME).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function getCachedThumbnail(key: string): Promise<Blob | null> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
    request.onerror = () => reject(request.error);
  });
}

export async function cacheThumbnail(key: string, blob: Blob): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(blob, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}
