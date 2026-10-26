use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
static DIALOG: AtomicBool = AtomicBool::new(false);
static SHORTCUT_ERROR: Mutex<Option<String>> = Mutex::new(None);

#[tauri::command]
pub fn shortcut_error() -> Result<Option<String>, String> {
    Ok(SHORTCUT_ERROR.lock().map_err(|e| e.to_string())?.clone())
}

#[tauri::command]
pub fn dialog_active(active: bool) {
    DIALOG.store(active, Ordering::SeqCst);
}
#[tauri::command]
pub fn show_quickbar(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("quickbar")
        .ok_or("Missing quickbar")?;
    window
        .show()
        .and_then(|_| window.set_focus())
        .map_err(|e| e.to_string())
}
pub fn setup(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    for label in ["main", "quickbar"] {
        let window = app.get_webview_window(label).ok_or("Missing window")?;
        let target = window.clone();
        window.on_window_event(move |event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                if let Err(e) = target.hide() {
                    eprintln!("hide: {e}");
                }
            }
            WindowEvent::Focused(false)
                if target.label() == "quickbar" && !DIALOG.load(Ordering::SeqCst) =>
            {
                if let Err(e) = target.hide() {
                    eprintln!("hide quickbar: {e}");
                }
            }
            WindowEvent::Focused(true) if target.label() == "main" => {
                if let Err(e) = target.emit("main-visible", ()) {
                    eprintln!("emit: {e}");
                }
            }
            _ => {}
        });
    }
    // Explicit override permits validating conflicts without silently trying another binding.
    let shortcut =
        std::env::var("TASK_TERMINAL_SHORTCUT").unwrap_or_else(|_| "Ctrl+Alt+Shift+R".into());
    let registration = app
        .global_shortcut()
        .on_shortcut(shortcut.as_str(), |app, _, event| {
            if event.state == ShortcutState::Pressed {
                if let Some(window) = app.get_webview_window("quickbar") {
                    let result = window.is_visible().and_then(|visible| {
                        if visible {
                            window.hide()
                        } else {
                            window.show().and_then(|_| window.set_focus())
                        }
                    });
                    if let Err(e) = result {
                        eprintln!("shortcut: {e}");
                    }
                }
            }
        });
    if let Err(error) = registration {
        let message = format!("快捷键 {shortcut} 注册失败：{error}");
        super::evidence(app.clone(), message.clone())?;
        *SHORTCUT_ERROR.lock().map_err(|e| e.to_string())? = Some(message);
    }
    Ok(())
}
