use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindow, WindowEvent};

static SESSION_SEQ: AtomicU64 = AtomicU64::new(0);
static CREATE_LOCK: Mutex<()> = Mutex::new(());

fn next_session_seq() -> u64 {
    SESSION_SEQ.fetch_add(1, Ordering::SeqCst) + 1
}

pub fn is_valid_uuid(id: &str) -> bool {
    if id.len() != 36 {
        return false;
    }
    id.chars().enumerate().all(|(idx, ch)| match idx {
        8 | 13 | 18 | 23 => ch == '-',
        _ => ch.is_ascii_hexdigit(),
    })
}

pub fn record_window_label(record_id: &str) -> Result<String, String> {
    if !is_valid_uuid(record_id) {
        return Err(format!("INVALID_RECORD_ID：想法记录 ID 格式无效（{record_id}）"));
    }
    Ok(format!("idea-{record_id}"))
}

pub fn draft_window_label(draft_id: &str) -> Result<String, String> {
    if !is_valid_uuid(draft_id) {
        return Err(format!("INVALID_DRAFT_ID：草稿 ID 格式无效（{draft_id}）"));
    }
    Ok(format!("idea-draft-{draft_id}"))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IdeaWindowRegistration {
    pub window_label: String,
    pub window_session: String,
    pub main_epoch: u64,
    pub target_kind: String, // "record" | "draft"
    pub record_id: Option<String>,
    pub draft_id: Option<String>,
    pub draft_version: Option<u64>,
    pub create_operation_id: Option<String>,
    pub initial_draft: Option<serde_json::Value>,
    pub ready: bool,
}

#[derive(Debug, Clone, PartialEq)]
struct HandoffDraftSession {
    draft_id: String,
    window_label: String,
    window_session: String,
    main_epoch: u64,
    create_operation_id: String,
    record_id: Option<String>,
}

#[derive(Default)]
pub struct Registry {
    windows: HashMap<String, IdeaWindowRegistration>,
    handoffs: HashMap<String, HandoffDraftSession>,
    closing: HashSet<String>,
}

#[derive(Default)]
pub struct IdeaWindows(pub Mutex<Registry>);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpenIdeaWindowResult {
    pub action: String, // "opened" | "focused"
    pub window_label: String,
    pub window_session: String,
    pub main_epoch: u64,
    pub record_id: Option<String>,
    pub draft_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WorkArea {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

pub fn fit_idea_window_bounds(default_width: u32, default_height: u32, area: WorkArea) -> (i32, i32, u32, u32) {
    let width = default_width.min(area.width.max(320));
    let height = default_height.min(area.height.max(240));
    let x = area.x + ((area.width.saturating_sub(width)) / 2) as i32;
    let y = area.y + ((area.height.saturating_sub(height)) / 2) as i32;
    (x, y, width, height)
}

impl Registry {
    pub fn find_by_record_id(&self, record_id: &str) -> Option<IdeaWindowRegistration> {
        let direct_label = format!("idea-{record_id}");
        if let Some(reg) = self.windows.get(&direct_label) {
            return Some(reg.clone());
        }
        self.windows
            .values()
            .find(|reg| reg.record_id.as_deref() == Some(record_id))
            .cloned()
    }

    pub fn find_by_draft_id(&self, draft_id: &str) -> Option<IdeaWindowRegistration> {
        let direct_label = format!("idea-draft-{draft_id}");
        if let Some(reg) = self.windows.get(&direct_label) {
            return Some(reg.clone());
        }
        self.windows
            .values()
            .find(|reg| reg.draft_id.as_deref() == Some(draft_id))
            .cloned()
    }

    pub fn register_record_window(
        &mut self,
        record_id: &str,
        main_epoch: u64,
        initial_draft: Option<serde_json::Value>,
    ) -> Result<IdeaWindowRegistration, String> {
        let label = record_window_label(record_id)?;
        let session = format!("ws-{record_id}-{}", next_session_seq());
        let reg = IdeaWindowRegistration {
            window_label: label.clone(),
            window_session: session,
            main_epoch,
            target_kind: "record".into(),
            record_id: Some(record_id.to_string()),
            draft_id: None,
            draft_version: None,
            create_operation_id: None,
            initial_draft,
            ready: false,
        };
        self.windows.insert(label, reg.clone());
        Ok(reg)
    }

    pub fn register_draft_window(
        &mut self,
        draft_id: &str,
        draft_version: u64,
        create_operation_id: &str,
        main_epoch: u64,
        snapshot: serde_json::Value,
    ) -> Result<IdeaWindowRegistration, String> {
        let label = draft_window_label(draft_id)?;
        if create_operation_id.trim().is_empty() {
            return Err("INVALID_OPERATION_ID：缺少草稿创建操作 ID".into());
        }
        let session = format!("ws-draft-{draft_id}-{}", next_session_seq());
        let reg = IdeaWindowRegistration {
            window_label: label.clone(),
            window_session: session.clone(),
            main_epoch,
            target_kind: "draft".into(),
            record_id: None,
            draft_id: Some(draft_id.to_string()),
            draft_version: Some(draft_version),
            create_operation_id: Some(create_operation_id.to_string()),
            initial_draft: Some(snapshot),
            ready: false,
        };
        self.windows.insert(label.clone(), reg.clone());
        self.handoffs.insert(
            draft_id.to_string(),
            HandoffDraftSession {
                draft_id: draft_id.to_string(),
                window_label: label,
                window_session: session,
                main_epoch,
                create_operation_id: create_operation_id.to_string(),
                record_id: None,
            },
        );
        Ok(reg)
    }

    pub fn mark_ready(&mut self, window_label: &str) -> Result<IdeaWindowRegistration, String> {
        let reg = self
            .windows
            .get_mut(window_label)
            .ok_or_else(|| format!("INVALID_WINDOW_SESSION：窗口 {window_label} 未在主窗口注册"))?;
        reg.ready = true;
        Ok(reg.clone())
    }

    pub fn rebind_draft_to_record(&mut self, draft_id: &str, record_id: &str) -> Result<Option<String>, String> {
        if !is_valid_uuid(draft_id) {
            return Err(format!("INVALID_DRAFT_ID：草稿 ID 格式无效（{draft_id}）"));
        }
        if !is_valid_uuid(record_id) {
            return Err(format!("INVALID_RECORD_ID：记录 ID 格式无效（{record_id}）"));
        }
        if let Some(handoff) = self.handoffs.get_mut(draft_id) {
            handoff.record_id = Some(record_id.to_string());
        }
        let target_label = self
            .windows
            .values()
            .find(|reg| reg.draft_id.as_deref() == Some(draft_id))
            .map(|reg| reg.window_label.clone());
        if let Some(label) = &target_label {
            if let Some(reg) = self.windows.get_mut(label) {
                reg.record_id = Some(record_id.to_string());
                reg.target_kind = "record".into();
            }
        }
        Ok(target_label)
    }

    pub fn verify_sender(
        &self,
        caller_label: &str,
        window_session: &str,
        main_epoch: u64,
        current_epoch: u64,
        record_id: Option<&str>,
        draft_id: Option<&str>,
    ) -> Result<IdeaWindowRegistration, String> {
        if main_epoch == 0 || main_epoch != current_epoch {
            return Err(format!(
                "EPOCH_MISMATCH：主窗口会话已刷新（当前纪元 {current_epoch}，请求纪元 {main_epoch}），旧窗口会话拒绝写入"
            ));
        }
        if caller_label == "quickbar" {
            let handoff = if let Some(d_id) = draft_id {
                self.handoffs.get(d_id)
            } else if let Some(r_id) = record_id {
                self.handoffs
                    .values()
                    .find(|h| h.record_id.as_deref() == Some(r_id))
            } else {
                self.handoffs
                    .values()
                    .find(|h| h.window_session == window_session)
            }
            .ok_or("INVALID_WINDOW_SESSION：该快速记录条草稿尚未注册独立窗口交接会话")?;
            if handoff.main_epoch != current_epoch {
                return Err(format!(
                    "EPOCH_MISMATCH：快速记录交接会话已过期（当前纪元 {current_epoch}，交接纪元 {}）",
                    handoff.main_epoch
                ));
            }
            if handoff.window_session != window_session && window_session != "quickbar" {
                return Err("INVALID_WINDOW_SESSION：快速记录条交接会话令牌不匹配".into());
            }
            if let Some(r_id) = record_id {
                if handoff.record_id.as_deref() != Some(r_id) {
                    return Err("INVALID_WINDOW_SESSION：快速记录条交接记录 ID 与绑定不一致".into());
                }
            }
            return Ok(IdeaWindowRegistration {
                window_label: "quickbar".into(),
                window_session: handoff.window_session.clone(),
                main_epoch: handoff.main_epoch,
                target_kind: if handoff.record_id.is_some() { "record".into() } else { "draft".into() },
                record_id: handoff.record_id.clone(),
                draft_id: Some(handoff.draft_id.clone()),
                draft_version: None,
                create_operation_id: Some(handoff.create_operation_id.clone()),
                initial_draft: None,
                ready: true,
            });
        }

        let reg = self
            .windows
            .get(caller_label)
            .ok_or_else(|| format!("INVALID_WINDOW_SESSION：窗口 {caller_label} 未注册"))?;
        if reg.main_epoch != current_epoch {
            return Err(format!(
                "EPOCH_MISMATCH：窗口会话纪元已过期（当前纪元 {current_epoch}，窗口纪元 {}）",
                reg.main_epoch
            ));
        }
        if reg.window_session != window_session {
            return Err("INVALID_WINDOW_SESSION：窗口会话令牌不匹配".into());
        }
        if let Some(r_id) = record_id {
            if reg.record_id.as_deref() != Some(r_id) {
                return Err("INVALID_WINDOW_SESSION：请求的 recordId 与当前窗口绑定不一致".into());
            }
        }
        if let Some(d_id) = draft_id {
            if reg.draft_id.as_deref() != Some(d_id) {
                return Err("INVALID_WINDOW_SESSION：请求的 draftId 与当前窗口绑定不一致".into());
            }
        }
        Ok(reg.clone())
    }

    pub fn remove_window(&mut self, window_label: &str) -> Option<IdeaWindowRegistration> {
        self.windows.remove(window_label)
    }

    pub fn registered_windows(&self) -> Vec<IdeaWindowRegistration> {
        let mut list: Vec<_> = self.windows.values().cloned().collect();
        list.sort_by(|a, b| a.window_label.cmp(&b.window_label));
        list
    }

}

pub fn registered_window_states(app: &tauri::AppHandle) -> Result<Vec<(String, bool)>, String> {
    let state = app.state::<IdeaWindows>();
    let reg = state.0.lock().map_err(|e| e.to_string())?;
    Ok(reg
        .registered_windows()
        .into_iter()
        .map(|w| (w.window_label, w.ready))
        .collect())
}

fn current_work_area(app: &tauri::AppHandle) -> Option<WorkArea> {
    let ref_win = app
        .get_webview_window("main")
        .or_else(|| app.get_webview_window("quickbar"));
    let monitor = ref_win.and_then(|w| w.current_monitor().ok().flatten().or_else(|| w.primary_monitor().ok().flatten()))?;
    let area = monitor.work_area();
    Some(WorkArea {
        x: area.position.x,
        y: area.position.y,
        width: area.size.width,
        height: area.size.height,
    })
}

fn spawn_native_idea_window(app: &tauri::AppHandle, label: &str) -> Result<WebviewWindow, String> {
    let window = tauri::WebviewWindowBuilder::new(app, label, WebviewUrl::App("idea.html".into()))
        .title("单轨 · 想法笔记")
        .inner_size(1000.0, 720.0)
        .min_inner_size(640.0, 460.0)
        .resizable(true)
        .maximizable(true)
        .minimizable(true)
        .decorations(false)
        .visible(true)
        .build()
        .map_err(|e| format!("无法创建想法笔记窗口：{e}"))?;

    if let Ok(scale) = window.scale_factor() {
        let req_w = (1000.0 * scale).round() as u32;
        let req_h = (720.0 * scale).round() as u32;
        if let Some(area) = current_work_area(app) {
            let (x, y, w, h) = fit_idea_window_bounds(req_w, req_h, area);
            let _ = window.set_size(PhysicalSize::new(w, h));
            let _ = window.set_position(PhysicalPosition::new(x, y));
        }
    }
    let _ = window.show();
    let _ = window.set_focus();

    let target = window.clone();
    let owned_label = label.to_string();
    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = target.emit_to(
                &owned_label,
                "idea-window-close-requested",
                serde_json::json!({ "targetLabel": owned_label }),
            );
        }
        WindowEvent::Destroyed => {
            let app_handle = target.app_handle();
            let was_still_registered = {
                let state = app_handle.state::<IdeaWindows>();
                state.0.lock().map(|mut reg| {
                    let intentional = reg.closing.remove(&owned_label);
                    let removed = reg.remove_window(&owned_label);
                    removed.is_some() && !intentional
                }).unwrap_or(false)
            };
            if was_still_registered {
                crate::quick_save::on_idea_window_unexpected_destroy(app_handle, &owned_label);
            }
        }
        _ => {}
    });

    Ok(window)
}

#[tauri::command]
pub async fn open_idea_window(
    window: WebviewWindow,
    app: tauri::AppHandle,
    record_id: String,
    initial_draft: Option<serde_json::Value>,
) -> Result<OpenIdeaWindowResult, String> {
    if window.label() != "main" {
        return Err("PERMISSION_DENIED：仅主窗口可按记录 ID 打开想法笔记窗口".into());
    }
    crate::quick_save::check_ready_for_window(&app)?;
    let _label = record_window_label(&record_id)?;
    let main_epoch = crate::main_session::current_main_epoch();

    tauri::async_runtime::spawn_blocking(move || {
        let _guard = CREATE_LOCK.lock().map_err(|e| e.to_string())?;
        let state = app.state::<IdeaWindows>();

        let existing = {
            let reg = state.0.lock().map_err(|e| e.to_string())?;
            reg.find_by_record_id(&record_id)
        };
        if let Some(reg) = existing {
            if let Some(existing_win) = app.get_webview_window(&reg.window_label) {
                let _ = existing_win.unminimize();
                let _ = existing_win.show();
                let _ = existing_win.set_focus();
                let _ = app.emit_to(
                    &reg.window_label,
                    "idea-window-focus",
                    serde_json::json!({
                        "recordId": record_id,
                        "mainEpoch": main_epoch,
                        "initialDraft": initial_draft,
                    }),
                );
                return Ok(OpenIdeaWindowResult {
                    action: "focused".into(),
                    window_label: reg.window_label,
                    window_session: reg.window_session,
                    main_epoch: reg.main_epoch,
                    record_id: Some(record_id),
                    draft_id: reg.draft_id,
                });
            }
            let mut reg_lock = state.0.lock().map_err(|e| e.to_string())?;
            reg_lock.remove_window(&reg.window_label);
        }

        let reg = {
            let mut reg_lock = state.0.lock().map_err(|e| e.to_string())?;
            reg_lock.register_record_window(&record_id, main_epoch, initial_draft)?
        };
        if let Err(err) = spawn_native_idea_window(&app, &reg.window_label) {
            if let Ok(mut reg_lock) = state.0.lock() {
                reg_lock.remove_window(&reg.window_label);
            }
            return Err(err);
        }
        Ok(OpenIdeaWindowResult {
            action: "opened".into(),
            window_label: reg.window_label,
            window_session: reg.window_session,
            main_epoch: reg.main_epoch,
            record_id: Some(record_id),
            draft_id: None,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn open_idea_draft_window(
    window: WebviewWindow,
    app: tauri::AppHandle,
    draft_id: String,
    draft_version: u64,
    create_operation_id: String,
    snapshot: serde_json::Value,
) -> Result<OpenIdeaWindowResult, String> {
    let caller = window.label().to_string();
    if caller != "quickbar" && caller != "main" {
        return Err("PERMISSION_DENIED：仅快速记录条或主窗口可发起想法草稿独立窗交接".into());
    }
    crate::quick_save::check_ready_for_window(&app)?;
    let _label = draft_window_label(&draft_id)?;
    let main_epoch = crate::main_session::current_main_epoch();

    tauri::async_runtime::spawn_blocking(move || {
        let _guard = CREATE_LOCK.lock().map_err(|e| e.to_string())?;
        let state = app.state::<IdeaWindows>();

        let existing = {
            let reg = state.0.lock().map_err(|e| e.to_string())?;
            reg.find_by_draft_id(&draft_id)
        };
        if let Some(reg) = existing {
            if let Some(existing_win) = app.get_webview_window(&reg.window_label) {
                let _ = existing_win.unminimize();
                let _ = existing_win.show();
                let _ = existing_win.set_focus();
                let _ = app.emit_to(
                    &reg.window_label,
                    "idea-window-focus",
                    serde_json::json!({
                        "draftId": draft_id,
                        "recordId": reg.record_id,
                        "mainEpoch": main_epoch,
                    }),
                );
                return Ok(OpenIdeaWindowResult {
                    action: "focused".into(),
                    window_label: reg.window_label,
                    window_session: reg.window_session,
                    main_epoch: reg.main_epoch,
                    record_id: reg.record_id,
                    draft_id: Some(draft_id),
                });
            }
            let mut reg_lock = state.0.lock().map_err(|e| e.to_string())?;
            reg_lock.remove_window(&reg.window_label);
        }

        let reg = {
            let mut reg_lock = state.0.lock().map_err(|e| e.to_string())?;
            reg_lock.register_draft_window(&draft_id, draft_version, &create_operation_id, main_epoch, snapshot.clone())?
        };
        if let Err(err) = spawn_native_idea_window(&app, &reg.window_label) {
            if let Ok(mut reg_lock) = state.0.lock() {
                reg_lock.remove_window(&reg.window_label);
                reg_lock.handoffs.remove(&draft_id);
            }
            return Err(err);
        }
        let _ = app.emit_to(
            "main",
            "idea-draft-handoff",
            serde_json::json!({
                "draftId": draft_id,
                "draftVersion": draft_version,
                "createOperationId": create_operation_id,
                "windowLabel": reg.window_label,
                "windowSession": reg.window_session,
                "mainEpoch": main_epoch,
                "snapshot": snapshot,
            }),
        );
        Ok(OpenIdeaWindowResult {
            action: "opened".into(),
            window_label: reg.window_label,
            window_session: reg.window_session,
            main_epoch: reg.main_epoch,
            record_id: None,
            draft_id: Some(draft_id),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn idea_window_hello(window: WebviewWindow, state: State<IdeaWindows>) -> Result<IdeaWindowRegistration, String> {
    let mut reg = state.0.lock().map_err(|e| e.to_string())?;
    reg.mark_ready(window.label())
}

#[tauri::command]
pub fn idea_window_send(
    window: WebviewWindow,
    app: tauri::AppHandle,
    state: State<IdeaWindows>,
    payload: serde_json::Value,
) -> Result<(), String> {
    let caller_label = window.label().to_string();
    let window_session = payload
        .get("windowSession")
        .and_then(|v| v.as_str())
        .ok_or("INVALID_WINDOW_SESSION：请求缺少 windowSession")?;
    let main_epoch = payload
        .get("mainEpoch")
        .and_then(|v| v.as_u64())
        .ok_or("EPOCH_MISMATCH：请求缺少 mainEpoch")?;
    let record_id = payload.get("recordId").and_then(|v| v.as_str());
    let draft_id = payload.get("draftId").and_then(|v| v.as_str());
    let current_epoch = crate::main_session::current_main_epoch();

    let verified = {
        let reg = state.0.lock().map_err(|e| e.to_string())?;
        reg.verify_sender(&caller_label, window_session, main_epoch, current_epoch, record_id, draft_id)?
    };

    let mut forwarded = payload;
    if let Some(obj) = forwarded.as_object_mut() {
        obj.insert("callerLabel".into(), serde_json::Value::String(caller_label));
        obj.insert("verifiedSession".into(), serde_json::Value::String(verified.window_session));
        obj.insert("verifiedEpoch".into(), serde_json::Value::Number(verified.main_epoch.into()));
    }
    app.emit_to("main", "idea-window-command", forwarded)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn idea_window_reply(
    window: WebviewWindow,
    app: tauri::AppHandle,
    target_label: String,
    payload: serde_json::Value,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("PERMISSION_DENIED：仅主窗口可发送想法笔记回执".into());
    }
    let mut forwarded = payload;
    if let Some(obj) = forwarded.as_object_mut() {
        obj.insert(
            "targetLabel".into(),
            serde_json::Value::String(target_label.clone()),
        );
    }
    app.emit_to(&target_label, "idea-window-reply", forwarded)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn idea_window_notify_committed(
    window: WebviewWindow,
    app: tauri::AppHandle,
    state: State<IdeaWindows>,
    payload: serde_json::Value,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("PERMISSION_DENIED：仅主窗口可广播想法已提交事件".into());
    }
    let labels: Vec<String> = {
        let reg = state.0.lock().map_err(|e| e.to_string())?;
        reg.registered_windows().into_iter().map(|w| w.window_label).collect()
    };
    for label in labels {
        let _ = app.emit_to(&label, "idea-window-committed", payload.clone());
    }
    let _ = app.emit_to("quickbar", "idea-window-committed", payload);
    Ok(())
}

#[tauri::command]
pub fn rebind_idea_draft_window(
    window: WebviewWindow,
    state: State<IdeaWindows>,
    draft_id: String,
    record_id: String,
) -> Result<Option<String>, String> {
    if window.label() != "main" {
        return Err("PERMISSION_DENIED：仅主窗口可重绑草稿窗口记录 ID".into());
    }
    let mut reg = state.0.lock().map_err(|e| e.to_string())?;
    reg.rebind_draft_to_record(&draft_id, &record_id)
}

#[tauri::command]
pub fn close_idea_window(window: WebviewWindow, state: State<IdeaWindows>) -> Result<(), String> {
    let label = window.label().to_string();
    if !label.starts_with("idea-") {
        return Err("PERMISSION_DENIED：仅想法笔记独立窗口可调用关闭".into());
    }
    destroy_registered_window(&state, &label, || window.destroy().map_err(|e| e.to_string()))
}

// Keep failed windows registered; Destroyed may fire during destroy(), so distinguish
// intentional closes without removing their registrations before the native call.
fn destroy_registered_window(
    state: &IdeaWindows,
    label: &str,
    destroy: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    {
        let mut reg = state.0.lock().map_err(|e| e.to_string())?;
        if !reg.windows.contains_key(label) {
            return Err(format!("想法笔记窗口未注册：{label}"));
        }
        reg.closing.insert(label.to_string());
    }
    let result = destroy();
    let mut reg = state.0.lock().map_err(|e| e.to_string())?;
    reg.closing.remove(label);
    match result {
        Ok(()) => {
            reg.remove_window(label);
            Ok(())
        }
        Err(error) => Err(format!("无法关闭想法笔记窗口 {label}：{error}")),
    }
}

#[tauri::command]
pub fn close_all_idea_windows(
    window: WebviewWindow,
    app: tauri::AppHandle,
    state: State<IdeaWindows>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("PERMISSION_DENIED：仅主窗口可清理所有想法笔记窗口".into());
    }
    let labels = {
        let reg = state.0.lock().map_err(|e| e.to_string())?;
        reg.registered_windows().into_iter().map(|r| r.window_label).collect::<Vec<_>>()
    };
    for label in labels {
        destroy_registered_window(&state, &label, || {
            let w = app.get_webview_window(&label)
                .ok_or_else(|| format!("找不到原生窗口：{label}"))?;
            w.destroy().map_err(|e| e.to_string())
        })?;
    }
    state.0.lock().map_err(|e| e.to_string())?.handoffs.clear();
    Ok(())
}

#[cfg(test)]
#[path = "../../evidence/0.3.3-coder6-native-close-review-r8.rs"]
mod coder6_native_close_review;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_native_destroy_keeps_registration_and_success_removes_only_its_window() {
        let state = IdeaWindows::default();
        let a = "123e4567-e89b-12d3-a456-426614174000";
        let b = "123e4567-e89b-12d3-a456-426614174001";
        let (label_a, label_b) = {
            let mut reg = state.0.lock().unwrap();
            (
                reg.register_record_window(a, 1, None).unwrap().window_label,
                reg.register_record_window(b, 1, None).unwrap().window_label,
            )
        };
        let error = destroy_registered_window(&state, &label_a, || Err("native failure".into())).unwrap_err();
        assert!(error.contains("native failure"));
        {
            let reg = state.0.lock().unwrap();
            assert!(reg.windows.contains_key(&label_a));
            assert!(reg.windows.contains_key(&label_b));
            assert!(reg.closing.is_empty());
        }
        destroy_registered_window(&state, &label_a, || Ok(())).unwrap();
        let reg = state.0.lock().unwrap();
        assert!(!reg.windows.contains_key(&label_a));
        assert!(reg.windows.contains_key(&label_b));
        assert!(reg.closing.is_empty());
    }

    #[test]
    fn validates_uuid_and_constructs_safe_window_labels() {
        let valid = "123e4567-e89b-12d3-a456-426614174000";
        assert!(is_valid_uuid(valid));
        assert_eq!(record_window_label(valid).unwrap(), format!("idea-{valid}"));
        assert_eq!(draft_window_label(valid).unwrap(), format!("idea-draft-{valid}"));

        for invalid in [
            "",
            "qb-draft",
            "../records/123",
            "123e4567_e89b_12d3_a456_426614174000",
            "123e4567-e89b-12d3-a456-42661417400z",
        ] {
            assert!(!is_valid_uuid(invalid), "must reject {invalid}");
            assert!(record_window_label(invalid).is_err());
            assert!(draft_window_label(invalid).is_err());
        }
    }

    #[test]
    fn fits_idea_window_within_work_area_and_centers_it() {
        let area = WorkArea { x: 0, y: 0, width: 1920, height: 1040 };
        assert_eq!(fit_idea_window_bounds(1000, 720, area), (460, 160, 1000, 720));

        let small_area = WorkArea { x: 100, y: 50, width: 800, height: 600 };
        assert_eq!(fit_idea_window_bounds(1000, 720, small_area), (100, 50, 800, 600));
    }

    #[test]
    fn verifies_sender_label_session_epoch_and_supports_draft_to_record_rebinding() {
        let mut reg = Registry::default();
        let rec_id = "11111111-1111-4111-8111-111111111111";
        let draft_id = "22222222-2222-4222-8222-222222222222";
        let created_id = "33333333-3333-4333-8333-333333333333";

        let r_win = reg.register_record_window(rec_id, 5, None).unwrap();
        assert!(!r_win.ready);
        let r_ready = reg.mark_ready(&r_win.window_label).unwrap();
        assert!(r_ready.ready);

        // Valid record window sender
        assert!(reg
            .verify_sender(&r_win.window_label, &r_win.window_session, 5, 5, Some(rec_id), None)
            .is_ok());

        // Wrong epoch rejected
        let epoch_err = reg
            .verify_sender(&r_win.window_label, &r_win.window_session, 4, 5, Some(rec_id), None)
            .unwrap_err();
        assert!(epoch_err.starts_with("EPOCH_MISMATCH"));

        // Spoofed label or wrong session rejected
        assert!(reg
            .verify_sender("idea-other", &r_win.window_session, 5, 5, Some(rec_id), None)
            .is_err());
        assert!(reg
            .verify_sender(&r_win.window_label, "wrong-session", 5, 5, Some(rec_id), None)
            .is_err());

        // Draft registration binds both quickbar and idea-draft-<uuid>
        let d_win = reg
            .register_draft_window(draft_id, 1, "op-create-1", 5, serde_json::json!({"title":"t"}))
            .unwrap();
        assert!(reg
            .verify_sender(&d_win.window_label, &d_win.window_session, 5, 5, None, Some(draft_id))
            .is_ok());
        assert!(reg
            .verify_sender("quickbar", &d_win.window_session, 5, 5, None, Some(draft_id))
            .is_ok());

        // Rebind draft to created record ID without changing window_label
        let rebound_label = reg.rebind_draft_to_record(draft_id, created_id).unwrap();
        assert_eq!(rebound_label.as_deref(), Some(d_win.window_label.as_str()));
        let lookup = reg.find_by_record_id(created_id).unwrap();
        assert_eq!(lookup.window_label, d_win.window_label);
        assert_eq!(lookup.record_id.as_deref(), Some(created_id));
        assert!(reg
            .verify_sender(
                &d_win.window_label,
                &d_win.window_session,
                5,
                5,
                Some(created_id),
                Some(draft_id)
            )
            .is_ok());
        assert!(reg
            .verify_sender("quickbar", &d_win.window_session, 5, 5, Some(created_id), Some(draft_id))
            .is_ok());
    }
}
