use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, UNIX_EPOCH},
};
use tauri::{Manager, State};
use walkdir::WalkDir;

const MAX_VOX_FILE_SIZE: u64 = 512 * 1024 * 1024;
const MAX_LLM_RESPONSE_SIZE: usize = 32 * 1024 * 1024;

#[derive(Default)]
struct ConverterJobs(Arc<Mutex<HashMap<String, PathBuf>>>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct VoxFileEntry {
    path: String,
    name: String,
    relative_path: String,
    size: u64,
    modified_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LlmHttpRequest {
    url: String,
    headers: HashMap<String, String>,
    body: String,
}

#[derive(Debug, Serialize)]
struct LlmHttpResponse {
    status: u16,
    body: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileToVoxRequest {
    job_id: String,
    executable_path: String,
    input_paths: Vec<String>,
    input_folder: Option<String>,
    output_path: String,
    color: bool,
    color_from_file: Option<String>,
    color_limit: Option<u16>,
    chunk_size: Option<u16>,
    excavate: bool,
    heightmap: Option<u16>,
    palette: Option<String>,
    grid_size: Option<f64>,
    debug: bool,
    disable_quantization: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConverterResult {
    output_path: String,
    log: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerRequest {
    executable_path: String,
    arguments: Vec<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerResult {
    exit_code: i32,
    cancelled: bool,
    error: Option<String>,
}

fn canonical_directory(path: &str) -> Result<PathBuf, String> {
    let canonical =
        fs::canonicalize(path).map_err(|error| format!("Ordner nicht gefunden: {error}"))?;
    if !canonical.is_dir() {
        return Err("Der ausgewählte Pfad ist kein Ordner.".to_string());
    }
    Ok(canonical)
}

fn is_vox_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("vox"))
}

#[tauri::command]
fn scan_library(path: String) -> Result<Vec<VoxFileEntry>, String> {
    let root = canonical_directory(&path)?;
    let mut entries = Vec::new();

    for entry in WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        let file_path = entry.path();
        if !entry.file_type().is_file() || !is_vox_file(file_path) {
            continue;
        }

        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let modified_ms = metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .map(|value| value.as_millis() as u64)
            .unwrap_or_default();
        let relative_path = file_path
            .strip_prefix(&root)
            .unwrap_or(file_path)
            .to_string_lossy()
            .to_string();

        entries.push(VoxFileEntry {
            path: file_path.to_string_lossy().to_string(),
            name: entry.file_name().to_string_lossy().to_string(),
            relative_path,
            size: metadata.len(),
            modified_ms,
        });
    }

    entries.sort_by(|a, b| {
        a.relative_path
            .to_lowercase()
            .cmp(&b.relative_path.to_lowercase())
    });
    Ok(entries)
}

#[tauri::command]
fn read_vox(path: String) -> Result<tauri::ipc::Response, String> {
    let file_path =
        fs::canonicalize(&path).map_err(|error| format!("Datei nicht gefunden: {error}"))?;
    if !file_path.is_file() || !is_vox_file(&file_path) {
        return Err("Es können nur vorhandene .vox-Dateien geöffnet werden.".to_string());
    }

    let metadata = fs::metadata(&file_path).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_VOX_FILE_SIZE {
        return Err("Die Datei ist größer als das unterstützte Limit von 512 MB.".to_string());
    }

    let bytes = fs::read(file_path)
        .map_err(|error| format!("Datei konnte nicht gelesen werden: {error}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
async fn llm_http_request(request: LlmHttpRequest) -> Result<LlmHttpResponse, String> {
    let url = reqwest::Url::parse(&request.url)
        .map_err(|error| format!("Ungültiger API-Endpunkt: {error}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Der API-Endpunkt muss HTTP oder HTTPS verwenden.".to_string());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(240))
        .build()
        .map_err(|error| error.to_string())?;
    let mut builder = client.post(url).body(request.body);
    for (name, value) in request.headers {
        let header_name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| format!("Ungültiger HTTP-Header: {name}"))?;
        let header_value = reqwest::header::HeaderValue::from_str(&value)
            .map_err(|_| format!("Ungültiger Wert für HTTP-Header {name}."))?;
        builder = builder.header(header_name, header_value);
    }
    let response = builder
        .send()
        .await
        .map_err(|error| format!("LLM-Anfrage fehlgeschlagen: {error}"))?;
    let status = response.status().as_u16();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("LLM-Antwort konnte nicht gelesen werden: {error}"))?;
    if bytes.len() > MAX_LLM_RESPONSE_SIZE {
        return Err("Die LLM-Antwort ist größer als 32 MB.".to_string());
    }
    Ok(LlmHttpResponse {
        status,
        body: String::from_utf8_lossy(&bytes).into_owned(),
    })
}

fn safe_vox_name(file_name: &str) -> String {
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("voxel-asset");
    let sanitized: String = stem
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = sanitized
        .trim_matches('_')
        .chars()
        .take(80)
        .collect::<String>();
    format!(
        "{}.vox",
        if trimmed.is_empty() {
            "voxel-asset"
        } else {
            &trimmed
        }
    )
}

#[tauri::command]
fn save_generated_vox(
    directory: String,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    if bytes.len() > 10 * 1024 * 1024 || !bytes.starts_with(b"VOX ") {
        return Err("Die generierten Daten sind keine gültige VOX-Datei.".to_string());
    }
    let root = canonical_directory(&directory)?;
    let safe_name = safe_vox_name(&file_name);
    let stem = Path::new(&safe_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("voxel-asset");
    let mut destination = root.join(&safe_name);
    let mut suffix = 2;
    while destination.exists() {
        destination = root.join(format!("{stem}-{suffix}.vox"));
        suffix += 1;
    }
    fs::write(&destination, bytes)
        .map_err(|error| format!("VOX-Datei konnte nicht gespeichert werden: {error}"))?;
    Ok(destination.to_string_lossy().to_string())
}

fn locate_tool(app: &tauri::AppHandle, directory: &str, executable: &str) -> Option<String> {
    let mut candidates = Vec::new();
    if let Ok(current) = std::env::current_dir() {
        candidates.push(current.join(directory).join(executable));
        candidates.push(current.join(executable));
    }
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            candidates.push(parent.join(directory).join(executable));
            candidates.push(parent.join(executable));
        }
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join(directory).join(executable));
    }
    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .map(|candidate| candidate.to_string_lossy().to_string())
}

#[tauri::command]
fn discover_converter(app: tauri::AppHandle, kind: String) -> Result<Option<String>, String> {
    match kind.as_str() {
        "file-to-vox" => Ok(locate_tool(&app, "FileToVox-win-x64", "FileToVox.exe")),
        "mesh-to-vox" => Ok(locate_tool(&app, "MeshToVox-v2.9", "MeshToVox.exe")),
        _ => Err("Unbekannter Konverter.".to_string()),
    }
}

fn existing_file(path: &str, label: &str) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(path).map_err(|error| format!("{label} fehlt: {error}"))?;
    if !canonical.is_file() {
        return Err(format!("{label} ist keine Datei."));
    }
    Ok(canonical)
}

fn option_path(path: &Option<String>, label: &str) -> Result<Option<PathBuf>, String> {
    path.as_ref()
        .filter(|value| !value.trim().is_empty())
        .map(|value| existing_file(value, label))
        .transpose()
}

fn add_option(arguments: &mut Vec<String>, option: &str, value: impl ToString) {
    arguments.push(option.to_string());
    arguments.push(value.to_string());
}

fn validate_file_to_vox_arguments(arguments: &[String]) -> Result<(), String> {
    if arguments.is_empty() || arguments.len() > 24 {
        return Err("Ungültige Anzahl von FileToVox-Argumenten.".to_string());
    }
    let mut seen = HashSet::new();
    let mut index = 0;
    while index < arguments.len() {
        let option = arguments[index].as_str();
        if !seen.insert(option.to_string()) {
            return Err(format!("Doppelte FileToVox-Option: {option}"));
        }
        let takes_value = matches!(
            option,
            "--input"
                | "--output"
                | "--color-from-file"
                | "--color-limit"
                | "--chunk-size"
                | "--heightmap"
                | "--palette"
                | "--grid-size"
        );
        let is_flag = matches!(
            option,
            "--color" | "--excavate" | "--debug" | "--disable-quantization"
        );
        if !takes_value && !is_flag {
            return Err(format!("Nicht erlaubte FileToVox-Option: {option}"));
        }
        if takes_value {
            let value = arguments
                .get(index + 1)
                .filter(|value| !value.is_empty() && value.len() <= 32_767)
                .ok_or_else(|| format!("Wert für {option} fehlt."))?;
            match option {
                "--color-limit" => {
                    let value = value
                        .parse::<u16>()
                        .map_err(|_| "Das Farblimit ist ungültig.".to_string())?;
                    if !(1..=256).contains(&value) {
                        return Err("Das Farblimit muss zwischen 1 und 256 liegen.".to_string());
                    }
                }
                "--chunk-size" => {
                    let value = value
                        .parse::<u16>()
                        .map_err(|_| "Die Chunk-Größe ist ungültig.".to_string())?;
                    if !(11..=256).contains(&value) {
                        return Err("Die Chunk-Größe muss zwischen 11 und 256 liegen.".to_string());
                    }
                }
                "--heightmap" => {
                    let value = value
                        .parse::<u16>()
                        .map_err(|_| "Die Höhenkarte ist ungültig.".to_string())?;
                    if !(1..=1000).contains(&value) {
                        return Err("Die Höhenkarte muss zwischen 1 und 1000 liegen.".to_string());
                    }
                }
                "--grid-size" => {
                    let value = value
                        .parse::<f64>()
                        .map_err(|_| "Die Rastergröße ist ungültig.".to_string())?;
                    if !value.is_finite() || !(10.0..=2000.0).contains(&value) {
                        return Err("Die Rastergröße muss zwischen 10 und 2000 liegen.".to_string());
                    }
                }
                _ => {}
            }
            index += 2;
        } else {
            index += 1;
        }
    }
    if !seen.contains("--input") || !seen.contains("--output") {
        return Err("FileToVox benötigt Eingabe und Ausgabe.".to_string());
    }
    Ok(())
}

fn worker_job_directory(request_path: &Path) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(request_path)
        .map_err(|error| format!("Worker-Anforderung nicht gefunden: {error}"))?;
    if canonical.file_name().and_then(|name| name.to_str()) != Some("request.json") {
        return Err("Ungültiger Name der Worker-Anforderung.".to_string());
    }
    let job_directory = canonical
        .parent()
        .ok_or_else(|| "Worker-Anforderung hat keinen Job-Ordner.".to_string())?;
    let jobs_root = fs::canonicalize(std::env::temp_dir().join("VoxelGallery-FileToVox"))
        .map_err(|error| format!("Worker-Stammordner fehlt: {error}"))?;
    if job_directory.parent() != Some(jobs_root.as_path())
        || !job_directory
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| {
                !name.is_empty()
                    && name
                        .chars()
                        .all(|character| character.is_ascii_alphanumeric() || character == '-')
            })
    {
        return Err("Worker-Anforderung liegt außerhalb des erlaubten Job-Ordners.".to_string());
    }
    Ok(job_directory.to_path_buf())
}

fn run_file_to_vox_worker_inner(request_path: &Path) -> Result<WorkerResult, String> {
    let job_directory = worker_job_directory(request_path)?;
    let request: WorkerRequest = serde_json::from_slice(
        &fs::read(request_path)
            .map_err(|error| format!("Worker-Anforderung konnte nicht gelesen werden: {error}"))?,
    )
    .map_err(|error| format!("Worker-Anforderung ist ungültig: {error}"))?;
    validate_file_to_vox_arguments(&request.arguments)?;
    let executable = existing_file(&request.executable_path, "FileToVox.exe")?;
    if !executable
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case("FileToVox.exe"))
    {
        return Err("Der Worker darf ausschließlich FileToVox.exe starten.".to_string());
    }

    let stdout_path = job_directory.join("stdout.log");
    let stderr_path = job_directory.join("stderr.log");
    let stdout = fs::File::create(&stdout_path)
        .map_err(|error| format!("Standardausgabe konnte nicht geöffnet werden: {error}"))?;
    let stderr = fs::File::create(&stderr_path)
        .map_err(|error| format!("Fehlerausgabe konnte nicht geöffnet werden: {error}"))?;
    let mut command = Command::new(&executable);
    command
        .args(&request.arguments)
        .current_dir(executable.parent().unwrap_or(Path::new(".")))
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut process = command
        .spawn()
        .map_err(|error| format!("FileToVox.exe konnte nicht gestartet werden: {error}"))?;
    let cancel_path = job_directory.join("cancel");
    let (exit_code, cancelled) = loop {
        if let Some(status) = process
            .try_wait()
            .map_err(|error| format!("FileToVox-Status konnte nicht gelesen werden: {error}"))?
        {
            break (status.code().unwrap_or(-1), false);
        }
        if cancel_path.is_file() {
            let _ = process.kill();
            let status = process
                .wait()
                .map_err(|error| format!("FileToVox-Abbruch fehlgeschlagen: {error}"))?;
            break (status.code().unwrap_or(-1), true);
        }
        thread::sleep(Duration::from_millis(100));
    };

    let stdout = String::from_utf8_lossy(&fs::read(stdout_path).unwrap_or_default()).into_owned();
    let stderr = String::from_utf8_lossy(&fs::read(stderr_path).unwrap_or_default()).into_owned();
    let mut log = stdout;
    if !stderr.trim().is_empty() {
        if !log.ends_with('\n') && !log.is_empty() {
            log.push('\n');
        }
        log.push_str("[STDERR]\n");
        log.push_str(&stderr);
    }
    fs::write(job_directory.join("conversion.log"), log).map_err(|error| {
        format!("Konvertierungsprotokoll konnte nicht gespeichert werden: {error}")
    })?;
    Ok(WorkerResult {
        exit_code,
        cancelled,
        error: None,
    })
}

pub fn run_file_to_vox_worker(request_path: &str) -> i32 {
    let path = PathBuf::from(request_path);
    let job_directory = match worker_job_directory(&path) {
        Ok(directory) => directory,
        Err(_) => return 10,
    };
    let result_path = job_directory.join("result.json");
    let result = match run_file_to_vox_worker_inner(&path) {
        Ok(result) => result,
        Err(error) => WorkerResult {
            exit_code: -1,
            cancelled: false,
            error: Some(error),
        },
    };
    match serde_json::to_vec(&result)
        .map_err(|error| error.to_string())
        .and_then(|bytes| fs::write(result_path, bytes).map_err(|error| error.to_string()))
    {
        Ok(()) if result.error.is_none() => 0,
        Ok(()) => 12,
        Err(_) => 11,
    }
}

fn execute_file_to_vox(
    request: FileToVoxRequest,
    jobs: Arc<Mutex<HashMap<String, PathBuf>>>,
) -> Result<ConverterResult, String> {
    if request.job_id.is_empty()
        || !request
            .job_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err("Ungültige Job-ID.".to_string());
    }

    let tool_path = existing_file(&request.executable_path, "FileToVox.exe")?;
    if !tool_path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case("FileToVox.exe"))
    {
        return Err("Bitte FileToVox.exe auswählen.".to_string());
    }

    let input = if let Some(folder) = request.input_folder.as_ref() {
        canonical_directory(folder)?.to_string_lossy().to_string()
    } else {
        if request.input_paths.is_empty() {
            return Err("Bitte mindestens eine Eingabedatei auswählen.".to_string());
        }
        request
            .input_paths
            .iter()
            .map(|path| existing_file(path, "Eingabedatei"))
            .collect::<Result<Vec<_>, _>>()?
            .iter()
            .map(|path| path.to_string_lossy())
            .collect::<Vec<_>>()
            .join(";")
    };

    let output = PathBuf::from(&request.output_path);
    if !output
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("vox"))
    {
        return Err("Die Ausgabe muss eine .vox-Datei sein.".to_string());
    }
    let output_parent = output
        .parent()
        .ok_or_else(|| "Der Ausgabepfad hat keinen Ordner.".to_string())?;
    let output_parent = canonical_directory(&output_parent.to_string_lossy())?;
    let output_name = output
        .file_name()
        .ok_or_else(|| "Der Ausgabename ist ungültig.".to_string())?;
    let output = output_parent.join(output_name);
    if output.exists() {
        return Err("Am Ziel existiert bereits eine Datei mit diesem Namen.".to_string());
    }

    let color_file = option_path(&request.color_from_file, "Externe Farbdatei")?;
    let palette = option_path(&request.palette, "Palettenbild")?;
    let mut arguments = Vec::new();
    add_option(&mut arguments, "--input", input);
    add_option(&mut arguments, "--output", output.to_string_lossy());
    if request.color {
        arguments.push("--color".to_string());
    }
    if let Some(path) = color_file {
        add_option(&mut arguments, "--color-from-file", path.to_string_lossy());
    }
    if let Some(value) = request.color_limit {
        add_option(&mut arguments, "--color-limit", value.clamp(1, 256));
    }
    if let Some(value) = request.chunk_size {
        add_option(&mut arguments, "--chunk-size", value.clamp(11, 256));
    }
    if request.excavate {
        arguments.push("--excavate".to_string());
    }
    if let Some(value) = request.heightmap {
        add_option(&mut arguments, "--heightmap", value.clamp(1, 1000));
    }
    if let Some(path) = palette {
        add_option(&mut arguments, "--palette", path.to_string_lossy());
    }
    if let Some(value) = request.grid_size {
        add_option(&mut arguments, "--grid-size", value.clamp(10.0, 2000.0));
    }
    if request.debug {
        arguments.push("--debug".to_string());
    }
    if request.disable_quantization {
        arguments.push("--disable-quantization".to_string());
    }

    let job_root = std::env::temp_dir().join("VoxelGallery-FileToVox");
    fs::create_dir_all(&job_root).map_err(|error| error.to_string())?;
    let job_dir = job_root.join(&request.job_id);
    if job_dir.exists() {
        return Err("Dieser Konvertierungsauftrag existiert bereits.".to_string());
    }
    fs::create_dir(&job_dir).map_err(|error| error.to_string())?;
    let request_path = job_dir.join("request.json");
    let result_path = job_dir.join("result.json");
    let log_path = job_dir.join("conversion.log");
    validate_file_to_vox_arguments(&arguments)?;
    fs::write(
        &request_path,
        serde_json::to_vec(&WorkerRequest {
            executable_path: tool_path.to_string_lossy().to_string(),
            arguments,
        })
        .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    jobs.lock()
        .map_err(|_| "Konverterstatus ist nicht verfügbar.".to_string())?
        .insert(request.job_id.clone(), job_dir.clone());

    let worker_executable = std::env::current_exe()
        .map_err(|error| format!("Voxel-Gallery-Worker wurde nicht gefunden: {error}"))?;
    let mut powershell = Command::new("powershell.exe");
    powershell.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$process = Start-Process -FilePath $env:VG_FILETOVOX_WORKER -ArgumentList '--file-to-vox-worker',$env:VG_FILETOVOX_REQUEST -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $process.ExitCode",
        ])
        .env("VG_FILETOVOX_WORKER", worker_executable)
        .env("VG_FILETOVOX_REQUEST", &request_path);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        powershell.creation_flags(0x0800_0000);
    }
    let command_status = powershell.status();

    jobs.lock()
        .map_err(|_| "Konverterstatus ist nicht verfügbar.".to_string())?
        .remove(&request.job_id);

    let log = fs::read_to_string(&log_path).unwrap_or_default();
    let result = fs::read(&result_path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<WorkerResult>(&bytes).ok());
    let outcome = match (command_status, result) {
        (_, Some(result)) if result.cancelled => Err("Konvertierung abgebrochen.".to_string()),
        (_, Some(result)) if result.exit_code == 0 && result.error.is_none() && output.is_file() => {
            Ok(ConverterResult {
                output_path: output.to_string_lossy().to_string(),
                log: log.chars().rev().take(20_000).collect::<String>().chars().rev().collect(),
            })
        }
        (_, Some(result)) => Err(result.error.unwrap_or_else(|| {
            format!("FileToVox wurde mit Exit-Code {} beendet.\n{log}", result.exit_code)
        })),
        (Err(error), _) => Err(format!("FileToVox konnte nicht gestartet werden: {error}")),
        _ => Err(format!(
            "FileToVox hat kein Ergebnis geliefert. Die Windows-Sicherheitsabfrage wurde möglicherweise abgebrochen.\n{log}"
        )),
    };
    let _ = fs::remove_dir_all(&job_dir);
    outcome
}

#[tauri::command]
async fn run_file_to_vox(
    request: FileToVoxRequest,
    jobs: State<'_, ConverterJobs>,
) -> Result<ConverterResult, String> {
    let jobs = Arc::clone(&jobs.0);
    tauri::async_runtime::spawn_blocking(move || execute_file_to_vox(request, jobs))
        .await
        .map_err(|error| format!("Konverter-Task fehlgeschlagen: {error}"))?
}

#[tauri::command]
fn cancel_file_to_vox(job_id: String, jobs: State<'_, ConverterJobs>) -> Result<(), String> {
    let job_dir = jobs
        .0
        .lock()
        .map_err(|_| "Konverterstatus ist nicht verfügbar.".to_string())?
        .get(&job_id)
        .cloned()
        .ok_or_else(|| "Der Auftrag läuft nicht mehr.".to_string())?;
    fs::write(job_dir.join("cancel"), b"cancel")
        .map_err(|error| format!("Abbruch konnte nicht angefordert werden: {error}"))
}

#[tauri::command]
fn launch_mesh_to_vox(executable: String) -> Result<(), String> {
    let executable = existing_file(&executable, "MeshToVox.exe")?;
    if !executable
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case("MeshToVox.exe"))
    {
        return Err("Bitte MeshToVox.exe auswählen.".to_string());
    }
    let working_directory = executable
        .parent()
        .ok_or_else(|| "MeshToVox hat keinen gültigen Programmordner.".to_string())?;
    if !working_directory.join("MeshToVox_Data").is_dir() {
        return Err("Der Ordner MeshToVox_Data muss neben MeshToVox.exe liegen.".to_string());
    }
    Command::new(&executable)
        .current_dir(working_directory)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("MeshToVox konnte nicht gestartet werden: {error}"))
}

#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    let canonical =
        fs::canonicalize(path).map_err(|error| format!("Pfad nicht gefunden: {error}"))?;
    let mut command = Command::new("explorer.exe");
    if canonical.is_file() {
        command.arg(format!("/select,{}", canonical.to_string_lossy()));
    } else {
        command.arg(canonical);
    }
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Explorer konnte nicht geöffnet werden: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ConverterJobs::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            scan_library,
            read_vox,
            llm_http_request,
            save_generated_vox,
            discover_converter,
            run_file_to_vox,
            cancel_file_to_vox,
            launch_mesh_to_vox,
            reveal_in_explorer
        ])
        .run(tauri::generate_context!())
        .expect("error while running Voxel Gallery");
}

#[cfg(test)]
mod tests {
    use super::{is_vox_file, validate_file_to_vox_arguments};
    use std::path::Path;

    #[test]
    fn detects_vox_extension_case_insensitively() {
        assert!(is_vox_file(Path::new("model.vox")));
        assert!(is_vox_file(Path::new("MODEL.VOX")));
        assert!(!is_vox_file(Path::new("model.vox.png")));
    }

    #[test]
    fn accepts_only_the_supported_file_to_vox_argument_surface() {
        let valid = [
            "--input",
            "C:\\input.png",
            "--output",
            "C:\\output.vox",
            "--color",
            "--color-limit",
            "64",
            "--chunk-size",
            "128",
            "--excavate",
        ]
        .map(str::to_string);
        assert!(validate_file_to_vox_arguments(&valid).is_ok());

        let unknown = ["--input", "in.png", "--output", "out.vox", "--shell"].map(str::to_string);
        assert!(validate_file_to_vox_arguments(&unknown).is_err());

        let missing_value = ["--input", "in.png", "--output"].map(str::to_string);
        assert!(validate_file_to_vox_arguments(&missing_value).is_err());

        let duplicate = [
            "--input", "one.png", "--input", "two.png", "--output", "out.vox",
        ]
        .map(str::to_string);
        assert!(validate_file_to_vox_arguments(&duplicate).is_err());
    }
}
