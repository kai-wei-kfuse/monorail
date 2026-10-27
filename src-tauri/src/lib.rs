mod attachments;
mod power;
mod reminders;
mod tray;
mod windows;

use std::{fs, path::PathBuf};
use tauri::Manager;
#[cfg(feature = "verify")]
use tauri::Emitter;

#[cfg(feature = "verify")]
#[tauri::command]
fn verification_enabled() -> bool { true }

macro_rules! handlers {
    ($($extra:path),*) => {
        tauri::generate_handler![read_config, save_config, save_quick_record, save_attachment, evidence,
            power::read_lifecycle, reminders::set_reminders, windows::show_quickbar,
            windows::dialog_active, windows::shortcut_error, windows::set_shortcut, $($extra),*]
    };
}

pub fn config_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}

#[tauri::command]
fn read_config(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = config_dir(&app)?.join("config.json");
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path)
        .map(Some)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn save_config(app: tauri::AppHandle, root: String) -> Result<(), String> {
    let path = PathBuf::from(&root);
    if !path.is_absolute() || !path.is_dir() {
        return Err("Data directory must exist and be absolute".into());
    }
    fs::write(
        config_dir(&app)?.join("config.json"),
        serde_json::json!({"root":root}).to_string(),
    )
    .map_err(|e| e.to_string())
}

// A narrow command enforces the quickbar's records-only writes. Dynamic dialog
// scopes are app-wide; giving quickbar generic fs write would also expose cards.
#[tauri::command]
fn save_quick_record(app: tauri::AppHandle, id: String, text: String) -> Result<(), String> {
    if id.len() != 36 || !id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return Err("Invalid record ID".into());
    }
    let config = read_config(app)?.ok_or("No data directory")?;
    let value: serde_json::Value = serde_json::from_str(&config).map_err(|e| e.to_string())?;
    let root = PathBuf::from(value["root"].as_str().ok_or("Invalid config")?);
    let directory = root.join("records");
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let path = directory.join(format!("{id}.md"));
    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    file.write_all(text.as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())
}

/// Quick bar's only other write: attachments under attachments/<record>/, written before the record.
#[tauri::command]
fn save_attachment(app: tauri::AppHandle, record: String, name: String, bytes: Vec<u8>) -> Result<String, String> {
    let config = read_config(app)?.ok_or("No data directory")?;
    let value: serde_json::Value = serde_json::from_str(&config).map_err(|e| e.to_string())?;
    let root = PathBuf::from(value["root"].as_str().ok_or("Invalid config")?);
    attachments::save(&root, &record, &name, &bytes)
}

#[tauri::command]
fn evidence(app: tauri::AppHandle, message: String) -> Result<(), String> {
    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(config_dir(&app)?.join("evidence.jsonl"))
        .map_err(|e| e.to_string())?;
    writeln!(
        file,
        "{}",
        serde_json::json!({"at":power::now_ms(),"message":message})
    )
    .map_err(|e| e.to_string())
}

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _| {
            #[cfg(feature = "verify")]
            if _args.iter().any(|a| a == "--verify-start") {
                if let Err(e) = app.emit("verification-start", ()) { eprintln!("verify trigger: {e}"); }
                return;
            }
            #[cfg(feature = "verify")]
            if _args.iter().any(|a| a == "--verify-journal") {
                if let Err(e) = app.emit("verification-journal", ()) { eprintln!("verify journal trigger: {e}"); }
                return;
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            windows::setup(app.handle())?;
            tray::setup(app.handle())?;
            power::setup(app.handle().clone())?;
            reminders::setup(app.handle().clone());
            Ok(())
        });
    #[cfg(feature = "verify")]
    let builder = builder.invoke_handler(handlers![power::simulate_power, verification_enabled]);
    #[cfg(not(feature = "verify"))]
    let builder = builder.invoke_handler(handlers![]);
    builder.run(tauri::generate_context!())
        .expect("Tauri failed to start");
}
