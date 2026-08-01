import { useCallback, useEffect, useMemo, useState } from "react";
import type { Vector3Tuple, VoxAsset, VoxSceneData } from "../types";
import { loadVoxScene } from "../lib/sceneLoader";
import { revealInExplorer } from "../lib/tauri";
import { CloseIcon, CubeIcon, ExternalIcon } from "./icons";
import { Viewer3D } from "./Viewer3D";
import { analyzeSceneColors } from "../vox/colors";
import { useI18n } from "../lib/i18n";

interface ViewerModalProps {
  asset: VoxAsset;
  onClose: () => void;
}

export function ViewerModal({ asset, onClose }: ViewerModalProps) {
  const { locale, t } = useI18n();
  const [scene, setScene] = useState<VoxSceneData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ voxels: number; dimensions: Vector3Tuple } | null>(null);
  const [showPalette, setShowPalette] = useState(true);
  const colorMetadata = useMemo(() => scene ? analyzeSceneColors(scene) : null, [scene]);

  useEffect(() => {
    let active = true;
    setScene(null);
    setError(null);
    void loadVoxScene(asset)
      .then((data) => active && setScene(data))
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)));
    return () => { active = false; };
  }, [asset]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const onStats = useCallback((voxels: number, dimensions: Vector3Tuple) => setStats({ voxels, dimensions }), []);

  return (
    <div className="viewer-modal" role="dialog" aria-modal="true" aria-label={t("viewAsset", { name: asset.name })}>
      <header className="viewer-header">
        <span className="viewer-file-icon"><CubeIcon /></span>
        <div>
          <h2>{asset.name}</h2>
          <p>{asset.relativePath}</p>
        </div>
        <div className="viewer-header-actions">
          <button className={showPalette ? "active" : ""} type="button" onClick={() => setShowPalette((value) => !value)}>{t("palette")} {colorMetadata ? `(${colorMetadata.colorCount})` : ""}</button>
          <button type="button" onClick={() => void revealInExplorer(asset.path)}><ExternalIcon /> {t("inExplorer")}</button>
          <button className="close-button" type="button" onClick={onClose} aria-label={t("closeViewer")}><CloseIcon /></button>
        </div>
      </header>
      <main className="viewer-main">
        {scene ? <><Viewer3D data={scene} onStats={onStats} />{showPalette && colorMetadata && <aside className="viewer-palette"><header><span>{t("usedColors")}</span><em>{colorMetadata.colorCount}</em></header><div>{colorMetadata.colors.map((color) => <div key={color.index}><i style={{ background: color.hex }} /><span><strong>{color.hex}</strong><small>{color.count.toLocaleString(locale)} {t("voxels")}</small></span><em>#{color.index}</em></div>)}</div></aside>}</> : error ? (
          <div className="viewer-message error-message"><CubeIcon /><h3>{t("openFailed")}</h3><p>{error}</p></div>
        ) : (
          <div className="viewer-message"><span className="spinner" /><p>{t("loadingModel")}</p></div>
        )}
      </main>
      <footer className="viewer-footer">
        <span>VOX Version {scene?.version ?? "–"}</span>
        <span>{scene?.models.length ?? "–"} {scene?.models.length === 1 ? t("model") : t("models")}</span>
        <span>{stats ? stats.voxels.toLocaleString(locale) : "–"} {t("voxels")}</span>
        <span>{stats ? `${stats.dimensions[0]} × ${stats.dimensions[1]} × ${stats.dimensions[2]}` : "–"}</span>
        <span className="path-label" title={asset.path}>{asset.path}</span>
      </footer>
    </div>
  );
}
