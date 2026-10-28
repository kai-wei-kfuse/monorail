use serde::{Deserialize, Serialize};
use std::{fs, path::Path};
use tauri::{Manager, PhysicalPosition, PhysicalSize, WebviewWindow, WindowEvent};
static SWITCH: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Debug, Serialize, Deserialize, PartialEq)]
struct Geometry { x: i32, y: i32, width: u32, height: u32 }

fn read_geometry(path: &Path) -> Result<Option<Geometry>, String> {
    match fs::read(path) {
        Ok(bytes) => {
            let value: Geometry = serde_json::from_slice(&bytes).map_err(|e| format!("小窗位置文件无效：{e}"))?;
            if value.width == 0 || value.height == 0 { return Err("小窗尺寸必须为正数".into()); }
            Ok(Some(value))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}
fn save_geometry(window: &WebviewWindow) -> Result<(), String> {
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.inner_size().map_err(|e| e.to_string())?;
    // Minimized windows can report an empty client area; preserve the last usable geometry.
    if size.width == 0 || size.height == 0 { return Ok(()); }
    let value = Geometry { x: position.x, y: position.y, width: size.width, height: size.height };
    let path = super::config_dir(window.app_handle())?.join("mini-window.json");
    fs::write(path, serde_json::to_vec(&value).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
fn create(app: &tauri::AppHandle) -> Result<WebviewWindow, String> {
    let config = app.config().app.windows.iter().find(|window| window.label == "mini").ok_or("缺少小窗配置")?;
    let geometry = read_geometry(&super::config_dir(app)?.join("mini-window.json"))?;
    let window = tauri::WebviewWindowBuilder::from_config(app, config).map_err(|e| e.to_string())?.build().map_err(|e| e.to_string())?;
    if let Err(error) = super::mini_visibility::install(&window) {
        window.destroy().map_err(|cleanup| format!("{error}；小窗清理失败：{cleanup}"))?;
        return Err(error);
    }
    if let Some(value) = geometry {
        window.set_size(PhysicalSize::new(value.width, value.height)).map_err(|e| e.to_string())?;
        window.set_position(PhysicalPosition::new(value.x, value.y)).map_err(|e| e.to_string())?;
    }
    let target = window.clone();
    window.on_window_event(move |event| {
        let result = match event {
            WindowEvent::CloseRequested { api, .. } => { api.prevent_close(); target.hide().map_err(|e| e.to_string()) }
            WindowEvent::Moved(_) | WindowEvent::Resized(_) => save_geometry(&target),
            _ => Ok(()),
        };
        if let Err(error) = result { eprintln!("mini window: {error}"); }
    });
    Ok(window)
}

#[tauri::command]
pub async fn toggle_mini(app: tauri::AppHandle) -> Result<bool, String> {
    // WebView2 creation deadlocks on the Windows UI thread (Tauri from_config contract).
    // Serialize tray and IPC toggles inside the blocking worker, including first creation.
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = SWITCH.lock().map_err(|e| e.to_string())?;
        toggle(&app)
    }).await.map_err(|e| e.to_string())?
}
fn toggle(app: &tauri::AppHandle) -> Result<bool, String> {
    let window = match app.get_webview_window("mini") { Some(window) => window, None => create(app)? };
    if window.is_visible().map_err(|e| e.to_string())? {
        save_geometry(&window)?;
        window.hide().map_err(|e| e.to_string())?;
        Ok(false)
    } else {
        window.show().and_then(|_| window.set_focus()).map_err(|e| e.to_string())?;
        Ok(true)
    }
}

#[tauri::command]
pub fn show_main(app: tauri::AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("缺少主窗口")?;
    window.unminimize().and_then(|_| window.show()).and_then(|_| window.set_focus()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn geometry_round_trip_and_corruption_are_explicit() {
        let path = std::env::temp_dir().join(format!("monorail-mini-{}.json", std::process::id()));
        let value = Geometry { x: -1200, y: 40, width: 520, height: 88 };
        fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
        assert_eq!(read_geometry(&path).unwrap(), Some(value));
        fs::write(&path, b"broken").unwrap();
        assert!(read_geometry(&path).is_err());
        fs::write(&path, br#"{"x":0,"y":0,"width":0,"height":88}"#).unwrap();
        assert!(read_geometry(&path).is_err());
        fs::remove_file(&path).unwrap();
        assert_eq!(read_geometry(&path).unwrap(), None);
    }
}
