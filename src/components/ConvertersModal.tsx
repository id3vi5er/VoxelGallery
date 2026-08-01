import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { LibraryFolder } from "../types";
import { CloseIcon, CubeIcon, ExternalIcon, FolderPlusIcon, GridIcon } from "./icons";
import { useI18n } from "../lib/i18n";

type ConverterKind = "file" | "mesh";

interface ConverterResult {
  outputPath: string;
  log: string;
}

interface Props {
  libraries: LibraryFolder[];
  initialTool?: ConverterKind;
  onClose: () => void;
  onConverted: (path: string) => void;
}

const FILE_TO_VOX_PATH_KEY = "voxel-gallery.file-to-vox-executable.v2";
const MESH_TO_VOX_PATH_KEY = "voxel-gallery.mesh-to-vox-path";
const supportedExtensions = ["asc", "binvox", "csv", "ply", "png", "qb", "schematic", "tif", "xyz", "vox"];

function fileExtension(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? "" : path.slice(dot + 1).toLowerCase();
}

function joinPath(folder: string, name: string): string {
  const separator = folder.includes("\\") ? "\\" : "/";
  return `${folder.replace(/[\\/]$/, "")}${separator}${name}`;
}

function safeOutputName(name: string): string {
  const stem = name.trim().replace(/\.vox$/i, "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/[. ]+$/g, "");
  return `${stem || "converted-model"}.vox`;
}

export function ConvertersModal({ libraries, initialTool = "file", onClose, onConverted }: Props) {
  const { t } = useI18n();
  const [tool, setTool] = useState<ConverterKind>(initialTool);
  const [fileToVoxPath, setFileToVoxPath] = useState(() => localStorage.getItem(FILE_TO_VOX_PATH_KEY) ?? "");
  const [meshToVoxPath, setMeshToVoxPath] = useState(() => localStorage.getItem(MESH_TO_VOX_PATH_KEY) ?? "");
  const [inputPaths, setInputPaths] = useState<string[]>([]);
  const [inputFolder, setInputFolder] = useState("");
  const [libraryId, setLibraryId] = useState(libraries[0]?.id ?? "");
  const [outputName, setOutputName] = useState("converted-model.vox");
  const [color, setColor] = useState(true);
  const [colorFromFile, setColorFromFile] = useState("");
  const [colorLimitEnabled, setColorLimitEnabled] = useState(false);
  const [colorLimit, setColorLimit] = useState(256);
  const [chunkSizeEnabled, setChunkSizeEnabled] = useState(false);
  const [chunkSize, setChunkSize] = useState(128);
  const [excavate, setExcavate] = useState(false);
  const [heightmapEnabled, setHeightmapEnabled] = useState(false);
  const [heightmap, setHeightmap] = useState(64);
  const [palette, setPalette] = useState("");
  const [gridSizeEnabled, setGridSizeEnabled] = useState(false);
  const [gridSize, setGridSize] = useState(10);
  const [debug, setDebug] = useState(false);
  const [disableQuantization, setDisableQuantization] = useState(false);
  const [running, setRunning] = useState(false);
  const [jobId, setJobId] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);
  const [log, setLog] = useState("");

  useEffect(() => {
    const discover = async (kind: "file-to-vox" | "mesh-to-vox", current: string, update: (path: string) => void) => {
      if (current) return;
      try {
        const found = await invoke<string | null>("discover_converter", { kind });
        if (found) update(found);
      } catch { /* A manual selection remains available. */ }
    };
    void discover("file-to-vox", fileToVoxPath, setFileToVoxPath);
    void discover("mesh-to-vox", meshToVoxPath, setMeshToVoxPath);
  }, [fileToVoxPath, meshToVoxPath]);

  useEffect(() => {
    if (fileToVoxPath) localStorage.setItem(FILE_TO_VOX_PATH_KEY, fileToVoxPath);
  }, [fileToVoxPath]);

  useEffect(() => {
    if (meshToVoxPath) localStorage.setItem(MESH_TO_VOX_PATH_KEY, meshToVoxPath);
  }, [meshToVoxPath]);

  const inputType = useMemo(() => {
    if (inputFolder || inputPaths.length > 1) return "layers";
    return inputPaths[0] ? fileExtension(inputPaths[0]) : "";
  }, [inputFolder, inputPaths]);
  const image = inputType === "png" || inputType === "tif";
  const layers = inputType === "layers";
  const pointCloud = ["csv", "ply", "xyz"].includes(inputType);
  const excavatable = image || layers || inputType === "schematic";
  const selectedLibrary = libraries.find((library) => library.id === libraryId);

  const chooseExecutable = async (kind: ConverterKind) => {
    const expected = kind === "file" ? "FileToVox.exe" : "MeshToVox.exe";
    const selection = await open({ multiple: false, directory: false, title: t("chooseExecutable", { name: expected }), filters: [{ name: expected, extensions: ["exe"] }] });
    if (typeof selection !== "string") return;
    if (!selection.toLowerCase().endsWith(expected.toLowerCase())) {
      setMessage({ type: "error", text: t("chooseFirst", { name: expected }) });
      return;
    }
    if (kind === "file") setFileToVoxPath(selection); else setMeshToVoxPath(selection);
  };

  const chooseInputFiles = async () => {
    const selection = await open({ multiple: true, directory: false, title: t("chooseInput"), filters: [{ name: "FileToVox", extensions: supportedExtensions }] });
    const paths = typeof selection === "string" ? [selection] : selection ?? [];
    if (!paths.length) return;
    setInputFolder("");
    setInputPaths(paths);
    const sourceName = paths[0].split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "");
    if (sourceName) setOutputName(safeOutputName(sourceName));
  };

  const chooseInputFolder = async () => {
    const selection = await open({ multiple: false, directory: true, title: t("choosePngFolder") });
    if (typeof selection !== "string") return;
    setInputPaths([]);
    setInputFolder(selection);
    const sourceName = selection.split(/[\\/]/).filter(Boolean).pop();
    if (sourceName) setOutputName(safeOutputName(sourceName));
  };

  const chooseImage = async (setter: (path: string) => void, title: string) => {
    const selection = await open({ multiple: false, directory: false, title, filters: [{ name: t("imageFiles"), extensions: ["png", "tif", "tiff", "bmp", "jpg", "jpeg"] }] });
    if (typeof selection === "string") setter(selection);
  };

  const startConversion = async () => {
    if (!fileToVoxPath) return setMessage({ type: "error", text: t("chooseFirst", { name: "FileToVox.exe" }) });
    if (!inputFolder && !inputPaths.length) return setMessage({ type: "error", text: t("chooseInputError") });
    if (!selectedLibrary) return setMessage({ type: "error", text: t("chooseLibraryError") });
    const nextJobId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    setJobId(nextJobId);
    setRunning(true);
    setLog("");
    setMessage({ type: "info", text: t("conversionRunning") });
    try {
      const result = await invoke<ConverterResult>("run_file_to_vox", {
        request: {
          jobId: nextJobId,
          executablePath: fileToVoxPath,
          inputPaths,
          inputFolder: inputFolder || null,
          outputPath: joinPath(selectedLibrary.path, safeOutputName(outputName)),
          color: image && color,
          colorFromFile: (image || layers) && colorFromFile ? colorFromFile : null,
          colorLimit: (image || layers || pointCloud) && colorLimitEnabled ? colorLimit : null,
          chunkSize: chunkSizeEnabled ? chunkSize : null,
          excavate: excavatable && excavate,
          heightmap: image && heightmapEnabled ? heightmap : null,
          palette: palette || null,
          gridSize: pointCloud && gridSizeEnabled ? gridSize : null,
          debug,
          disableQuantization: (image || layers || pointCloud) && disableQuantization,
        },
      });
      setLog(result.log);
      setMessage({ type: "success", text: t("conversionSuccess") });
      onConverted(result.outputPath);
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setRunning(false);
      setJobId("");
    }
  };

  const cancelConversion = async () => {
    if (!jobId) return;
    try {
      await invoke("cancel_file_to_vox", { jobId });
      setMessage({ type: "info", text: t("cancellationRequested") });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
    }
  };

  const launchMeshToVox = async () => {
    if (!meshToVoxPath) return setMessage({ type: "error", text: t("chooseFirst", { name: "MeshToVox.exe" }) });
    try {
      await invoke("launch_mesh_to_vox", { executable: meshToVoxPath });
      setMessage({ type: "success", text: t("meshStarted") });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <div className="converter-modal" role="dialog" aria-modal="true" aria-label={t("toolsDialog")}>
      <header className="converter-header">
        <span className="converter-logo"><GridIcon /></span>
        <div><span>Voxel Gallery</span><h2>{t("converterTools")}</h2></div>
        <nav><button className={tool === "file" ? "active" : ""} type="button" onClick={() => setTool("file")}>FileToVox</button><button className={tool === "mesh" ? "active" : ""} type="button" onClick={() => setTool("mesh")}>MeshToVox</button></nav>
        <button className="converter-close" type="button" onClick={onClose} aria-label={t("close")}><CloseIcon /></button>
      </header>

      {tool === "file" ? (
        <main className="converter-body">
          <section className="converter-column">
            <h3>{t("programInput")}</h3>
            <label className="path-picker"><span>FileToVox.exe</span><div><input value={fileToVoxPath} readOnly placeholder={t("chooseLocalInstall")} /><button type="button" onClick={() => void chooseExecutable("file")}>{t("choose")}</button></div></label>
            <div className="source-actions"><button type="button" onClick={() => void chooseInputFiles()}><CubeIcon /> {t("chooseFiles")}</button><button type="button" onClick={() => void chooseInputFolder()}><FolderPlusIcon /> {t("pngFolder")}</button></div>
            <div className="selected-source"><strong>{inputType ? inputType === "layers" ? t("pngLayers") : inputType.toUpperCase() : t("noInput")}</strong><span>{inputFolder || (inputPaths.length > 1 ? t("filesSelected", { count: inputPaths.length }) : inputPaths[0]) || "ASC, BINVOX, CSV, PLY, PNG, QB, SCHEMATIC, TIF, XYZ, VOX"}</span></div>

            <h3>{t("output")}</h3>
            <label className="converter-field"><span>Library</span><select value={libraryId} onChange={(event) => setLibraryId(event.target.value)}><option value="">{t("chooseLibrary")}</option>{libraries.map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}</select></label>
            <label className="converter-field"><span>{t("filename")}</span><input value={outputName} onChange={(event) => setOutputName(event.target.value)} onBlur={() => setOutputName(safeOutputName(outputName))} /></label>
          </section>

          <section className="converter-column options-column">
            <h3>{t("options")}</h3>
            <div className="option-group"><h4>{t("imageColor")}</h4>
              <OptionCheck label={t("originalColors")} checked={color} disabled={!image} onChange={setColor} />
              <NumberOption label={t("heightmap")} checked={heightmapEnabled} value={heightmap} min={1} max={1000} disabled={!image} onChecked={setHeightmapEnabled} onValue={setHeightmap} />
              <PathOption label={t("externalColorFile")} value={colorFromFile} disabled={!image && !layers} chooseLabel={t("choose")} removeLabel={t("remove", { name: t("externalColorFile") })} onChoose={() => void chooseImage(setColorFromFile, t("externalColorFile"))} onClear={() => setColorFromFile("")} />
            </div>
            <div className="option-group"><h4>{t("palette")}</h4>
              <NumberOption label={t("maximumColors")} checked={colorLimitEnabled} value={colorLimit} min={1} max={256} disabled={!image && !layers && !pointCloud} onChecked={setColorLimitEnabled} onValue={setColorLimit} />
              <PathOption label={t("paletteImage")} value={palette} chooseLabel={t("choose")} removeLabel={t("remove", { name: t("paletteImage") })} onChoose={() => void chooseImage(setPalette, t("paletteImage"))} onClear={() => setPalette("")} />
              <OptionCheck label={t("disableQuantization")} checked={disableQuantization} disabled={!image && !layers && !pointCloud} onChange={setDisableQuantization} />
            </div>
            <div className="option-group"><h4>{t("geometryProcessing")}</h4>
              <NumberOption label={t("gridSize")} checked={gridSizeEnabled} value={gridSize} min={10} max={2000} disabled={!pointCloud} onChecked={setGridSizeEnabled} onValue={setGridSize} />
              <NumberOption label={t("chunkSize")} checked={chunkSizeEnabled} value={chunkSize} min={11} max={256} onChecked={setChunkSizeEnabled} onValue={setChunkSize} />
              <OptionCheck label={t("exteriorOnly")} checked={excavate} disabled={!excavatable} onChange={setExcavate} />
              <OptionCheck label={t("debugValidation")} checked={debug} onChange={setDebug} />
            </div>
          </section>

          <aside className="converter-run-panel">
            <span className="large-tool-icon"><CubeIcon /></span><h3>FileToVox 1.16</h3><p>{t("fileToVoxInfo")}</p>
            {message && <div className={`converter-message ${message.type}`}>{message.text}</div>}
            {log && <details><summary>{t("conversionLog")}</summary><pre>{log}</pre></details>}
            {running ? <button className="cancel-conversion" type="button" onClick={() => void cancelConversion()}>{t("cancelConversion")}</button> : <button className="start-conversion" type="button" onClick={() => void startConversion()}>{t("convertToVox")}</button>}
          </aside>
        </main>
      ) : (
        <main className="mesh-tool-body">
          <span className="large-tool-icon"><CubeIcon /></span><span className="eyebrow">{t("externalOriginalUi")}</span><h2>MeshToVox 2.9</h2><p>{t("meshInfo")}</p>
          <label className="path-picker mesh-path"><span>MeshToVox.exe</span><div><input value={meshToVoxPath} readOnly placeholder={t("chooseLocalInstall")} /><button type="button" onClick={() => void chooseExecutable("mesh")}>{t("choose")}</button></div></label>
          <div className="mesh-library"><label className="converter-field"><span>{t("targetLibraryHelp")}</span><select value={libraryId} onChange={(event) => setLibraryId(event.target.value)}><option value="">{t("chooseLibrary")}</option>{libraries.map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}</select></label><button type="button" disabled={!selectedLibrary} onClick={() => selectedLibrary && void invoke("reveal_in_explorer", { path: selectedLibrary.path })}><ExternalIcon /> {t("openFolder")}</button></div>
          {message && <div className={`converter-message ${message.type}`}>{message.text}</div>}
          <button className="start-conversion mesh-launch" type="button" onClick={() => void launchMeshToVox()}><ExternalIcon /> {t("launchMesh")}</button>
          <small>{t("meshLocalOnly")}</small>
        </main>
      )}
    </div>
  );
}

function OptionCheck({ label, checked, disabled = false, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return <label className={`converter-check ${disabled ? "disabled" : ""}`}><input type="checkbox" checked={checked && !disabled} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>;
}

function NumberOption({ label, checked, value, min, max, disabled = false, onChecked, onValue }: { label: string; checked: boolean; value: number; min: number; max: number; disabled?: boolean; onChecked: (value: boolean) => void; onValue: (value: number) => void }) {
  return <div className={`number-option ${disabled ? "disabled" : ""}`}><label><input type="checkbox" checked={checked && !disabled} disabled={disabled} onChange={(event) => onChecked(event.target.checked)} /><span>{label}</span></label><input type="number" value={value} min={min} max={max} disabled={disabled || !checked} onChange={(event) => onValue(Number(event.target.value))} /></div>;
}

function PathOption({ label, value, chooseLabel, removeLabel, disabled = false, onChoose, onClear }: { label: string; value: string; chooseLabel: string; removeLabel: string; disabled?: boolean; onChoose: () => void; onClear: () => void }) {
  return <div className={`compact-path ${disabled ? "disabled" : ""}`}><span>{label}</span><div><button type="button" disabled={disabled} onClick={onChoose}>{value ? value.split(/[\\/]/).pop() : `${chooseLabel} …`}</button>{value && <button type="button" disabled={disabled} onClick={onClear} aria-label={removeLabel}><CloseIcon /></button>}</div></div>;
}
