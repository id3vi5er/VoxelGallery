import { useCallback, useEffect, useState } from "react";
import type { Vector3Tuple, VoxAsset } from "../types";
import { readVoxFile, revealInExplorer } from "../lib/tauri";
import { CloseIcon, CubeIcon, ExternalIcon } from "./icons";
import { Viewer3D } from "./Viewer3D";
import { useI18n } from "../lib/i18n";
import type { PreparedVoxPreview } from "../lib/preview";

interface ViewerModalProps {
  asset: VoxAsset;
  onClose: () => void;
}

export function ViewerModal({ asset, onClose }: ViewerModalProps) {
  const { locale, t } = useI18n();
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [info, setInfo] = useState<PreparedVoxPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ voxels: number; dimensions: Vector3Tuple } | null>(null);
  const [showPalette, setShowPalette] = useState(true);
  const colorMetadata = info?.metadata ?? null;

  useEffect(() => {
    let active = true;
    setBytes(null);
    setInfo(null);
    setStats(null);
    setError(null);
    void readVoxFile(asset.path)
      .then((data) => active && setBytes(data))
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)));
    return () => { active = false; };
  }, [asset]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const onStats = useCallback((voxels: number, dimensions: Vector3Tuple) => setStats({ voxels, dimensions }), []);
  const onInfo = useCallback((preview: PreparedVoxPreview) => setInfo(preview), []);

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
        {bytes ? <><Viewer3D bytes={bytes} cacheKey={asset.thumbnailKey} onStats={onStats} onInfo={onInfo} />{showPalette && colorMetadata && <aside className="viewer-palette"><header><span>{t("usedColors")}</span><em>{colorMetadata.colorCount}</em></header><div>{colorMetadata.colors.map((color) => <div key={color.index}><i style={{ background: color.hex }} /><span><strong>{color.hex}</strong><small>{color.count.toLocaleString(locale)} {t("voxels")}</small></span><em>#{color.index}</em></div>)}</div></aside>}</> : error ? (
          <div className="viewer-message error-message"><CubeIcon /><h3>{t("openFailed")}</h3><p>{error}</p></div>
        ) : (
          <div className="viewer-message"><span className="spinner" /><p>{t("loadingModel")}</p></div>
        )}
      </main>
      <footer className="viewer-footer">
        <span>VOX Version {info?.version ?? "–"}</span>
        <span>{info?.modelCount ?? "–"} {info?.modelCount === 1 ? t("model") : t("models")}</span>
        <span>{stats ? stats.voxels.toLocaleString(locale) : "–"} {t("voxels")}</span>
        <span>{stats ? `${stats.dimensions[0]} × ${stats.dimensions[1]} × ${stats.dimensions[2]}` : "–"}</span>
        <span className="path-label" title={asset.path}>{asset.path}</span>
      </footer>
    </div>
  );
}
