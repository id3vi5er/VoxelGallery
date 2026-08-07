import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import type { AssetColorMetadata, VoxAsset } from "./types";
import { useLibraries } from "./lib/library";
import { isTauri } from "./lib/tauri";
import { VoxelCard } from "./components/VoxelCard";
import { ViewerModal } from "./components/ViewerModal";
import { GeneratorModal } from "./components/GeneratorModal";
import { LandscapeModal } from "./components/LandscapeModal";
import { ConvertersModal } from "./components/ConvertersModal";
import { CloseIcon, CubeIcon, FolderPlusIcon, GridIcon, RefreshIcon, SearchIcon, SettingsIcon, TrashIcon, TreeIcon, WandIcon } from "./components/icons";
import { useI18n } from "./lib/i18n";
import { colorSimilarityDistance } from "./vox/colorSimilarity";

type SortMode = "name" | "newest" | "largest" | "colors" | "hue" | "similarity";
const PAGE_SIZE = 96;

function parentFolder(path: string): string {
  const separator = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return separator > 0 ? path.slice(0, separator) : path;
}

export default function App() {
  const { language, setLanguage, t } = useI18n();
  const { libraries, assets, errors, isScanning, addLibrary, removeLibrary, rescan, counts } = useLibraries();
  const [selectedLibrary, setSelectedLibrary] = useState("all");
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [page, setPage] = useState(0);
  const [viewerAsset, setViewerAsset] = useState<VoxAsset | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failedAssets, setFailedAssets] = useState<Map<string, string>>(new Map());
  const [assetColors, setAssetColors] = useState<Map<string, AssetColorMetadata>>(new Map());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [landscapeOpen, setLandscapeOpen] = useState(false);
  const [convertersOpen, setConvertersOpen] = useState(false);
  const [hideUnreadable, setHideUnreadable] = useState(() => localStorage.getItem("voxel-gallery.hide-unreadable") === "true");
  const [infiniteScroll, setInfiniteScroll] = useState(() => localStorage.getItem("voxel-gallery.infinite-scroll") === "true");
  const [similarColor, setSimilarColor] = useState(() => localStorage.getItem("voxel-gallery.similar-color") ?? "#8267ff");
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "over") setIsDragOver(true);
      if (event.payload.type === "leave") setIsDragOver(false);
      if (event.payload.type === "drop") {
        setIsDragOver(false);
        const paths = event.payload.paths;
        paths.forEach((path) => addLibrary(path.toLowerCase().endsWith(".vox") ? parentFolder(path) : path));
        if (paths.length) setNotice(paths.length === 1 ? t("libraryAdded") : t("librariesAdded", { count: paths.length }));
      }
    }).then((dispose) => { unlisten = dispose; });
    return () => unlisten?.();
  }, [addLibrary, t]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (selectedLibrary !== "all" && !libraries.some((library) => library.id === selectedLibrary)) {
      setSelectedLibrary("all");
    }
  }, [libraries, selectedLibrary]);

  useEffect(() => {
    localStorage.setItem("voxel-gallery.hide-unreadable", String(hideUnreadable));
  }, [hideUnreadable]);

  useEffect(() => {
    localStorage.setItem("voxel-gallery.infinite-scroll", String(infiniteScroll));
  }, [infiniteScroll]);

  useEffect(() => {
    localStorage.setItem("voxel-gallery.similar-color", similarColor);
  }, [similarColor]);

  const chooseFolders = async () => {
    try {
      const selection = await open({ directory: true, multiple: true, title: t("folderDialog") });
      const paths = typeof selection === "string" ? [selection] : selection ?? [];
      paths.forEach(addLibrary);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const visibleAssets = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("de");
    return assets
      .filter((asset) => selectedLibrary === "all" || asset.libraryId === selectedLibrary)
      .filter((asset) => !hideUnreadable || !failedAssets.has(asset.thumbnailKey))
      .filter((asset) => !normalizedQuery || `${asset.name} ${asset.relativePath}`.toLocaleLowerCase("de").includes(normalizedQuery))
      .sort((left, right) => {
        if (sortMode === "newest") return right.modifiedMs - left.modifiedMs;
        if (sortMode === "largest") return right.size - left.size;
        if (sortMode === "colors") return (assetColors.get(right.thumbnailKey)?.colorCount ?? -1) - (assetColors.get(left.thumbnailKey)?.colorCount ?? -1);
        if (sortMode === "hue") return (assetColors.get(left.thumbnailKey)?.dominantHue ?? 999) - (assetColors.get(right.thumbnailKey)?.dominantHue ?? 999);
        if (sortMode === "similarity") return colorSimilarityDistance(assetColors.get(left.thumbnailKey), similarColor) - colorSimilarityDistance(assetColors.get(right.thumbnailKey), similarColor);
        return left.name.localeCompare(right.name, "de", { sensitivity: "base", numeric: true });
      });
  }, [assetColors, assets, failedAssets, hideUnreadable, query, selectedLibrary, similarColor, sortMode]);

  const markAssetFailed = useCallback((asset: VoxAsset, message: string) => {
    setFailedAssets((current) => {
      if (current.get(asset.thumbnailKey) === message) return current;
      const next = new Map(current);
      next.set(asset.thumbnailKey, message);
      return next;
    });
  }, []);

  const markAssetReady = useCallback((asset: VoxAsset) => {
    setFailedAssets((current) => {
      if (!current.has(asset.thumbnailKey)) return current;
      const next = new Map(current);
      next.delete(asset.thumbnailKey);
      return next;
    });
  }, []);

  const storeAssetMetadata = useCallback((asset: VoxAsset, metadata: AssetColorMetadata) => {
    setAssetColors((current) => {
      if (current.get(asset.thumbnailKey) === metadata) return current;
      const next = new Map(current);
      next.set(asset.thumbnailKey, metadata);
      return next;
    });
  }, []);

  const refreshLibraries = () => {
    setFailedAssets(new Map());
    void rescan();
  };

  const selectedName = selectedLibrary === "all"
    ? t("allModels")
    : libraries.find((library) => library.id === selectedLibrary)?.name ?? "Library";
  const pageCount = Math.max(1, Math.ceil(visibleAssets.length / PAGE_SIZE));
  const pageAssets = infiniteScroll ? visibleAssets.slice(0, displayCount) : visibleAssets.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  useEffect(() => {
    setPage(0);
    setDisplayCount(PAGE_SIZE);
  }, [query, selectedLibrary, similarColor, sortMode]);

  useEffect(() => {
    if (page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount]);

  useEffect(() => {
    if (!infiniteScroll || displayCount >= visibleAssets.length) return;
    const sentinel = loadMoreRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setDisplayCount((current) => Math.min(visibleAssets.length, current + PAGE_SIZE));
    }, { rootMargin: "300px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [displayCount, infiniteScroll, visibleAssets.length]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><CubeIcon /></span><span>Voxel <strong>Gallery</strong></span></div>
        <nav className="library-nav" aria-label={t("libraries")}>
          <p className="nav-label">{t("overview")}</p>
          <button className={`nav-item ${selectedLibrary === "all" ? "selected" : ""}`} type="button" onClick={() => setSelectedLibrary("all")}>
            <GridIcon /><span>{t("allModels")}</span><em>{assets.length}</em>
          </button>
          <p className="nav-label library-label">{t("libraries")}</p>
          {libraries.map((library) => (
            <div className={`library-row ${selectedLibrary === library.id ? "selected" : ""}`} key={library.id}>
              <button className="library-select" type="button" onClick={() => setSelectedLibrary(library.id)} title={library.path}>
                <span className="folder-dot" /><span>{library.name}</span><em>{counts.get(library.id) ?? 0}</em>
              </button>
              <button className="remove-library" type="button" onClick={() => removeLibrary(library.id)} aria-label={t("remove", { name: library.name })}><TrashIcon /></button>
            </div>
          ))}
          {!libraries.length && <p className="sidebar-empty">{t("noFolders")}</p>}
        </nav>
        <button className="add-library" type="button" onClick={() => void chooseFolders()}><FolderPlusIcon /> {t("addLibrary")}</button>
        <div className="drop-hint"><span>{t("dropFolder")}</span><small>{t("recursiveScan")}</small></div>
      </aside>

      <section className="content">
        <header className="topbar">
          <label className="search-box"><SearchIcon /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("search")} /></label>
          <div className="topbar-actions">
            <button className="ai-button" type="button" title={t("aiCreate")} onClick={() => setGeneratorOpen(true)}><WandIcon /> {t("aiCreate")}</button>
            <button className="landscape-button" type="button" title={t("landscapeTitle")} onClick={() => setLandscapeOpen(true)}><TreeIcon /> {t("landscapeCreate")}</button>
            <button className="tools-button" type="button" title="FileToVox & MeshToVox" onClick={() => setConvertersOpen(true)}><GridIcon /> {t("convert")}</button>
            <button className={`refresh-button ${isScanning ? "spinning" : ""}`} type="button" onClick={refreshLibraries} disabled={isScanning} title={t("refreshLibraries")}><RefreshIcon /></button>
            <button className="refresh-button" type="button" onClick={() => setSettingsOpen(true)} title={t("gallerySettings")}><SettingsIcon /></button>
          </div>
        </header>

        <main className="gallery-content">
          <div className="gallery-heading">
            <div><h1>{selectedName}</h1><p>{isScanning ? t("scanning") : `${visibleAssets.length} ${visibleAssets.length === 1 ? t("model") : t("models")}`}</p></div>
            <div className="sort-tools">
              {sortMode === "similarity" && <label className="color-sort" title={t("chooseSimilarColor")}><span>{t("referenceColor")}</span><input type="color" value={similarColor} onChange={(event) => setSimilarColor(event.target.value)} /><code>{similarColor.toUpperCase()}</code></label>}
              <label className="sort-select">{t("sort")}<select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}><option value="name">{t("sortName")}</option><option value="newest">{t("sortNewest")}</option><option value="largest">{t("sortLargest")}</option><option value="colors">{t("sortColors")}</option><option value="hue">{t("sortHue")}</option><option value="similarity">{t("sortSimilar")}</option></select></label>
            </div>
          </div>

          {errors.length > 0 && (
            <div className="scan-errors">{errors.map((error) => <p key={error.libraryId}>{t("libraryReadError", { message: error.message })}</p>)}</div>
          )}

          {visibleAssets.length ? (
            <>
              <div className="gallery-grid">{pageAssets.map((asset) => <VoxelCard key={asset.id} asset={asset} onOpen={setViewerAsset} knownError={failedAssets.get(asset.thumbnailKey)} onError={markAssetFailed} onReady={markAssetReady} metadata={assetColors.get(asset.thumbnailKey)} onMetadata={storeAssetMetadata} />)}</div>
              {infiniteScroll && <div className="infinite-sentinel" ref={loadMoreRef}>{displayCount < visibleAssets.length ? t("loadingMore") : t("shownOf", { shown: Math.min(displayCount, visibleAssets.length), total: visibleAssets.length })}</div>}
              {!infiniteScroll && pageCount > 1 && (
                <nav className="pagination" aria-label={t("galleryPages")}>
                  <button type="button" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>{t("previous")}</button>
                  <span>{t("pageOf", { page: page + 1, pages: pageCount })}<small>{t("rangeOf", { from: page * PAGE_SIZE + 1, to: Math.min((page + 1) * PAGE_SIZE, visibleAssets.length), total: visibleAssets.length })}</small></span>
                  <button type="button" disabled={page + 1 >= pageCount} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>{t("next")}</button>
                </nav>
              )}
            </>
          ) : (
            <div className="empty-state">
              <span className="empty-cube"><CubeIcon /></span>
              <h2>{libraries.length ? query ? t("noMatches") : t("noVox") : t("collectionStarts")}</h2>
              <p>{libraries.length ? query ? t("trySearch") : t("addFilesHint") : t("addFolderHint")}</p>
              {!libraries.length && <button type="button" onClick={() => void chooseFolders()}><FolderPlusIcon /> {t("firstFolder")}</button>}
            </div>
          )}
        </main>
      </section>

      {isDragOver && <div className="drop-overlay"><FolderPlusIcon /><strong>{t("dropAdd")}</strong><span>{t("releaseNow")}</span></div>}
      {notice && <div className="toast">{notice}</div>}
      {viewerAsset && <ViewerModal asset={viewerAsset} onClose={() => setViewerAsset(null)} />}
      {generatorOpen && <GeneratorModal libraries={libraries} onClose={() => setGeneratorOpen(false)} onSaved={(path) => { setGeneratorOpen(false); setNotice(t("saved", { path })); void rescan(); }} />}
      {landscapeOpen && <LandscapeModal libraries={libraries} onClose={() => setLandscapeOpen(false)} onSaved={(path) => { setLandscapeOpen(false); setNotice(t("saved", { path })); void rescan(); }} />}
      {convertersOpen && <ConvertersModal libraries={libraries} onClose={() => setConvertersOpen(false)} onConverted={(path) => { setNotice(t("converted", { path })); void rescan(); }} />}
      {settingsOpen && (
        <div className="preferences-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSettingsOpen(false)}>
          <section className="preferences-modal" role="dialog" aria-modal="true" aria-label={t("gallerySettings")}>
            <header><div><span>{t("settings")}</span><h2>Gallery</h2></div><button type="button" onClick={() => setSettingsOpen(false)} aria-label={t("close")}><CloseIcon /></button></header>
            <div className="preference-row">
              <div><strong>{t("hideUnreadable")}</strong><p>{t("hideUnreadableInfo")}</p></div>
              <button className={`toggle ${hideUnreadable ? "enabled" : ""}`} type="button" role="switch" aria-checked={hideUnreadable} onClick={() => setHideUnreadable((value) => !value)}><span /></button>
            </div>
            <div className="preference-row">
              <div><strong>{t("infiniteScroll")}</strong><p>{t("infiniteScrollInfo")}</p></div>
              <button className={`toggle ${infiniteScroll ? "enabled" : ""}`} type="button" role="switch" aria-checked={infiniteScroll} onClick={() => setInfiniteScroll((value) => !value)}><span /></button>
            </div>
            <div className="preference-row language-row">
              <div><strong>{t("language")}</strong><p>{t("languageInfo")}</p></div>
              <select value={language} onChange={(event) => setLanguage(event.target.value as "de" | "en")}><option value="de">{t("german")}</option><option value="en">{t("english")}</option></select>
            </div>
            <div className="preference-status">{t("unreadableStatus", { count: failedAssets.size, files: failedAssets.size === 1 ? t("file") : t("files") })}</div>
            <footer><button type="button" onClick={() => setSettingsOpen(false)}>{t("done")}</button></footer>
          </section>
        </div>
      )}
    </div>
  );
}
