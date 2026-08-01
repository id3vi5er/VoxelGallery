import { useEffect, useState } from "react";
import type { AssetColorMetadata, VoxAsset } from "../types";
import { loadVoxScene } from "../lib/sceneLoader";
import { thumbnailRenderer } from "../three/thumbnail";
import { CubeIcon } from "./icons";
import { useI18n } from "../lib/i18n";

interface VoxelCardProps {
  asset: VoxAsset;
  onOpen: (asset: VoxAsset) => void;
  knownError?: string;
  onError: (asset: VoxAsset, message: string) => void;
  onReady: (asset: VoxAsset) => void;
  onMetadata: (asset: VoxAsset, metadata: AssetColorMetadata) => void;
  metadata?: AssetColorMetadata;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 100 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function VoxelCard({ asset, onOpen, knownError, onError, onReady, onMetadata, metadata }: VoxelCardProps) {
  const { t } = useI18n();
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    const abortController = new AbortController();
    setThumbnailUrl(null);
    setError(knownError ?? null);
    if (knownError) return () => abortController.abort();
    void thumbnailRenderer
      .get(asset.thumbnailKey, () => loadVoxScene(asset), abortController.signal)
      .then((result) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(result.blob);
        setThumbnailUrl(objectUrl);
        onMetadata(asset, result.metadata);
        onReady(asset);
      })
      .catch((reason) => {
        if (!active) return;
        const message = reason instanceof Error ? reason.message : String(reason);
        setError(message);
        onError(asset, message);
      });
    return () => {
      active = false;
      abortController.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [asset, knownError, onError, onMetadata, onReady]);

  return (
    <button className="voxel-card" type="button" onClick={() => onOpen(asset)} title={error ?? asset.path}>
      <span className={`thumbnail ${error ? "thumbnail-error" : ""}`}>
        {thumbnailUrl ? <img src={thumbnailUrl} alt="" /> : <span className="thumbnail-placeholder"><CubeIcon />{error ? t("noPreview") : t("preview")}</span>}
        <span className="format-badge">VOX</span>
      </span>
      <span className="card-copy">
        <strong>{asset.name.replace(/\.vox$/i, "")}</strong>
        <span>{formatBytes(asset.size)} · {asset.relativePath.includes("\\") || asset.relativePath.includes("/") ? asset.relativePath : t("libraryRoot")}</span>
        {metadata && <span className="card-palette" title={t("usedColorsTitle", { count: metadata.colorCount })}>{metadata.colors.slice(0, 8).map((color) => <i key={color.index} style={{ backgroundColor: color.hex }} />)}<em>{metadata.colorCount}</em></span>}
      </span>
    </button>
  );
}
