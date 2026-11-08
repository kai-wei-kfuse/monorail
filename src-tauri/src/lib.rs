mod attachments;
mod power;
mod reminders;
mod private_release;
mod quick_save;
mod tray;
mod update_backup;
mod update_channel;
mod updates;
mod update_state;
mod windows;
mod mini_window;
mod mini_visibility;
mod main_session;
mod mcp_bridge;
mod recap_view;
mod idea_windows;

use std::{fs, path::PathBuf};
use tauri::Manager;
#[cfg(feature = "verify")]
use tauri::Emitter;

#[cfg(feature = "verify")]
#[tauri::command]
fn verification_enabled() -> bool { true }

macro_rules! handlers {
    ($($extra:path),*) => {
        tauri::generate_handler![read_config, save_config, save_quick_record, save_attachment, evidence, open_external_url,
            power::read_lifecycle, reminders::set_reminders, windows::show_quickbar,
            windows::dialog_active, windows::set_shortcut,
            mini_window::toggle_mini, mini_window::show_main, mini_window::fit_mini_window, mini_visibility::read_mini_visibility,
            main_session::begin_main_session,
            recap_view::read_recap_view, recap_view::write_recap_view,
            updates::check_update, updates::check_stable_update, updates::set_update_channel,
            updates::dismiss_update_target, updates::download_update, updates::install_update,
            updates::read_update_state, updates::prepare_update_install, updates::cancel_update_install,
            quick_save::quickbar_update_ready, quick_save::main_update_ready, quick_save::ack_quickbar_update, quick_save::ack_draft_check,
            quick_save::begin_quick_save, quick_save::end_quick_save,
            quick_save::begin_data_migration, quick_save::finish_data_migration,
            quick_save::begin_maintenance_check, quick_save::check_drafts_for_maintenance,
            quick_save::cancel_maintenance_check, quick_save::focus_dirty_window, quick_save::perform_app_exit,
            idea_windows::open_idea_window, idea_windows::open_idea_draft_window,
            idea_windows::idea_window_hello, idea_windows::idea_window_send, idea_windows::idea_window_reply,
            idea_windows::idea_window_notify_committed, idea_windows::rebind_idea_draft_window,
            idea_windows::close_idea_window, idea_windows::close_all_idea_windows,
            mcp_bridge::start_mcp_bridge, mcp_bridge::respond_mcp, mcp_bridge::read_mcp_host, $($extra),*]
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
        mcp_bridge::set_setup_required(&app);
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
    .map_err(|e| e.to_string())?;
    let _ = mcp_bridge::write_host_metadata(&app);
    mcp_bridge::set_recovering(&app);
    Ok(())
}

// A narrow command enforces the quickbar's records-only writes. Dynamic dialog
// scopes are app-wide; giving quickbar generic fs write would also expose cards.
#[tauri::command]
fn save_quick_record(app: tauri::AppHandle, id: String, text: String) -> Result<(), String> {
    quick_save::ensure_active(&app, &id)?;
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
    quick_save::ensure_active(&app, &record)?;
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

pub fn validate_external_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("INVALID_EXTERNAL_URL：外部链接不能为空".into());
    }
    let parsed = url::Url::parse(trimmed)
        .map_err(|e| format!("INVALID_EXTERNAL_URL：外部链接格式无效（{e}）"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed.to_string()),
        scheme => Err(format!(
            "UNSAFE_EXTERNAL_URL：仅允许打开 http 或 https 链接（已拒绝 {scheme}:）"
        )),
    }
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let safe_url = validate_external_url(&url)?;
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};
        let operation: Vec<u16> = "open\0".encode_utf16().collect();
        let target: Vec<u16> = format!("{safe_url}\0").encode_utf16().collect();
        let res = ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            target.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        );
        if (res as isize) <= 32 {
            return Err(format!(
                "OPEN_EXTERNAL_URL_FAILED：系统浏览器打开失败（代码 {}）",
                res as isize
            ));
        }
    }
    Ok(())
}

pub fn run() {
    let builder = tauri::Builder::default()
        .manage(update_state::Updates::default())
        .manage(quick_save::QuickSaves::default())
        .manage(idea_windows::IdeaWindows::default())
        .manage(mcp_bridge::McpBridge::default())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            if _args.iter().any(|a| a == "--background") {
                return;
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
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
            update_state::initialize(app.handle());
            power::setup(app.handle().clone())?;
            reminders::setup(app.handle().clone());
            mcp_bridge::setup(app.handle())?;
            windows::setup(app.handle())?;
            tray::setup(app.handle())?;
            Ok(())
        });
    #[cfg(feature = "verify")]
    let builder = builder.invoke_handler(handlers![power::simulate_power, verification_enabled]);
    #[cfg(not(feature = "verify"))]
    let builder = builder.invoke_handler(handlers![]);
    let mut context = tauri::generate_context!();
    if std::env::args().any(|arg| arg == "--background") {
        for window in &mut context.config_mut().app.windows {
            if window.label == "main" {
                window.visible = false;
            }
        }
    }
    builder.run(context)
        .expect("Tauri failed to start");
}

#[cfg(test)]
mod tests {
    use super::validate_external_url;

    #[test]
    fn allows_only_http_and_https_external_urls() {
        assert_eq!(
            validate_external_url("https://developers.cloudflare.com/durable-objects/").unwrap(),
            "https://developers.cloudflare.com/durable-objects/"
        );
        assert_eq!(
            validate_external_url("http://example.com/path?a=1#frag").unwrap(),
            "http://example.com/path?a=1#frag"
        );
        for blocked in [
            "",
            "javascript:alert(1)",
            "file:///C:/Windows/System32/calc.exe",
            "data:text/html,<script>alert(1)</script>",
            "vbscript:msgbox(1)",
            "ms-msdt:/id PCWDiagnostic",
            "ftp://example.com/file",
        ] {
            assert!(
                validate_external_url(blocked).is_err(),
                "must reject non-http/https URL: {blocked}"
            );
        }
    }
}
