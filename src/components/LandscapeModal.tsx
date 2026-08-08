import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LibraryFolder, Vector3Tuple } from "../types";
import { createGeneratedVoxFile, saveGeneratedVox } from "../generator/voxExport";
import {
  DEFAULT_LANDSCAPE_SETTINGS,
  LANDSCAPE_LIMITS,
  LANDSCAPE_PRESETS,
  MAX_AXIS,
  MAX_SAVE_VOXELS,
  METERS_PER_VOXEL_STEPS,
  MIN_AXIS,
  clampLandscapeSettings,
  generateLandscapeAsync,
  randomSeedText,
  scaleMetricLengths,
} from "../generator/landscape";
import type {
  LandscapeResult,
  LandscapeSettings,
  Limit,
  ScatterSettings,
  Season,
  TerrainAlgorithm,
  TerrainSettings,
  TreeAlgorithm,
  TreeSettings,
} from "../generator/landscape";
import { CloseIcon, CubeIcon, DiceIcon, ResetIcon, TreeIcon } from "./icons";
import { Viewer3D } from "./Viewer3D";
import { useI18n } from "../lib/i18n";

interface LandscapeModalProps {
  libraries: LibraryFolder[];
  onClose: () => void;
  onSaved: (path: string) => void;
}

const SETTINGS_KEY = "voxel-gallery.landscape-settings.v1";
/** Above this volume the auto preview stops recomputing on every slider move. */
const AUTO_PREVIEW_VOLUME = 1_600_000;

const TERRAIN_ALGORITHMS: Array<{ value: TerrainAlgorithm; labelKey: string }> = [
  { value: "hills", labelKey: "terrainHills" },
  { value: "mountains", labelKey: "terrainMountains" },
  { value: "plains", labelKey: "terrainPlains" },
  { value: "islands", labelKey: "terrainIslands" },
  { value: "canyon", labelKey: "terrainCanyon" },
  { value: "dunes", labelKey: "terrainDunes" },
];

const TREE_ALGORITHMS: Array<{ value: TreeAlgorithm; labelKey: string }> = [
  { value: "mixed", labelKey: "treeMixed" },
  { value: "recursive", labelKey: "treeRecursive" },
  { value: "lsystem", labelKey: "treeLsystem" },
  { value: "conifer", labelKey: "treeConifer" },
  { value: "palm", labelKey: "treePalm" },
  { value: "dead", labelKey: "treeDead" },
];

const SEASONS: Array<{ value: Season; labelKey: string }> = [
  { value: "spring", labelKey: "seasonSpring" },
  { value: "summer", labelKey: "seasonSummer" },
  { value: "autumn", labelKey: "seasonAutumn" },
  { value: "winter", labelKey: "seasonWinter" },
];

function loadSettings(): LandscapeSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") as LandscapeSettings | null;
    if (!stored) return DEFAULT_LANDSCAPE_SETTINGS;
    return clampLandscapeSettings({
      ...DEFAULT_LANDSCAPE_SETTINGS,
      ...stored,
      size: { ...DEFAULT_LANDSCAPE_SETTINGS.size, ...stored.size },
      terrain: { ...DEFAULT_LANDSCAPE_SETTINGS.terrain, ...stored.terrain },
      water: { ...DEFAULT_LANDSCAPE_SETTINGS.water, ...stored.water },
      trees: { ...DEFAULT_LANDSCAPE_SETTINGS.trees, ...stored.trees },
      scatter: { ...DEFAULT_LANDSCAPE_SETTINGS.scatter, ...stored.scatter },
    });
  } catch {
    return DEFAULT_LANDSCAPE_SETTINGS;
  }
}

interface SliderProps {
  label: string;
  value: number;
  limit: Limit;
  onChange: (value: number) => void;
  display?: string;
}

function Slider({ label, value, limit, onChange, display }: SliderProps) {
  const decimals = limit.step < 1 ? String(limit.step).split(".")[1]?.length ?? 2 : 0;
  return (
    <label className="landscape-slider">
      <span>{label}<em>{display ?? value.toFixed(decimals)}</em></span>
      <input
        type="range"
        min={limit.min}
        max={limit.max}
        step={limit.step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function LandscapeModal({ libraries, onClose, onSaved }: LandscapeModalProps) {
  const { locale, t } = useI18n();
  const [settings, setSettings] = useState<LandscapeSettings>(loadSettings);
  const [autoPreview, setAutoPreview] = useState(() => localStorage.getItem("voxel-gallery.landscape-auto") !== "false");
  const [scaleLengths, setScaleLengths] = useState(() => localStorage.getItem("voxel-gallery.landscape-link") !== "false");
  const [result, setResult] = useState<LandscapeResult | null>(null);
  const [preview, setPreview] = useState<Uint8Array | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedLibrary, setSelectedLibrary] = useState(libraries[0]?.id ?? "");
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [dimensions, setDimensions] = useState<Vector3Tuple | null>(null);
  const runIdRef = useRef(0);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape" && !generating) onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [generating, onClose]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem("voxel-gallery.landscape-auto", String(autoPreview));
  }, [autoPreview]);

  useEffect(() => {
    localStorage.setItem("voxel-gallery.landscape-link", String(scaleLengths));
  }, [scaleLengths]);

  /**
   * A finer voxel covers less world, so keeping the real world sizes would push hills
   * and trees far beyond what the map can show. Linked, the lengths shrink along with
   * the voxel and the landscape simply means something smaller.
   */
  const changeScale = useCallback((next: number) => {
    setSettings((current) => {
      const rescaled = scaleLengths
        ? scaleMetricLengths(current, next / current.metersPerVoxel)
        : current;
      return clampLandscapeSettings({ ...rescaled, metersPerVoxel: next });
    });
  }, [scaleLengths]);

  const generate = useCallback(async (next: LandscapeSettings) => {
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    setGenerating(true);
    setMessage(null);
    try {
      const generated = await generateLandscapeAsync(next);
      if (runIdRef.current !== runId) return;
      setResult(generated);
      setPreview(createGeneratedVoxFile(generated.scene));
      setMessage({
        kind: "success",
        text: t("lsGenerated", {
          voxels: generated.stats.voxels.toLocaleString(locale),
          trees: generated.stats.trees.toLocaleString(locale),
          ms: generated.stats.durationMs,
        }),
      });
    } catch (error) {
      if (runIdRef.current !== runId) return;
      setPreview(null);
      setMessage({ kind: "error", text: error instanceof Error ? error.message : t("generationFailed") });
    } finally {
      if (runIdRef.current === runId) setGenerating(false);
    }
  }, [locale, t]);

  const volume = settings.size.x * settings.size.y * settings.size.z;
  const autoAllowed = autoPreview && volume <= AUTO_PREVIEW_VOLUME;

  useEffect(() => {
    if (!autoAllowed) return;
    const timeout = window.setTimeout(() => void generate(settings), 350);
    return () => window.clearTimeout(timeout);
  }, [autoAllowed, generate, settings]);

  const update = useCallback((patch: Partial<LandscapeSettings>) => {
    setSettings((current) => clampLandscapeSettings({ ...current, ...patch }));
  }, []);
  const updateTerrain = useCallback((patch: Partial<TerrainSettings>) => {
    setSettings((current) => clampLandscapeSettings({ ...current, terrain: { ...current.terrain, ...patch } }));
  }, []);
  const updateTrees = useCallback((patch: Partial<TreeSettings>) => {
    setSettings((current) => clampLandscapeSettings({ ...current, trees: { ...current.trees, ...patch } }));
  }, []);
  const updateScatter = useCallback((patch: Partial<ScatterSettings>) => {
    setSettings((current) => clampLandscapeSettings({ ...current, scatter: { ...current.scatter, ...patch } }));
  }, []);

  const updateSize = (axis: "x" | "y" | "z", raw: string) => {
    const value = Math.max(MIN_AXIS, Math.min(MAX_AXIS, Number.parseInt(raw, 10) || MIN_AXIS));
    setSettings((current) => clampLandscapeSettings({ ...current, size: { ...current.size, [axis]: value } }));
  };

  const save = async () => {
    const library = libraries.find((item) => item.id === selectedLibrary);
    if (!result || !library || saving) return;
    if (result.stats.voxels > MAX_SAVE_VOXELS) {
      setMessage({ kind: "error", text: t("lsTooManyVoxels", { count: result.stats.voxels.toLocaleString(locale), max: MAX_SAVE_VOXELS.toLocaleString(locale) }) });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const path = await saveGeneratedVox(result.scene, library.path);
      onSaved(path);
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : t("saveFailed") });
    } finally {
      setSaving(false);
    }
  };

  const onStats = useCallback((_voxels: number, size: Vector3Tuple) => setDimensions(size), []);
  const limits = LANDSCAPE_LIMITS;
  const stats = result?.stats;
  const perVoxel = settings.metersPerVoxel;
  const metres = (value: number) => `${Number((value).toFixed(2))} m`;
  /** Shows a metric length together with the voxel count it turns into. */
  const metric = (value: number) => `${metres(value)} · ${Math.max(1, Math.round(value / perVoxel))} vx`;
  const palette = useMemo(() => result?.scene.palette ?? [], [result]);
  const tooManyVoxels = Boolean(stats && stats.voxels > MAX_SAVE_VOXELS);
  // A tree height in metres turns into many voxels at a fine scale. Warn before the
  // model height silently cuts every tree down, instead of leaving the map bare.
  const treeVoxelHeight = settings.trees.minHeight / perVoxel;
  const treesTooTall = settings.trees.enabled && treeVoxelHeight > settings.size.z * 0.6;
  const neededZ = Math.min(MAX_AXIS, Math.ceil((treeVoxelHeight / 0.6) / 8) * 8);
  // One hill wider than the whole map leaves nothing but a single smooth ramp.
  const featureTooWide = settings.terrain.scale > Math.min(settings.size.x, settings.size.y) * perVoxel;
  const percent = (value: number) => `${Math.round(value * 100)} %`;

  return (
    <div className="generator-modal landscape-modal" role="dialog" aria-modal="true" aria-label={t("landscapeCreate")}>
      <header className="generator-header">
        <span className="generator-logo landscape-logo"><TreeIcon /></span>
        <div><span>{t("landscapeStudio")}</span><h2>{t("landscapeTitle")}</h2></div>
        <div className="generator-provider">
          <TreeIcon />
          <span><small>{t("lsAlgorithm")}</small>{t(TERRAIN_ALGORITHMS.find((item) => item.value === settings.terrain.algorithm)?.labelKey ?? "terrainHills")}</span>
        </div>
        <button type="button" onClick={onClose} disabled={generating} aria-label={t("close")}><CloseIcon /></button>
      </header>

      <main className="generator-workspace">
        <aside className="generator-form landscape-form">
          <label className="generator-label">{t("lsPresets")}</label>
          <div className="landscape-presets">
            {LANDSCAPE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setSettings({ ...preset.settings, seed: randomSeedText() })}
              >{t(preset.labelKey)}</button>
            ))}
          </div>

          <label className="generator-label">{t("lsSeed")}</label>
          <div className="landscape-seed">
            <input value={settings.seed} maxLength={64} onChange={(event) => update({ seed: event.target.value })} />
            <button type="button" onClick={() => update({ seed: randomSeedText() })} title={t("lsReroll")}><DiceIcon /></button>
            <button type="button" onClick={() => setSettings(DEFAULT_LANDSCAPE_SETTINGS)} title={t("lsResetDefaults")}><ResetIcon /></button>
          </div>

          <label className="generator-label">{t("lsSize")}</label>
          <div className="size-fields">
            {(["x", "y", "z"] as const).map((axis) => (
              <label key={axis}>
                <span>{axis.toUpperCase()}</span>
                <input type="number" min={MIN_AXIS} max={MAX_AXIS} value={settings.size[axis]} onChange={(event) => updateSize(axis, event.target.value)} />
              </label>
            ))}
          </div>

          <label className="generator-label">{t("lsScaleLabel")}</label>
          <select
            className="generator-select"
            value={String(settings.metersPerVoxel)}
            onChange={(event) => changeScale(Number(event.target.value))}
          >
            {METERS_PER_VOXEL_STEPS.map((step) => (
              <option key={step} value={String(step)}>{t("lsScaleOption", { meters: step })}</option>
            ))}
          </select>
          <label className="landscape-check">
            <input type="checkbox" checked={scaleLengths} onChange={(event) => setScaleLengths(event.target.checked)} />
            <span>{t("lsScaleLinked")}</span>
          </label>
          <p className="landscape-extent">
            {t("lsExtent", {
              x: Number((settings.size.x * perVoxel).toFixed(1)),
              y: Number((settings.size.y * perVoxel).toFixed(1)),
              z: Number((settings.size.z * perVoxel).toFixed(1)),
            })}
          </p>
          {featureTooWide && (
            <p className="landscape-hint">
              {t("lsFeatureTooWide", {
                feature: Number(settings.terrain.scale.toFixed(1)),
                world: Number((Math.min(settings.size.x, settings.size.y) * perVoxel).toFixed(1)),
              })}
            </p>
          )}

          <details className="landscape-group" open>
            <summary>{t("lsTerrain")}</summary>
            <select
              className="generator-select"
              value={settings.terrain.algorithm}
              onChange={(event) => updateTerrain({ algorithm: event.target.value as TerrainAlgorithm })}
            >
              {TERRAIN_ALGORITHMS.map((item) => <option key={item.value} value={item.value}>{t(item.labelKey)}</option>)}
            </select>
            <Slider label={t("lsScale")} value={settings.terrain.scale} limit={limits.scale} onChange={(scale) => updateTerrain({ scale })} display={metric(settings.terrain.scale)} />
            <Slider label={t("lsAmplitude")} value={settings.terrain.amplitude} limit={limits.amplitude} onChange={(amplitude) => updateTerrain({ amplitude })} display={percent(settings.terrain.amplitude)} />
            <Slider label={t("lsBaseHeight")} value={settings.terrain.baseHeight} limit={limits.baseHeight} onChange={(baseHeight) => updateTerrain({ baseHeight })} display={percent(settings.terrain.baseHeight)} />
            <Slider label={t("lsOctaves")} value={settings.terrain.octaves} limit={limits.octaves} onChange={(octaves) => updateTerrain({ octaves })} />
            <Slider label={t("lsPersistence")} value={settings.terrain.persistence} limit={limits.persistence} onChange={(persistence) => updateTerrain({ persistence })} />
            <Slider label={t("lsLacunarity")} value={settings.terrain.lacunarity} limit={limits.lacunarity} onChange={(lacunarity) => updateTerrain({ lacunarity })} />
            <Slider label={t("lsExponent")} value={settings.terrain.exponent} limit={limits.exponent} onChange={(exponent) => updateTerrain({ exponent })} />
            <Slider label={t("lsWarp")} value={settings.terrain.warp} limit={limits.warp} onChange={(warp) => updateTerrain({ warp })} />
            <Slider label={t("lsTerraces")} value={settings.terrain.terraces} limit={limits.terraces} onChange={(terraces) => updateTerrain({ terraces })} display={settings.terrain.terraces < 2 ? t("lsOff") : String(settings.terrain.terraces)} />
            <Slider label={t("lsErosion")} value={settings.terrain.erosion} limit={limits.erosion} onChange={(erosion) => updateTerrain({ erosion })} />
            <Slider label={t("lsCrust")} value={settings.terrain.crustDepth} limit={limits.crustDepth} onChange={(crustDepth) => updateTerrain({ crustDepth })} display={settings.terrain.crustDepth === 0 ? t("lsCrustSolid") : metric(settings.terrain.crustDepth)} />
          </details>

          <details className="landscape-group" open>
            <summary>{t("lsWater")}</summary>
            <label className="landscape-check">
              <input type="checkbox" checked={settings.water.enabled} onChange={(event) => update({ water: { ...settings.water, enabled: event.target.checked } })} />
              <span>{t("lsWaterEnabled")}</span>
            </label>
            <Slider label={t("lsWaterLevel")} value={settings.water.level} limit={limits.waterLevel} onChange={(level) => update({ water: { ...settings.water, level } })} display={percent(settings.water.level)} />
            <Slider label={t("lsBeach")} value={settings.water.beach} limit={limits.beach} onChange={(beach) => update({ water: { ...settings.water, beach } })} display={metric(settings.water.beach)} />
          </details>

          <details className="landscape-group" open>
            <summary>{t("lsTrees")}</summary>
            <label className="landscape-check">
              <input type="checkbox" checked={settings.trees.enabled} onChange={(event) => updateTrees({ enabled: event.target.checked })} />
              <span>{t("lsTreesEnabled")}</span>
            </label>
            <select
              className="generator-select"
              value={settings.trees.algorithm}
              onChange={(event) => updateTrees({ algorithm: event.target.value as TreeAlgorithm })}
            >
              {TREE_ALGORITHMS.map((item) => <option key={item.value} value={item.value}>{t(item.labelKey)}</option>)}
            </select>
            <Slider
              label={t("lsDensity")}
              value={settings.trees.density}
              limit={limits.density}
              onChange={(density) => updateTrees({ density })}
              display={t("lsSpacing", { meters: Number((17 - settings.trees.density * 14).toFixed(1)) })}
            />
            <Slider label={t("lsMinHeight")} value={settings.trees.minHeight} limit={limits.treeHeight} onChange={(minHeight) => updateTrees({ minHeight })} display={metric(settings.trees.minHeight)} />
            <Slider label={t("lsMaxHeight")} value={settings.trees.maxHeight} limit={limits.treeHeight} onChange={(maxHeight) => updateTrees({ maxHeight })} display={metric(settings.trees.maxHeight)} />
            <Slider label={t("lsIterations")} value={settings.trees.iterations} limit={limits.iterations} onChange={(iterations) => updateTrees({ iterations })} />
            <Slider label={t("lsBranchAngle")} value={settings.trees.branchAngle} limit={limits.branchAngle} onChange={(branchAngle) => updateTrees({ branchAngle })} display={`${Math.round(settings.trees.branchAngle)}°`} />
            <Slider label={t("lsBranchSplit")} value={settings.trees.branchSplit} limit={limits.branchSplit} onChange={(branchSplit) => updateTrees({ branchSplit })} />
            <Slider label={t("lsLengthFalloff")} value={settings.trees.lengthFalloff} limit={limits.lengthFalloff} onChange={(lengthFalloff) => updateTrees({ lengthFalloff })} />
            <Slider label={t("lsTrunkThickness")} value={settings.trees.trunkThickness} limit={limits.trunkThickness} onChange={(trunkThickness) => updateTrees({ trunkThickness })} display={metres(settings.trees.trunkThickness)} />
            <Slider label={t("lsCrownRadius")} value={settings.trees.crownRadius} limit={limits.crownRadius} onChange={(crownRadius) => updateTrees({ crownRadius })} display={metric(settings.trees.crownRadius)} />
            <Slider label={t("lsLeafDensity")} value={settings.trees.leafDensity} limit={limits.leafDensity} onChange={(leafDensity) => updateTrees({ leafDensity })} display={percent(settings.trees.leafDensity)} />
            <Slider label={t("lsSlopeLimit")} value={settings.trees.slopeLimit} limit={limits.slopeLimit} onChange={(slopeLimit) => updateTrees({ slopeLimit })} display={percent(settings.trees.slopeLimit)} />
            <Slider label={t("lsTreeLine")} value={settings.trees.treeLine} limit={limits.treeLine} onChange={(treeLine) => updateTrees({ treeLine })} display={percent(settings.trees.treeLine)} />
            <Slider label={t("lsJitter")} value={settings.trees.jitter} limit={limits.jitter} onChange={(jitter) => updateTrees({ jitter })} display={percent(settings.trees.jitter)} />
          </details>

          <details className="landscape-group">
            <summary>{t("lsDetails")}</summary>
            <Slider label={t("lsRocks")} value={settings.scatter.rocks} limit={limits.scatter} onChange={(rocks) => updateScatter({ rocks })} display={percent(settings.scatter.rocks)} />
            <Slider label={t("lsGrass")} value={settings.scatter.grass} limit={limits.scatter} onChange={(grass) => updateScatter({ grass })} display={percent(settings.scatter.grass)} />
            <Slider label={t("lsFlowers")} value={settings.scatter.flowers} limit={limits.scatter} onChange={(flowers) => updateScatter({ flowers })} display={percent(settings.scatter.flowers)} />
          </details>

          <details className="landscape-group">
            <summary>{t("lsClimate")}</summary>
            <select className="generator-select" value={settings.season} onChange={(event) => update({ season: event.target.value as Season })}>
              {SEASONS.map((item) => <option key={item.value} value={item.value}>{t(item.labelKey)}</option>)}
            </select>
            <Slider label={t("lsSnowLine")} value={settings.snowLine} limit={limits.snowLine} onChange={(snowLine) => update({ snowLine })} display={percent(settings.snowLine)} />
          </details>

          <label className="landscape-check auto-preview">
            <input type="checkbox" checked={autoPreview} onChange={(event) => setAutoPreview(event.target.checked)} />
            <span>{t("lsAutoPreview")}</span>
          </label>
          {autoPreview && volume > AUTO_PREVIEW_VOLUME && <p className="landscape-hint">{t("lsAutoPaused")}</p>}
          {treesTooTall && (
            <p className="landscape-hint">
              {t("lsTreesTooTall", {
                meters: Number(settings.trees.minHeight.toFixed(1)),
                voxels: Math.round(treeVoxelHeight),
                z: settings.size.z,
                needed: neededZ,
              })}
            </p>
          )}

          <button className="generate-action" type="button" onClick={() => void generate(settings)} disabled={generating}>
            {generating ? <span className="spinner" /> : <TreeIcon />}
            {generating ? t("lsGenerating") : t("lsGenerate")}
          </button>
          {message && <div className={`generator-message ${message.kind}`}>{message.text}</div>}
        </aside>

        <section className="generator-preview">
          {preview ? <Viewer3D bytes={preview} onStats={onStats} /> : (
            <div className="generator-empty">
              <CubeIcon />
              <h3>{stats ? t("lsPreviewOff") : t("lsEmptyTitle")}</h3>
              <p>{stats ? t("lsPreviewTooBig", { faces: stats.surfaceFaces.toLocaleString(locale) }) : t("lsEmptyText")}</p>
            </div>
          )}
          {stats && (
            <div className="generator-stats">
              <span>{stats.voxels.toLocaleString(locale)} {t("voxels")}</span>
              <span>{stats.trees.toLocaleString(locale)} {t("lsTrees")}</span>
              <span>{(dimensions ?? [settings.size.x, settings.size.y, settings.size.z]).join(" × ")}</span>
              <span>{stats.durationMs} ms</span>
            </div>
          )}
        </section>

        <aside className="generator-inspector">
          <span className="generator-label">{t("lsStats")}</span>
          <h3>{result?.scene.name ?? t("notGenerated")}</h3>
          {stats ? (
            <dl className="landscape-stats">
              <div><dt>{t("lsStatArea")}</dt><dd>{stats.extent.x} × {stats.extent.y} × {stats.extent.z} m</dd></div>
              <div><dt>{t("lsStatScale")}</dt><dd>{stats.metersPerVoxel} m/vx</dd></div>
              <div><dt>{t("lsStatTerrain")}</dt><dd>{stats.terrainVoxels.toLocaleString(locale)}</dd></div>
              <div><dt>{t("lsStatWater")}</dt><dd>{stats.waterVoxels.toLocaleString(locale)}</dd></div>
              <div><dt>{t("lsStatTreeVoxels")}</dt><dd>{stats.treeVoxels.toLocaleString(locale)}</dd></div>
              <div><dt>{t("lsStatScatter")}</dt><dd>{stats.scatterVoxels.toLocaleString(locale)}</dd></div>
              {(stats.treesShortened > 0 || stats.treesSkipped > 0) && (
                <div><dt>{t("lsStatTreesCut")}</dt><dd>{stats.treesShortened.toLocaleString(locale)} / {stats.treesSkipped.toLocaleString(locale)}</dd></div>
              )}
              <div><dt>{t("lsStatFaces")}</dt><dd>{stats.surfaceFaces.toLocaleString(locale)}</dd></div>
              <div><dt>{t("lsStatFile")}</dt><dd>{(stats.fileBytes / 1024 / 1024).toFixed(2)} MB</dd></div>
            </dl>
          ) : <p>{t("lsEmptyText")}</p>}
          {tooManyVoxels && <div className="generator-message error">{t("lsTooManyVoxels", { count: stats!.voxels.toLocaleString(locale), max: MAX_SAVE_VOXELS.toLocaleString(locale) })}</div>}
          <div className="generated-palette">
            <header><span>{t("palette")}</span><em>{palette.length} {t("colors")}</em></header>
            {palette.map((color, index) => (
              <div key={`${color.hex}-${index}`}>
                <i style={{ background: color.hex }} />
                <span><strong>{color.name}</strong><small>{color.hex}</small></span>
                <em>#{index + 1}</em>
              </div>
            ))}
          </div>
        </aside>
      </main>

      <footer className="generator-footer">
        <div>
          <label>{t("targetLibrary")}
            <select value={selectedLibrary} onChange={(event) => setSelectedLibrary(event.target.value)}>
              <option value="">{t("chooseLibrary")}</option>
              {libraries.map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}
            </select>
          </label>
        </div>
        {!libraries.length && <p>{t("addLibraryFirst")}</p>}
        <button type="button" onClick={() => void save()} disabled={!result || !selectedLibrary || saving || tooManyVoxels}>
          {saving ? t("saving") : t("saveLibrary")}
        </button>
      </footer>
    </div>
  );
}
