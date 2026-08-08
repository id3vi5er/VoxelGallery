import * as THREE from "three";
import type { AssetColorMetadata } from "../types";
import { createVoxMaterial, PreviewBudgetError } from "../vox/geometry";
import { cacheMetadata, cacheThumbnail, getCachedMetadata, getCachedThumbnail } from "../lib/thumbnailCache";
import { prepareVoxPreview, type PreparedVoxPreview } from "../lib/preview";

export interface ThumbnailResult {
  blob: Blob;
  metadata: AssetColorMetadata;
}

class ThumbnailRenderer {
  private renderer: THREE.WebGLRenderer | null = null;
  private queue: Promise<void> = Promise.resolve();

  async get(key: string, createBytes: () => Promise<Uint8Array>, signal?: AbortSignal): Promise<ThumbnailResult> {
    const ensureActive = () => {
      if (signal?.aborted) throw new Error("Thumbnail-Anfrage wurde abgebrochen.");
    };
    ensureActive();
    const [cached, cachedMetadata] = await Promise.all([
      getCachedThumbnail(key),
      getCachedMetadata<AssetColorMetadata>(key),
    ]);
    ensureActive();
    if (cached && cachedMetadata) return { blob: cached, metadata: cachedMetadata };

    const request = this.queue.then(async () => {
      ensureActive();
      const bytes = await createBytes();
      ensureActive();
      let preview: PreparedVoxPreview;
      try {
        preview = await prepareVoxPreview(bytes, "exact", signal, key);
      } catch (error) {
        if (!(error instanceof PreviewBudgetError)) throw error;
        preview = await prepareVoxPreview(bytes, "performance", signal, key);
      }
      const metadata = preview.metadata;
      const blob = cached ?? await this.render(preview);
      ensureActive();
      await Promise.all([cacheThumbnail(key, blob), cacheMetadata(key, metadata)]);
      return { blob, metadata };
    });
    this.queue = request.then(() => undefined, () => undefined);
    return request;
  }

  private async render(data: PreparedVoxPreview): Promise<Blob> {
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(360, 270, false);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.shadowMap.enabled = false;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1d2030);
    scene.add(new THREE.HemisphereLight(0xdce6ff, 0x18182a, 2.15));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(4, 8, 6);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x8b7aff, 1.0);
    fillLight.position.set(-5, 2, -4);
    scene.add(fillLight);

    const material = createVoxMaterial();
    const geometries: THREE.BufferGeometry[] = [];
    for (const chunk of data.chunks) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(chunk.positions, 3));
      geometry.setAttribute("normal", new THREE.Int8BufferAttribute(chunk.normals, 3, true));
      geometry.setAttribute("color", new THREE.Uint8BufferAttribute(chunk.colors, 3, true));
      geometry.setIndex(new THREE.BufferAttribute(chunk.indices, 1));
      geometries.push(geometry);
      const group = data.instances.find((candidate) => candidate.modelId === chunk.modelId);
      if (!group) continue;
      const mesh = new THREE.InstancedMesh(geometry, material, group.matrices.length / 16);
      for (let index = 0; index < group.matrices.length / 16; index += 1) mesh.setMatrixAt(index, new THREE.Matrix4().fromArray(group.matrices, index * 16));
      mesh.instanceMatrix.needsUpdate = true;
      scene.add(mesh);
    }
    const box = new THREE.Box3(new THREE.Vector3().fromArray(data.bounds.min), new THREE.Vector3().fromArray(data.bounds.max));
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.y, size.z, 1);
    const camera = new THREE.OrthographicCamera(-extent * 0.72, extent * 0.72, extent * 0.54, -extent * 0.54, 0.1, extent * 10 + 100);
    camera.position.copy(center).add(new THREE.Vector3(1.35, 1.05, 1.35).normalize().multiplyScalar(extent * 3));
    camera.lookAt(center);
    this.renderer.render(scene, camera);

    const blob = await new Promise<Blob>((resolve, reject) => {
      this.renderer!.domElement.toBlob(
        (value) => (value ? resolve(value) : reject(new Error("Vorschaubild konnte nicht erzeugt werden."))),
        "image/webp",
        0.88,
      );
    });
    for (const geometry of geometries) geometry.dispose();
    material.dispose();
    return blob;
  }
}

export const thumbnailRenderer = new ThumbnailRenderer();
