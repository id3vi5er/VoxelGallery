import { useCallback, useEffect, useMemo, useState } from "react";
import type { LibraryFolder, Vector3Tuple, VoxSceneData } from "../types";
import type { GeneratedVoxelScene, LlmConfig, PromptOptions } from "../generator/types";
import { generateWithLlm } from "../generator/llm";
import { generateOffline } from "../generator/offline";
import { createGeneratedVoxFile, saveGeneratedVox } from "../generator/voxExport";
import { parseVox } from "../vox/parser";
import { CloseIcon, CubeIcon, SettingsIcon, WandIcon } from "./icons";
import { Viewer3D } from "./Viewer3D";
import { useI18n } from "../lib/i18n";

interface GeneratorModalProps {
  libraries: LibraryFolder[];
  onClose: () => void;
  onSaved: (path: string) => void;
}

const CONFIG_KEY = "voxel-gallery.generator-config.v1";
const defaultConfig: LlmConfig = {
  mode: "offline",
  endpoint: "http://localhost:11434/v1/chat/completions",
  model: "qwen2.5-coder:7b",
  apiKey: "",
  rememberKey: false,
};

const providers: Array<{ mode: LlmConfig["mode"]; label: string; detail: string; model: string; endpoint?: string }> = [
  { mode: "offline", label: "Demo", detail: "Offline", model: "" },
  { mode: "openai", label: "ChatGPT", detail: "OpenAI", model: "gpt-5.6-sol" },
  { mode: "anthropic", label: "Claude", detail: "Anthropic", model: "claude-sonnet-5" },
  { mode: "gemini", label: "Gemini", detail: "Google AI", model: "gemini-3.6-flash" },
  { mode: "compatible", label: "Eigener", detail: "Ollama / kompatibel", model: "qwen2.5-coder:7b", endpoint: "http://localhost:11434/v1/chat/completions" },
];

function loadConfig(): LlmConfig {
  try {
    const parsed = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "null") as Partial<LlmConfig> | null;
    if (!parsed) return defaultConfig;
    return { ...defaultConfig, ...parsed, apiKey: parsed.rememberKey ? parsed.apiKey ?? "" : "" };
  } catch { return defaultConfig; }
}

function persistConfig(config: LlmConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...config, apiKey: config.rememberKey ? config.apiKey : "" }));
}

export function GeneratorModal({ libraries, onClose, onSaved }: GeneratorModalProps) {
  const { locale, t } = useI18n();
  const [prompt, setPrompt] = useState(() => t("starterPrompt"));
  const [options, setOptions] = useState<PromptOptions>({ size: { x: 16, y: 16, z: 16 }, detail: "balanced", extraInstructions: "" });
  const [config, setConfig] = useState<LlmConfig>(loadConfig);
  const [scene, setScene] = useState<GeneratedVoxelScene | null>(null);
  const [preview, setPreview] = useState<VoxSceneData | null>(null);
  const [selectedLibrary, setSelectedLibrary] = useState(libraries[0]?.id ?? "");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [stats, setStats] = useState<{ voxels: number; dimensions: Vector3Tuple } | null>(null);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape" && !generating) onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [generating, onClose]);

  useEffect(() => {
    persistConfig(config);
  }, [config]);

  const updateSize = (axis: "x" | "y" | "z", value: string) => {
    const number = Math.max(1, Math.min(64, Number.parseInt(value, 10) || 1));
    setOptions((current) => ({ ...current, size: { ...current.size, [axis]: number } }));
  };

  const chooseProvider = (mode: LlmConfig["mode"]) => {
    const provider = providers.find((item) => item.mode === mode)!;
    setConfig((current) => ({ ...current, mode, model: provider.model, endpoint: provider.endpoint ?? current.endpoint, apiKey: "" }));
  };

  const generate = async () => {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setMessage(null);
    persistConfig(config);
    try {
      const result = config.mode === "offline"
        ? { scene: await generateOffline(prompt, options.size), duplicatesRemoved: 0 }
        : await generateWithLlm(prompt, config, options);
      const nextPreview = parseVox(createGeneratedVoxFile(result.scene));
      setScene(result.scene);
      setPreview(nextPreview);
      const duplicates = result.duplicatesRemoved ? t("duplicatesRemoved", { count: result.duplicatesRemoved }) : "";
      setMessage({ kind: "success", text: t("generatedCount", { count: result.scene.voxels.length.toLocaleString(locale), duplicates }) });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : t("generationFailed") });
    } finally { setGenerating(false); }
  };

  const save = async () => {
    const library = libraries.find((item) => item.id === selectedLibrary);
    if (!scene || !library || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const path = await saveGeneratedVox(scene, library.path);
      onSaved(path);
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : t("saveFailed") });
    } finally { setSaving(false); }
  };

  const onStats = useCallback((voxels: number, dimensions: Vector3Tuple) => setStats({ voxels, dimensions }), []);
  const provider = providers.find((item) => item.mode === config.mode);
  const providerLabel = provider?.mode === "compatible" ? t("customProvider") : provider?.label ?? "LLM";
  const palette = useMemo(() => scene?.palette ?? [], [scene]);

  return (
    <div className="generator-modal" role="dialog" aria-modal="true" aria-label={t("aiCreate")}>
      <header className="generator-header">
        <span className="generator-logo"><WandIcon /></span>
        <div><span>{t("aiWorkshop")}</span><h2>{t("newVoxelModel")}</h2></div>
        <div className="generator-provider"><SettingsIcon /><span><small>{t("generator")}</small>{providerLabel}{config.mode !== "offline" && ` · ${config.model}`}</span></div>
        <button type="button" onClick={onClose} disabled={generating} aria-label={t("closeGenerator")}><CloseIcon /></button>
      </header>

      <main className="generator-workspace">
        <aside className="generator-form">
          <label className="generator-label">{t("description")}</label>
          <textarea className="generator-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={1800} placeholder={t("describeModel")} />
          <div className="generator-ideas">
            <button type="button" onClick={() => setPrompt(t("scoutPrompt"))}>{t("scoutRobot")}</button>
            <button type="button" onClick={() => setPrompt(t("housePrompt"))}>{t("villageHouse")}</button>
          </div>

          <label className="generator-label">{t("modelSize")}</label>
          <div className="size-fields">{(["x", "y", "z"] as const).map((axis) => <label key={axis}><span>{axis.toUpperCase()}</span><input type="number" min="1" max="64" value={options.size[axis]} onChange={(event) => updateSize(axis, event.target.value)} /></label>)}</div>

          <label className="generator-label">{t("refinePrompt")}</label>
          <select className="generator-select" value={options.detail} onChange={(event) => setOptions((current) => ({ ...current, detail: event.target.value as PromptOptions["detail"] }))}>
            <option value="simple">{t("detailSimple")}</option>
            <option value="balanced">{t("detailBalanced")}</option>
            <option value="detailed">{t("detailDetailed")}</option>
          </select>
          <textarea className="extra-instructions" value={options.extraInstructions} onChange={(event) => setOptions((current) => ({ ...current, extraInstructions: event.target.value }))} placeholder={t("extraInstructions")} />

          <label className="generator-label">{t("modelProvider")}</label>
          <div className="provider-grid">{providers.map((provider) => <button type="button" key={provider.mode} className={config.mode === provider.mode ? "selected" : ""} onClick={() => chooseProvider(provider.mode)}><strong>{provider.mode === "compatible" ? t("customProvider") : provider.label}</strong><small>{provider.mode === "compatible" ? t("compatible") : provider.detail}</small></button>)}</div>
          {config.mode === "compatible" && <label className="generator-field">{t("endpoint")}<input value={config.endpoint} onChange={(event) => setConfig({ ...config, endpoint: event.target.value })} /></label>}
          {config.mode !== "offline" && <>
            <label className="generator-field">{t("model")}<input value={config.model} onChange={(event) => setConfig({ ...config, model: event.target.value })} /></label>
            <label className="generator-field">{t("apiKey")}<input type="password" value={config.apiKey} onChange={(event) => setConfig({ ...config, apiKey: event.target.value })} placeholder={config.mode === "compatible" ? t("optional") : t("apiKey")} /></label>
            <label className="remember-key"><input type="checkbox" checked={config.rememberKey} onChange={(event) => setConfig({ ...config, rememberKey: event.target.checked })} /><span>{t("rememberKey")}</span></label>
          </>}
          <button className="generate-action" type="button" onClick={() => void generate()} disabled={generating || !prompt.trim()}>{generating ? <span className="spinner" /> : <WandIcon />}{generating ? t("shapingVoxels") : t("generateModel")}</button>
          {message && <div className={`generator-message ${message.kind}`}>{message.text}</div>}
        </aside>

        <section className="generator-preview">
          {preview ? <Viewer3D data={preview} onStats={onStats} /> : <div className="generator-empty"><CubeIcon /><h3>{t("readyIdea")}</h3><p>{t("previewAppears")}</p></div>}
          {stats && <div className="generator-stats"><span>{stats.voxels.toLocaleString(locale)} {t("voxels")}</span><span>{stats.dimensions.join(" × ")}</span></div>}
        </section>

        <aside className="generator-inspector">
          <span className="generator-label">{t("currentModel")}</span>
          <h3>{scene?.name ?? t("notGenerated")}</h3>
          <p>{scene?.description ?? t("generateForDetails")}</p>
          <div className="generated-palette"><header><span>{t("palette")}</span><em>{palette.length} {t("colors")}</em></header>{palette.map((color, index) => <div key={`${color.hex}-${index}`}><i style={{ background: color.hex }} /><span><strong>{color.name}</strong><small>{color.hex}</small></span><em>#{index + 1}</em></div>)}</div>
        </aside>
      </main>

      <footer className="generator-footer">
        <div><label>{t("targetLibrary")}<select value={selectedLibrary} onChange={(event) => setSelectedLibrary(event.target.value)}><option value="">{t("chooseLibrary")}</option>{libraries.map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}</select></label></div>
        {!libraries.length && <p>{t("addLibraryFirst")}</p>}
        <button type="button" onClick={() => void save()} disabled={!scene || !selectedLibrary || saving}>{saving ? t("saving") : t("saveLibrary")}</button>
      </footer>
    </div>
  );
}
