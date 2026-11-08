use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Mutex,
    },
};
use tauri::{Emitter, Manager, State, WebviewWindow};

static CHECK_SEQ: AtomicU64 = AtomicU64::new(0);

fn next_check_seq() -> u64 {
    CHECK_SEQ.fetch_add(1, Ordering::SeqCst) + 1
}

#[derive(Debug, Clone)]
pub struct DraftCheckResponse {
    pub window_label: String,
    pub dirty: bool,
    pub saving: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftCheckEventPayload {
    pub target_label: String,
    pub request_id: String,
    pub generation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaintenanceCheckResultDto {
    pub ok: bool,
    pub request_id: Option<String>,
    pub error: Option<String>,
}

struct PendingDraftCheck {
    request_id: String,
    expected: HashSet<String>,
    responses: HashMap<String, DraftCheckResponse>,
    sender: mpsc::Sender<Result<Option<DraftCheckResponse>, String>>,
}

#[derive(Default)]
struct Gate {
    active: HashSet<String>,
    installing: bool,
    migrating: bool,
    guard_ready: bool,
    main_guard_ready: bool,
    pending_check: Option<PendingDraftCheck>,
    active_check_request_id: Option<String>,
    completed_clean_request_id: Option<String>,
    active_check_generation: u64,
    active_check_targets: Vec<String>,
    last_dirty_window: Option<String>,
}

pub struct QuickSaves(Mutex<Gate>);
impl Default for QuickSaves {
    fn default() -> Self {
        // Startup recovery/migration must finish before the independent quickbar can write.
        Self(Mutex::new(Gate {
            migrating: true,
            ..Gate::default()
        }))
    }
}

impl Gate {
    fn begin_migration(&mut self) -> Result<(), String> {
        if self.installing {
            return Err("正在安装更新，不能迁移数据".into());
        }
        if !self.active.is_empty() {
            return Err("快速记录条正在保存，请完成后重试迁移".into());
        }
        self.migrating = true;
        Ok(())
    }
    fn admit(&mut self, id: String) -> Result<(), String> {
        if self.migrating {
            return Err("正在升级数据，稍后再存".into());
        }
        if self.installing {
            return Err("正在安装更新，请在更新完成后保存".into());
        }
        if !self.active.insert(id) {
            return Err("该记录已经在保存".into());
        }
        Ok(())
    }
    fn begin_check(
        &mut self,
        request_id: String,
        expected: HashSet<String>,
    ) -> (Vec<String>, mpsc::Receiver<Result<Option<DraftCheckResponse>, String>>) {
        if self.installing || self.pending_check.is_some() || self.active_check_request_id.is_some() {
            let (sender, receiver) = mpsc::channel();
            let _ = sender.send(Err("已有正在进行的更新草稿检查".into()));
            return (Vec::new(), receiver);
        }
        self.installing = true;
        self.last_dirty_window = None;
        self.completed_clean_request_id = None;
        let mut targets: Vec<String> = expected.iter().cloned().collect();
        targets.sort();
        self.active_check_request_id = Some(request_id.clone());
        self.active_check_targets = targets.clone();
        let (sender, receiver) = mpsc::channel();
        self.pending_check = Some(PendingDraftCheck {
            request_id,
            expected,
            responses: HashMap::new(),
            sender,
        });
        (targets, receiver)
    }
    fn record_ack(
        &mut self,
        window_label: String,
        request_id: Option<&str>,
        dirty: bool,
        saving: bool,
        reason: Option<String>,
    ) -> Result<(), String> {
        let req_id = request_id
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or("缺少草稿检查请求号")?;
        let pending = self
            .pending_check
            .as_mut()
            .ok_or("没有等待中的更新草稿检查")?;
        if req_id != pending.request_id {
            return Err("草稿检查请求号已过期".into());
        }
        if !pending.expected.contains(&window_label) {
            return Err(format!("窗口 {window_label} 不在当前草稿检查集合内"));
        }
        // 同轮重复 ACK 保持幂等，不覆盖已收响应（尤其不覆盖已收 dirty/saving）
        if pending.responses.contains_key(&window_label) {
            return Ok(());
        }
        pending.responses.insert(
            window_label.clone(),
            DraftCheckResponse {
                window_label,
                dirty,
                saving,
                reason,
            },
        );
        if pending.responses.len() >= pending.expected.len() {
            let completed = self.pending_check.take().unwrap();
            let found = evaluate_responses(&completed.responses);
            if found.is_none() {
                self.completed_clean_request_id = Some(completed.request_id.clone());
            } else {
                self.completed_clean_request_id = None;
            }
            let _ = completed.sender.send(Ok(found));
        }
        Ok(())
    }
    fn verify_clean_round(&self, request_id: &str) -> Result<(), String> {
        let req_id = request_id.trim();
        if req_id.is_empty() {
            return Err("缺少草稿检查请求号".into());
        }
        if !self.installing
            || self.pending_check.is_some()
            || self.active_check_request_id.as_deref() != Some(req_id)
            || self.completed_clean_request_id.as_deref() != Some(req_id)
        {
            return Err("草稿检查轮次未通过或已失效".into());
        }
        Ok(())
    }
    fn cancel_check(
        &mut self,
        request_id: Option<&str>,
    ) -> Result<Option<(String, Vec<String>)>, String> {
        let req_id = request_id
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or("缺少草稿检查恢复请求号")?;
        if self.active_check_request_id.as_deref() != Some(req_id) {
            return Err("草稿检查恢复请求号已过期".into());
        }
        self.installing = false;
        self.pending_check = None;
        self.completed_clean_request_id = None;
        self.active_check_generation = 0;
        if let Some(active_id) = self.active_check_request_id.take() {
            let targets = std::mem::take(&mut self.active_check_targets);
            Ok(Some((active_id, targets)))
        } else {
            self.active_check_targets.clear();
            Ok(None)
        }
    }
}

fn evaluate_responses(responses: &HashMap<String, DraftCheckResponse>) -> Option<DraftCheckResponse> {
    let mut keys: Vec<&String> = responses.keys().collect();
    keys.sort_by(|a, b| {
        let rank = |k: &str| {
            if k == "main" {
                0
            } else if k == "quickbar" {
                1
            } else {
                2
            }
        };
        rank(a).cmp(&rank(b)).then_with(|| a.cmp(b))
    });
    for key in keys {
        if let Some(resp) = responses.get(key) {
            if resp.saving || resp.dirty {
                return Some(resp.clone());
            }
        }
    }
    None
}

#[tauri::command]
pub fn begin_data_migration(app: tauri::AppHandle, state: State<QuickSaves>) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .begin_migration()?;
    crate::mcp_bridge::set_recovering(&app);
    Ok(())
}

#[tauri::command]
pub fn finish_data_migration(state: State<QuickSaves>) -> Result<(), String> {
    state.0.lock().map_err(|error| error.to_string())?.migrating = false;
    Ok(())
}

pub fn check_ready(state: State<QuickSaves>) -> Result<(), String> {
    let gate = state.0.lock().map_err(|error| error.to_string())?;
    if gate.migrating {
        return Err("MIGRATING：正在升级数据，稍后再试".into());
    }
    if gate.installing {
        return Err("UPDATING：正在安装更新，请在更新完成后重试".into());
    }
    Ok(())
}

pub fn check_ready_for_window(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<QuickSaves>();
    let gate = state.0.lock().map_err(|error| error.to_string())?;
    if gate.migrating {
        return Err("MIGRATING：正在升级数据，稍后再试".into());
    }
    if gate.installing {
        return Err("UPDATING：正在执行维护或安装更新，暂时不能打开新编辑窗口".into());
    }
    Ok(())
}

pub fn is_main_ready(app: &tauri::AppHandle) -> bool {
    let state = app.state::<QuickSaves>();
    let Ok(gate) = state.0.lock() else {
        return false;
    };
    gate.main_guard_ready && !gate.migrating
}

pub fn begin_prepare_install(app: &tauri::AppHandle) -> Result<String, String> {
    let state = app.state::<QuickSaves>();
    let mut gate = state.0.lock().map_err(|error| error.to_string())?;
    if gate.migrating {
        return Err("正在升级数据，请完成后重试安装更新".into());
    }
    if gate.installing || gate.pending_check.is_some() || gate.active_check_request_id.is_some() {
        return Err("已有正在进行的草稿检查或更新安装，请稍后重试".into());
    }
    let generation = next_check_seq();
    let req_id = format!("dc-prep-{generation}");
    gate.installing = true;
    gate.last_dirty_window = None;
    gate.completed_clean_request_id = None;
    gate.active_check_request_id = Some(req_id.clone());
    gate.active_check_generation = generation;
    gate.active_check_targets.clear();
    Ok(req_id)
}

#[tauri::command]
pub fn begin_maintenance_check(app: tauri::AppHandle) -> Result<(), String> {
    begin_prepare_install(&app).map(|_| ())
}

#[tauri::command]
pub fn quickbar_update_ready(state: State<QuickSaves>) -> Result<(), String> {
    state.0.lock().map_err(|error| error.to_string())?.guard_ready = true;
    Ok(())
}

#[tauri::command]
pub fn main_update_ready(state: State<QuickSaves>) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .main_guard_ready = true;
    Ok(())
}

#[tauri::command]
pub fn ack_quickbar_update(
    window: WebviewWindow,
    state: State<QuickSaves>,
    request_id: Option<String>,
    dirty: bool,
) -> Result<(), String> {
    let caller = window.label().to_string();
    if caller != "quickbar" {
        return Err("只有快速记录窗口可以应答快速记录草稿检查".into());
    }
    let mut gate = state.0.lock().map_err(|error| error.to_string())?;
    gate.record_ack(
        caller,
        request_id.as_deref(),
        dirty,
        false,
        if dirty {
            Some("快速记录条还有未保存内容，请保存或清空后重试安装更新".into())
        } else {
            None
        },
    )
}

#[tauri::command]
pub fn ack_draft_check(
    window: WebviewWindow,
    state: State<QuickSaves>,
    request_id: Option<String>,
    dirty: bool,
    saving: Option<bool>,
    reason: Option<String>,
) -> Result<(), String> {
    let caller = window.label().to_string();
    let mut gate = state.0.lock().map_err(|error| error.to_string())?;
    gate.record_ack(
        caller,
        request_id.as_deref(),
        dirty,
        saving.unwrap_or(false),
        reason,
    )
}

pub fn on_idea_window_unexpected_destroy(app: &tauri::AppHandle, window_label: &str) {
    let state = app.state::<QuickSaves>();
    let Ok(mut gate) = state.0.lock() else {
        return;
    };
    let should_fail = gate
        .pending_check
        .as_ref()
        .map(|p| p.expected.contains(window_label) && !p.responses.contains_key(window_label))
        .unwrap_or(false);
    if should_fail {
        if let Some(pending) = gate.pending_check.take() {
            let _ = pending.sender.send(Err(format!(
                "想法笔记窗口（{window_label}）在检查草稿期间异常关闭，无法确认草稿状态"
            )));
        }
    }
}

#[tauri::command]
pub fn begin_quick_save(state: State<QuickSaves>, id: String) -> Result<(), String> {
    let mut gate = state.0.lock().map_err(|error| error.to_string())?;
    gate.admit(id)
}

#[tauri::command]
pub fn end_quick_save(state: State<QuickSaves>, id: String) -> Result<(), String> {
    let mut gate = state.0.lock().map_err(|error| error.to_string())?;
    if !gate.active.remove(&id) {
        return Err("没有对应的快速记录保存会话".into());
    }
    Ok(())
}

pub fn ensure_active(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let state = app.state::<QuickSaves>();
    let gate = state.0.lock().map_err(|error| error.to_string())?;
    if !gate.active.contains(id) {
        return Err("快速记录必须在完整保存会话内写入".into());
    }
    Ok(())
}

async fn check_all_drafts_owned(
    app: &tauri::AppHandle,
    purpose: &str,
    prepared_install_request_id: Option<&str>,
) -> Result<String, (Option<String>, String)> {
    let state = app.state::<QuickSaves>();

    let idea_windows = crate::idea_windows::registered_window_states(app)
        .map_err(|err| (None, err))?;
    for (label, ready) in &idea_windows {
        if !*ready || app.get_webview_window(label).is_none() {
            return Err((
                None,
                format!(
                    "想法笔记窗口（{label}）尚未就绪，无法安全检查草稿，请稍后重试{purpose}"
                ),
            ));
        }
    }

    let (request_id, generation, targets, receiver) = {
        let mut gate = state.0.lock().map_err(|error| (None, error.to_string()))?;
        if gate.migrating {
            return Err((None, format!("正在升级数据，请完成后重试{purpose}")));
        }
        if gate.active.iter().any(|id| id.starts_with("mcp-")) {
            return Err((None, format!("外部应用请求正在保存，请完成后重试{purpose}")));
        }
        if !gate.active.is_empty() {
            let _ = gate.last_dirty_window.insert("quickbar".into());
            return Err((None, format!("快速记录条正在保存，请完成后重试{purpose}")));
        }
        if !gate.guard_ready {
            return Err((
                None,
                format!("快速记录条尚未就绪，无法安全检查草稿，请稍后重试{purpose}"),
            ));
        }
        if let Some(prep_id) = prepared_install_request_id {
            if !gate.installing
                || gate.pending_check.is_some()
                || gate.active_check_request_id.as_deref() != Some(prep_id)
            {
                return Err((None, format!("已有正在进行的草稿检查，请稍后重试{purpose}")));
            }
            gate.installing = false;
            gate.active_check_request_id = None;
            gate.active_check_generation = 0;
        } else if gate.installing
            || gate.pending_check.is_some()
            || gate.active_check_request_id.is_some()
        {
            return Err((None, format!("已有正在进行的草稿检查，请稍后重试{purpose}")));
        }

        let mut expected = HashSet::new();
        expected.insert("quickbar".to_string());
        if gate.main_guard_ready {
            expected.insert("main".to_string());
        }
        for (label, _) in &idea_windows {
            expected.insert(label.clone());
        }

        let generation = next_check_seq();
        let request_id = format!("dc-{generation}");
        let (targets, receiver) = gate.begin_check(request_id.clone(), expected);
        gate.active_check_generation = generation;
        (request_id, generation, targets, receiver)
    };

    let quickbar = app
        .get_webview_window("quickbar")
        .ok_or_else(|| (Some(request_id.clone()), "快速记录窗口不存在".to_string()))?;
    quickbar
        .hide()
        .map_err(|error| (Some(request_id.clone()), error.to_string()))?;

    for target in &targets {
        app.emit_to(
            target,
            "update-check-draft",
            DraftCheckEventPayload {
                target_label: target.clone(),
                request_id: request_id.clone(),
                generation,
            },
        )
        .map_err(|error| (Some(request_id.clone()), error.to_string()))?;
    }

    let recv_res = tauri::async_runtime::spawn_blocking(move || receiver.recv())
        .await
        .map_err(|error| (Some(request_id.clone()), error.to_string()))?
        .map_err(|_| (Some(request_id.clone()), format!("草稿检查已取消或中断，已中止{purpose}")))?;
    let outcome = recv_res.map_err(|err| (Some(request_id.clone()), err))?;

    if let Some(dirty_resp) = outcome {
        if let Ok(mut gate) = state.0.lock() {
            gate.last_dirty_window = Some(dirty_resp.window_label.clone());
        }
        let default_msg = if dirty_resp.window_label == "quickbar" {
            format!("快速记录条还有未保存内容，请保存或清空后重试{purpose}")
        } else if dirty_resp.window_label == "main" {
            format!("主窗口还有未保存的想法编辑或插入草稿，请先保存或取消后重试{purpose}")
        } else {
            format!("想法笔记窗口还有未保存内容，请先保存或放弃修改后重试{purpose}")
        };
        return Err((
            Some(request_id),
            dirty_resp.reason.unwrap_or(default_msg),
        ));
    }

    Ok(request_id)
}

pub async fn prepare_install(
    app: &tauri::AppHandle,
    prep_request_id: Option<&str>,
) -> Result<String, (Option<String>, String)> {
    let prep_id = prep_request_id
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| (None, "缺少安装准备请求号".to_string()))?;
    check_all_drafts_owned(app, "安装更新", Some(prep_id)).await
}

#[tauri::command]
pub async fn check_drafts_for_maintenance(
    app: tauri::AppHandle,
    purpose: Option<String>,
) -> Result<MaintenanceCheckResultDto, String> {
    match check_all_drafts_owned(&app, purpose.as_deref().unwrap_or("维护操作"), None).await {
        Ok(request_id) => Ok(MaintenanceCheckResultDto {
            ok: true,
            request_id: Some(request_id),
            error: None,
        }),
        Err((Some(request_id), error)) => Ok(MaintenanceCheckResultDto {
            ok: false,
            request_id: Some(request_id),
            error: Some(error),
        }),
        Err((None, error)) => Err(error),
    }
}

pub fn cancel_install_with_request(
    app: &tauri::AppHandle,
    request_id: Option<&str>,
) -> Result<(), String> {
    let state = app.state::<QuickSaves>();
    let restored = {
        let mut gate = state.0.lock().map_err(|error| error.to_string())?;
        let gen = gate.active_check_generation;
        gate.cancel_check(request_id)?
            .map(|(req_id, targets)| (req_id, gen, targets))
    };
    if let Some((restore_request_id, restore_gen, mut targets)) = restored {
        let generation = if restore_gen > 0 {
            restore_gen
        } else {
            next_check_seq()
        };
        if let Ok(idea_windows) = crate::idea_windows::registered_window_states(app) {
            for (label, _) in idea_windows {
                if !targets.contains(&label) {
                    targets.push(label);
                }
            }
        }
        let mut emit_errors = Vec::new();
        for target in targets {
            if let Err(err) = app.emit_to(
                &target,
                "draft-check-restore",
                DraftCheckEventPayload {
                    target_label: target.clone(),
                    request_id: restore_request_id.clone(),
                    generation,
                },
            ) {
                emit_errors.push(format!("{target}: {err}"));
            }
        }
        if !emit_errors.is_empty() {
            return Err(format!(
                "解除维护检查状态时恢复窗口交互通知失败：{}",
                emit_errors.join("；")
            ));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn cancel_maintenance_check(
    app: tauri::AppHandle,
    request_id: Option<String>,
) -> Result<(), String> {
    cancel_install_with_request(&app, request_id.as_deref())
}

#[tauri::command]
pub fn focus_dirty_window(app: tauri::AppHandle, state: State<QuickSaves>) -> Result<Option<String>, String> {
    let target = {
        let mut gate = state.0.lock().map_err(|error| error.to_string())?;
        gate.last_dirty_window.take()
    };
    if let Some(label) = &target {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
    Ok(target)
}

#[tauri::command]
pub async fn perform_app_exit(
    window: WebviewWindow,
    app: tauri::AppHandle,
    state: State<'_, QuickSaves>,
    request_id: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("只有主窗口可以执行退出".into());
    }
    {
        let gate = state.0.lock().map_err(|error| error.to_string())?;
        gate.verify_clean_round(&request_id)?;
    }
    app.exit(0);
    Ok(())
}

pub async fn perform_app_exit_from_tray(app: tauri::AppHandle) -> Result<(), String> {
    match check_all_drafts_owned(&app, "退出单轨", None).await {
        Ok(req_id) => {
            let state = app.state::<QuickSaves>();
            let gate = state.0.lock().map_err(|error| error.to_string())?;
            gate.verify_clean_round(&req_id)?;
            drop(gate);
            app.exit(0);
            Ok(())
        }
        Err((owned_req_id, error)) => {
            if let Some(req_id) = owned_req_id.as_deref() {
                let _ = cancel_install_with_request(&app, Some(req_id));
            }
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migration_blocks_new_saves_and_preserves_existing_sessions() {
        let mut gate = Gate::default();
        gate.admit("first".into()).unwrap();
        assert!(gate.begin_migration().is_err());
        assert!(gate.active.contains("first"));
        gate.active.remove("first");
        gate.begin_migration().unwrap();
        assert_eq!(gate.admit("second".into()).unwrap_err(), "正在升级数据，稍后再存");
        gate.migrating = false;
        gate.admit("second".into()).unwrap();
    }

    #[test]
    fn multi_window_draft_check_collects_all_acks_and_identifies_dirty_or_saving_window() {
        let mut gate = Gate::default();
        let mut expected = HashSet::new();
        expected.insert("main".into());
        expected.insert("quickbar".into());
        expected.insert("idea-11111111-1111-4111-8111-111111111111".into());
        let (_targets, rx) = gate.begin_check("dc-1".into(), expected);

        gate.record_ack("main".into(), Some("dc-1"), false, false, None)
            .unwrap();
        assert!(rx.try_recv().is_err(), "must wait for all expected windows");

        gate.record_ack("quickbar".into(), Some("dc-1"), false, false, None)
            .unwrap();
        assert!(rx.try_recv().is_err(), "must wait for idea window");

        gate.record_ack(
            "idea-11111111-1111-4111-8111-111111111111".into(),
            Some("dc-1"),
            true,
            false,
            Some("想法笔记有未保存修改".into()),
        )
        .unwrap();

        let result = rx.try_recv().unwrap().unwrap().unwrap();
        assert_eq!(
            result.window_label,
            "idea-11111111-1111-4111-8111-111111111111"
        );
        assert!(result.dirty);
        assert_eq!(result.reason.as_deref(), Some("想法笔记有未保存修改"));
    }

    #[test]
    fn draft_check_rejects_missing_stale_or_wrong_target_acks_and_keeps_same_round_duplicates_idempotent() {
        let mut gate = Gate::default();
        let mut expected = HashSet::new();
        expected.insert("main".into());
        expected.insert("quickbar".into());
        expected.insert("idea-a".into());
        let (_targets, rx) = gate.begin_check("dc-10".into(), expected);

        // 1. Missing or empty request_id must be rejected and must not advance pending check
        assert_eq!(
            gate.record_ack("main".into(), None, false, false, None)
                .unwrap_err(),
            "缺少草稿检查请求号"
        );
        assert_eq!(
            gate.record_ack("main".into(), Some("   "), false, false, None)
                .unwrap_err(),
            "缺少草稿检查请求号"
        );

        // 2. Stale/wrong request_id must be rejected and must not advance pending check
        assert_eq!(
            gate.record_ack("main".into(), Some("dc-9"), false, false, None)
                .unwrap_err(),
            "草稿检查请求号已过期"
        );

        // 3. Unregistered/wrong target window must be rejected
        assert_eq!(
            gate.record_ack("idea-unregistered".into(), Some("dc-10"), false, false, None)
                .unwrap_err(),
            "窗口 idea-unregistered 不在当前草稿检查集合内"
        );

        // 4. First valid ACK from idea-a is dirty=true; duplicate ACK from idea-a in the same round with dirty=false
        //    must be idempotent (Ok) and MUST NOT overwrite the already-recorded dirty=true!
        gate.record_ack(
            "idea-a".into(),
            Some("dc-10"),
            true,
            false,
            Some("笔记A有修改".into()),
        )
        .unwrap();
        gate.record_ack("idea-a".into(), Some("dc-10"), false, false, None)
            .unwrap();
        assert!(
            rx.try_recv().is_err(),
            "duplicate ACK from idea-a must not prematurely complete check"
        );

        gate.record_ack("main".into(), Some("dc-10"), false, false, None)
            .unwrap();
        gate.record_ack("quickbar".into(), Some("dc-10"), false, false, None)
            .unwrap();

        let completed = rx.try_recv().unwrap().unwrap().unwrap();
        assert_eq!(completed.window_label, "idea-a");
        assert!(completed.dirty, "duplicate clean ACK must not overwrite dirty=true");
        assert_eq!(completed.reason.as_deref(), Some("笔记A有修改"));

        // 5. Late ACK after check completed must be rejected with 没有等待中的更新草稿检查
        assert_eq!(
            gate.record_ack("main".into(), Some("dc-10"), false, false, None)
                .unwrap_err(),
            "没有等待中的更新草稿检查"
        );

        // 6. Round-bound cancel_check: cancel dc-10 first, then start round dc-11 and verify
        //    stale dc-10 or missing None cannot unlock or cancel dc-11
        let restored10 = gate.cancel_check(Some("dc-10")).unwrap().unwrap();
        assert_eq!(restored10.0, "dc-10");
        let mut expected2 = HashSet::new();
        expected2.insert("main".into());
        expected2.insert("quickbar".into());
        let (_targets2, _rx2) = gate.begin_check("dc-11".into(), expected2);
        assert_eq!(
            gate.cancel_check(Some("dc-10")).unwrap_err(),
            "草稿检查恢复请求号已过期"
        );
        assert_eq!(
            gate.cancel_check(None).unwrap_err(),
            "缺少草稿检查恢复请求号"
        );
        assert!(
            gate.installing && gate.pending_check.is_some(),
            "stale or unbound cancel must not unlock active round dc-11"
        );

        // Cancelling with matching dc-11 succeeds and returns dc-11
        let restored = gate.cancel_check(Some("dc-11")).unwrap().unwrap();
        assert_eq!(restored.0, "dc-11");
        assert!(!gate.installing && gate.pending_check.is_none());
    }
}

#[cfg(test)]
#[path = "../../evidence/0.3.3-coder6-maintenance-gate-review-r6.rs"]
mod coder6_maintenance_review;
