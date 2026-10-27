use std::{collections::HashSet, sync::{mpsc, Mutex}};
use tauri::{Emitter, Manager, State};

#[derive(Default)]
struct Gate { active: HashSet<String>, installing: bool, guard_ready: bool, pending: Option<mpsc::Sender<bool>> }
#[derive(Default)]
pub struct QuickSaves(Mutex<Gate>);

#[tauri::command]
pub fn quickbar_update_ready(state: State<QuickSaves>) -> Result<(), String> {
    state.0.lock().map_err(|error| error.to_string())?.guard_ready = true;
    Ok(())
}

#[tauri::command]
pub fn ack_quickbar_update(state: State<QuickSaves>, dirty: bool) -> Result<(), String> {
    let sender = state.0.lock().map_err(|error| error.to_string())?.pending.take()
        .ok_or("没有等待中的更新草稿检查")?;
    sender.send(dirty).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn begin_quick_save(state: State<QuickSaves>, id: String) -> Result<(), String> {
    let mut gate = state.0.lock().map_err(|error| error.to_string())?;
    if gate.installing { return Err("正在安装更新，请在更新完成后保存".into()); }
    if !gate.active.insert(id) { return Err("该记录已经在保存".into()); }
    Ok(())
}

#[tauri::command]
pub fn end_quick_save(state: State<QuickSaves>, id: String) -> Result<(), String> {
    let mut gate = state.0.lock().map_err(|error| error.to_string())?;
    if !gate.active.remove(&id) { return Err("没有对应的快速记录保存会话".into()); }
    Ok(())
}

pub fn ensure_active(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let state = app.state::<QuickSaves>();
    let gate = state.0.lock().map_err(|error| error.to_string())?;
    if !gate.active.contains(id) { return Err("快速记录必须在完整保存会话内写入".into()); }
    Ok(())
}

pub async fn prepare_install(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<QuickSaves>();
    let receiver = {
        let mut gate = state.0.lock().map_err(|error| error.to_string())?;
        // Admission and the check are atomic: an accepted multi-attachment save is never interrupted.
        if !gate.active.is_empty() { return Err("快速记录条正在保存，请完成后重试安装更新".into()); }
        if !gate.guard_ready { return Err("快速记录条尚未就绪，无法安全检查草稿，请稍后重试".into()); }
        gate.installing = true;
        let (sender, receiver) = mpsc::channel();
        gate.pending = Some(sender);
        receiver
    };
    let window = app.get_webview_window("quickbar").ok_or("快速记录窗口不存在")?;
    window.hide().map_err(|error| error.to_string())?;
    // A round trip after hiding reads the actual WebView draft, avoiding stale debounced/native flags.
    app.emit_to("quickbar", "update-check-draft", ()).map_err(|error| error.to_string())?;
    let dirty = tauri::async_runtime::spawn_blocking(move || receiver.recv()).await
        .map_err(|error| error.to_string())?.map_err(|error| error.to_string())?;
    if dirty { return Err("快速记录条还有未保存内容，请保存或清空后重试安装更新".into()); }
    Ok(())
}

pub fn cancel_install(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<QuickSaves>();
    let mut gate = state.0.lock().map_err(|error| error.to_string())?;
    gate.installing = false;
    gate.pending = None;
    Ok(())
}
