import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Vector3Tuple } from "../types";
import { createVoxMaterial, PreviewBudgetError, type PreviewQuality } from "../vox/geometry";
import { prepareVoxPreview, type PreparedVoxPreview } from "../lib/preview";
import { ResetIcon } from "./icons";
import { useI18n } from "../lib/i18n";

type ViewName = "iso" | "front" | "back" | "left" | "right" | "top" | "bottom";

interface ViewerController {
  setView: (view: ViewName) => void;
  setAutoRotate: (enabled: boolean) => void;
  setGrid: (enabled: boolean) => void;
}

interface Viewer3DProps {
  bytes: Uint8Array;
  cacheKey?: string;
  onStats: (voxelCount: number, dimensions: Vector3Tuple) => void;
  onInfo?: (preview: PreparedVoxPreview) => void;
}

const VIEW_DIRECTIONS: Record<ViewName, THREE.Vector3> = {
  iso: new THREE.Vector3(1.2, 0.9, 1.2), front: new THREE.Vector3(0, 0, 1), back: new THREE.Vector3(0, 0, -1),
  left: new THREE.Vector3(-1, 0, 0), right: new THREE.Vector3(1, 0, 0), top: new THREE.Vector3(0, 1, 0.001), bottom: new THREE.Vector3(0, -1, 0.001),
};

export function Viewer3D({ bytes, cacheKey, onStats, onInfo }: Viewer3DProps) {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<ViewerController | null>(null);
  const [autoRotate, setAutoRotate] = useState(false);
  const [grid, setGrid] = useState(true);
  const [quality, setQuality] = useState<PreviewQuality>("exact");
  const [preview, setPreview] = useState<PreparedVoxPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [budgetExceeded, setBudgetExceeded] = useState(false);

  useEffect(() => { setQuality("exact"); }, [bytes]);

  useEffect(() => {
    const abort = new AbortController();
    setPreview(null);
    setError(null);
    setBudgetExceeded(false);
    void prepareVoxPreview(bytes, quality, abort.signal, cacheKey)
      .then((result) => {
        setPreview(result);
        onStats(result.voxelCount, result.dimensions);
        onInfo?.(result);
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setBudgetExceeded(reason instanceof PreviewBudgetError);
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => abort.abort();
  }, [bytes, cacheKey, onInfo, onStats, quality]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !preview) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x12141d, 1);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x12141d, 0.0015);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100_000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.screenSpacePanning = true;
    controls.zoomToCursor = true;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 1.5;

    scene.add(new THREE.HemisphereLight(0xe2eaff, 0x151323, 2.1));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.75);
    keyLight.position.set(4, 8, 5);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x7868ff, 1.25);
    rimLight.position.set(-4, 2, -5);
    scene.add(rimLight);

    const material = createVoxMaterial();
    const geometries: THREE.BufferGeometry[] = [];
    for (const chunk of preview.chunks) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(chunk.positions, 3));
      geometry.setAttribute("normal", new THREE.Int8BufferAttribute(chunk.normals, 3, true));
      geometry.setAttribute("color", new THREE.Uint8BufferAttribute(chunk.colors, 3, true));
      geometry.setIndex(new THREE.BufferAttribute(chunk.indices, 1));
      geometries.push(geometry);
      const group = preview.instances.find((candidate) => candidate.modelId === chunk.modelId);
      if (!group) continue;
      const count = group.matrices.length / 16;
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      for (let index = 0; index < count; index += 1) mesh.setMatrixAt(index, new THREE.Matrix4().fromArray(group.matrices, index * 16));
      mesh.instanceMatrix.needsUpdate = true;
      scene.add(mesh);
    }

    const box = new THREE.Box3(new THREE.Vector3().fromArray(preview.bounds.min), new THREE.Vector3().fromArray(preview.bounds.max));
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.y, size.z, 1);
    controls.target.copy(center);
    controls.minDistance = Math.max(0.1, extent * 0.15);
    controls.maxDistance = Math.max(10, extent * 30);

    const gridHelper = new THREE.GridHelper(Math.max(20, Math.ceil(extent * 2.5 / 10) * 10), 20, 0x4f5368, 0x292c3b);
    gridHelper.position.set(center.x, box.min.y - 0.01, center.z);
    gridHelper.visible = grid;
    scene.add(gridHelper);

    const setView = (view: ViewName) => {
      const direction = VIEW_DIRECTIONS[view].clone().normalize();
      camera.up.set(0, 1, 0);
      if (view === "top") camera.up.set(0, 0, -1);
      if (view === "bottom") camera.up.set(0, 0, 1);
      camera.position.copy(center).add(direction.multiplyScalar(extent * 3.2));
      camera.near = Math.max(0.01, extent / 1000);
      camera.far = extent * 50 + 100;
      camera.updateProjectionMatrix();
      controls.target.copy(center);
      controls.update();
    };
    setView("iso");
    controllerRef.current = {
      setView,
      setAutoRotate: (enabled) => { controls.autoRotate = enabled; },
      setGrid: (enabled) => { gridHelper.visible = enabled; },
    };

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    let frame = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      for (const geometry of geometries) geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      controllerRef.current = null;
    };
  }, [preview]);

  const toggleAutoRotate = () => setAutoRotate((current) => {
    controllerRef.current?.setAutoRotate(!current);
    return !current;
  });
  const toggleGrid = () => setGrid((current) => {
    controllerRef.current?.setGrid(!current);
    return !current;
  });

  return (
    <div className="viewer-stage">
      <div ref={hostRef} className="viewer-canvas" />
      {!preview && !error && <div className="viewer-preview-status"><span className="spinner" /><p>{t("preparingPreview")}</p></div>}
      {error && <div className="viewer-preview-status error-message"><p>{error}</p>{budgetExceeded && quality === "exact" && <button type="button" onClick={() => setQuality("performance")}>{t("usePerformanceMode")}</button>}</div>}
      {preview?.lodFactor && preview.lodFactor > 1 && <div className="viewer-lod-badge">{t("performanceMode")} · LOD ×{preview.lodFactor}</div>}
      {preview && <>
        <div className="view-presets" aria-label={t("cameraViews")}>{(["front", "back", "left", "right", "top", "bottom"] as ViewName[]).map((view) => <button key={view} type="button" onClick={() => controllerRef.current?.setView(view)}>{t(view)}</button>)}<button type="button" className="icon-text-button" onClick={() => controllerRef.current?.setView("iso")}><ResetIcon /> {t("center")}</button></div>
        <div className="viewer-options"><button className={grid ? "active" : ""} type="button" onClick={toggleGrid}>{t("grid")}</button><button className={autoRotate ? "active" : ""} type="button" onClick={toggleAutoRotate}>{t("autoRotate")}</button>{quality === "performance" && <button type="button" onClick={() => setQuality("exact")}>{t("tryExact")}</button>}</div>
        <div className="viewer-help">{t("viewerHelp")}</div>
      </>}
    </div>
  );
}
