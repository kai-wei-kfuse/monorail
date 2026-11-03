use std::{collections::HashMap, fs, path::PathBuf, sync::{atomic::{AtomicU64, Ordering}, Mutex}};
use tauri::{Emitter, Manager, State};
use tokio::{io::{AsyncBufReadExt, AsyncWriteExt, BufReader}, net::windows::named_pipe::{NamedPipeServer, ServerOptions}, sync::{oneshot, watch}};

type Reply = serde_json::Value;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Phase {
    Starting,
    SetupRequired,
    Recovering,
    Ready { generation: u64 },
    Failed(String),
    HostLost(String),
}

struct PendingRequest {
    generation: u64,
    is_write: bool,
    sender: oneshot::Sender<Result<Reply, String>>,
}

struct BridgeCore {
    started: bool,
    phase: Phase,
    generation: u64,
    active_writes: usize,
    pending: HashMap<String, PendingRequest>,
}

impl Default for BridgeCore {
    fn default() -> Self {
        Self {
            started: false,
            phase: Phase::Starting,
            generation: 0,
            active_writes: 0,
            pending: HashMap::new(),
        }
    }
}

pub struct McpBridge {
    core: Mutex<BridgeCore>,
    phase_tx: watch::Sender<Phase>,
    _phase_rx: watch::Receiver<Phase>,
    sequence: AtomicU64,
}

impl Default for McpBridge {
    fn default() -> Self {
        let (phase_tx, _phase_rx) = watch::channel(Phase::Starting);
        Self {
            core: Mutex::new(BridgeCore::default()),
            phase_tx,
            _phase_rx,
            sequence: AtomicU64::new(0),
        }
    }
}

pub fn is_write_method(method: &str) -> bool {
    !matches!(
        method,
        "get_context" | "get_operation_result" | "find_items" | "get_time_summary" | "list_time_entries"
    )
}

impl BridgeCore {
    fn set_setup_required(&mut self) -> Option<Phase> {
        if matches!(self.phase, Phase::HostLost(_)) {
            return None;
        }
        if self.active_writes > 0 || !self.pending.is_empty() {
            return Some(self.host_lost("主窗口在操作未完成时回到初始化页"));
        }
        self.phase = Phase::SetupRequired;
        Some(self.phase.clone())
    }

    fn set_recovering(&mut self) -> Option<Phase> {
        if matches!(self.phase, Phase::HostLost(_)) {
            return None;
        }
        if self.active_writes > 0 || !self.pending.is_empty() {
            return Some(self.host_lost("主窗口在操作未完成时重新执行恢复"));
        }
        self.phase = Phase::Recovering;
        Some(self.phase.clone())
    }

    fn activate_ready(&mut self) -> Result<(u64, Phase), String> {
        if let Phase::HostLost(reason) = &self.phase {
            return Err(reason.clone());
        }
        if self.active_writes > 0 || !self.pending.is_empty() {
            let phase = self.host_lost("主窗口在写入完成前重载或中断");
            if let Phase::HostLost(reason) = phase {
                return Err(reason);
            }
        }
        self.generation += 1;
        let phase = Phase::Ready { generation: self.generation };
        self.phase = phase.clone();
        Ok((self.generation, phase))
    }

    fn fail_bootstrap(&mut self, error: &str) -> Phase {
        if let Phase::HostLost(reason) = &self.phase {
            return Phase::HostLost(reason.clone());
        }
        if self.active_writes > 0 || !self.pending.is_empty() {
            return self.host_lost("主窗口在操作未完成时发生启动错误");
        }
        let phase = Phase::Failed(format!("RECOVERY_FAILED：单轨启动或数据恢复失败：{error}"));
        self.phase = phase.clone();
        phase
    }

    fn host_lost(&mut self, reason: &str) -> Phase {
        let message = format!(
            "HOST_LOST：{reason}；为保证未完成的文件写入安全，已停止接纳新请求，请完整重启单轨以恢复 journal 并通过 get_operation_result 核对"
        );
        let phase = Phase::HostLost(message);
        self.phase = phase.clone();
        for (_, item) in self.pending.drain() {
            let _ = item.sender.send(Err(
                "RESULT_UNKNOWN：单轨主窗口在返回结果前关闭或中断，操作结果未知；请重启后通过 get_operation_result 核对".into(),
            ));
        }
        phase
    }

    fn register_pending(
        &mut self,
        id: String,
        generation: u64,
        is_write: bool,
        sender: oneshot::Sender<Result<Reply, String>>,
    ) -> Result<(), String> {
        match &self.phase {
            Phase::Ready { generation: current } if *current == generation => {
                if is_write {
                    self.active_writes += 1;
                }
                self.pending.insert(id, PendingRequest { generation, is_write, sender });
                Ok(())
            }
            Phase::SetupRequired => Err("SETUP_REQUIRED：单轨尚未完成首次数据目录初始化，请先打开单轨完成设置".into()),
            Phase::Failed(err) | Phase::HostLost(err) => Err(err.clone()),
            _ => Err("UNAVAILABLE：单轨主窗口状态已改变，请重试".into()),
        }
    }

    fn abort_before_emit(&mut self, id: &str) -> bool {
        if let Some(item) = self.pending.remove(id) {
            if item.is_write {
                self.active_writes = self.active_writes.saturating_sub(1);
            }
            return item.is_write;
        }
        false
    }

    fn complete_reply(&mut self, id: &str, generation: Option<u64>, reply: Reply) -> Result<bool, String> {
        let item = self.pending.remove(id).ok_or("MCP request is no longer pending")?;
        if let Some(gen) = generation {
            if gen != item.generation {
                return Err("MCP reply generation mismatch".into());
            }
        }
        if item.generation != self.generation || matches!(self.phase, Phase::HostLost(_)) {
            return Err("MCP reply from stale WebView generation ignored".into());
        }
        if item.is_write {
            self.active_writes = self.active_writes.saturating_sub(1);
        }
        // Receiver may have closed if the pipe client disconnected after dispatch; the write still completed cleanly.
        let _ = item.sender.send(Ok(reply));
        Ok(item.is_write)
    }
}

fn update_phase(state: &McpBridge, next: Option<Phase>) {
    if let Some(phase) = next {
        let _ = state.phase_tx.send_replace(phase);
    }
}

pub fn set_setup_required(app: &tauri::AppHandle) {
    let state = app.state::<McpBridge>();
    let next = state.core.lock().ok().and_then(|mut core| core.set_setup_required());
    update_phase(&state, next);
}

pub fn set_recovering(app: &tauri::AppHandle) {
    let state = app.state::<McpBridge>();
    let next = state.core.lock().ok().and_then(|mut core| core.set_recovering());
    update_phase(&state, next);
}

pub fn on_host_lost(app: &tauri::AppHandle, reason: &str) {
    let state = app.state::<McpBridge>();
    let next = state.core.lock().ok().map(|mut core| core.host_lost(reason));
    update_phase(&state, next);
}

pub fn write_host_metadata(app: &tauri::AppHandle) -> Result<(), String> {
    let dir = super::config_dir(app)?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let resolve_bundle_entry = |filename: &str| {
        app.path()
            .resource_dir()
            .ok()
            .map(|res| res.join(filename))
            .filter(|path| path.exists())
            .or_else(|| exe.parent().map(|parent| parent.join(filename)))
            .map(|path| {
                let text = path.to_string_lossy().into_owned();
                text.strip_prefix(r"\\?\").map(str::to_owned).unwrap_or(text)
            })
    };
    let mcp_entry = resolve_bundle_entry("monorail-mcp.mjs");
    let cli_entry = resolve_bundle_entry("monorail-cli.mjs");
    let identifier = &app.config().identifier;
    let pipe = format!(r"\\.\pipe\{identifier}.mcp");
    let temp = dir.join("mcp-host.tmp");
    let target = dir.join("mcp-host.json");
    let payload = serde_json::json!({
        "executable": exe,
        "mcp_entry": mcp_entry,
        "cli_entry": cli_entry,
        "identifier": identifier,
        "pipe": pipe,
    });
    fs::write(&temp, serde_json::to_vec_pretty(&payload).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(temp, target).map_err(|e| e.to_string())
}

fn inspect_initial_config(app: &tauri::AppHandle) -> Phase {
    let Ok(dir) = super::config_dir(app) else {
        return Phase::Failed("CONFIG_CORRUPTED：无法访问单轨配置目录".into());
    };
    let path = dir.join("config.json");
    if !path.exists() {
        return Phase::SetupRequired;
    }
    let Ok(text) = fs::read_to_string(&path) else {
        return Phase::Failed("CONFIG_CORRUPTED：无法读取单轨配置文件".into());
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return Phase::Failed("CONFIG_CORRUPTED：单轨配置文件格式损坏".into());
    };
    let Some(root) = value.get("root").and_then(|v| v.as_str()) else {
        return Phase::Failed("CONFIG_CORRUPTED：单轨配置文件缺少数据目录".into());
    };
    let root_path = PathBuf::from(root);
    if !root_path.is_absolute() || !root_path.is_dir() {
        return Phase::Failed("CONFIG_CORRUPTED：单轨数据目录不存在或不是绝对路径".into());
    }
    Phase::Starting
}

fn ensure_listener(app: &tauri::AppHandle, state: &McpBridge) -> Result<(), String> {
    let mut core = state.core.lock().map_err(|e| e.to_string())?;
    if core.started {
        return Ok(());
    }
    let name = format!(r"\\.\pipe\{}.mcp", app.config().identifier);
    let first = tauri::async_runtime::block_on(async {
        ServerOptions::new()
            .first_pipe_instance(true)
            .reject_remote_clients(true)
            .create(&name)
    })
    .map_err(|e| e.to_string())?;
    core.started = true;
    drop(core);
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = serve(handle.clone(), name, first).await;
        if let Err(error) = result {
            eprintln!("MCP bridge stopped: {error}");
            if let Err(e) = handle.emit_to("main", "native-error", format!("MCP bridge stopped: {error}")) {
                eprintln!("{e}");
            }
        }
    });
    Ok(())
}

pub fn setup(app: &tauri::AppHandle) -> Result<(), String> {
    let _ = write_host_metadata(app);
    if let Some(main) = app.get_webview_window("main") {
        if let Ok(visible) = main.is_visible() {
            let _ = super::evidence(app.clone(), format!("mcp-main-visible:{visible}"));
        }
    }
    let state = app.state::<McpBridge>();
    let initial = inspect_initial_config(app);
    {
        let mut core = state.core.lock().map_err(|e| e.to_string())?;
        core.phase = initial.clone();
    }
    let _ = state.phase_tx.send_replace(initial);
    ensure_listener(app, &state)
}

#[tauri::command]
pub fn respond_mcp(
    app: tauri::AppHandle,
    state: State<McpBridge>,
    id: String,
    generation: Option<u64>,
    reply: Reply,
) -> Result<(), String> {
    let is_write = {
        let mut core = state.core.lock().map_err(|e| e.to_string())?;
        core.complete_reply(&id, generation, reply)?
    };
    if is_write {
        crate::quick_save::end_quick_save(app.state(), id)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn start_mcp_bridge(
    app: tauri::AppHandle,
    state: State<'_, McpBridge>,
    error: Option<String>,
) -> Result<u64, String> {
    let _ = write_host_metadata(&app);
    ensure_listener(&app, &state)?;
    if let Some(err) = error {
        let (generation, next) = {
            let mut core = state.core.lock().map_err(|e| e.to_string())?;
            let phase = core.fail_bootstrap(&err);
            (core.generation, phase)
        };
        let _ = state.phase_tx.send_replace(next);
        return Ok(generation);
    }
    let (generation, next) = {
        let mut core = state.core.lock().map_err(|e| e.to_string())?;
        core.activate_ready()?
    };
    let _ = state.phase_tx.send_replace(next);
    Ok(generation)
}

async fn wait_until_ready(app: &tauri::AppHandle, io: &mut BufReader<NamedPipeServer>) -> Result<u64, String> {
    let mut rx = app.state::<McpBridge>().phase_tx.subscribe();
    loop {
        let phase = rx.borrow_and_update().clone();
        match phase {
            Phase::Ready { generation } => return Ok(generation),
            Phase::SetupRequired => {
                return Err("SETUP_REQUIRED：单轨尚未完成首次数据目录初始化，请先打开单轨完成设置".into())
            }
            Phase::Failed(error) | Phase::HostLost(error) => return Err(error),
            Phase::Starting | Phase::Recovering => {
                let mut eof = String::new();
                tokio::select! {
                    changed = rx.changed() => {
                        changed.map_err(|e| e.to_string())?;
                    }
                    read = io.read_line(&mut eof) => {
                        match read {
                            Ok(0) | Err(_) => return Err("CANCELLED：客户端在单轨就绪前取消了请求".into()),
                            Ok(_) => {}
                        }
                    }
                }
            }
        }
    }
}

async fn forward(app: &tauri::AppHandle, pipe: NamedPipeServer) -> Result<(), String> {
    let mut io = BufReader::new(pipe);
    let mut line = String::new();
    if io.read_line(&mut line).await.map_err(|e| e.to_string())? == 0 {
        return Ok(());
    }
    let result = dispatch(app, &line, &mut io).await;
    let reply = match result {
        Ok(value) => value,
        Err(error) => serde_json::json!({ "error": error }),
    };
    let bytes = format!("{}\n", reply);
    io.get_mut().write_all(bytes.as_bytes()).await.map_err(|e| e.to_string())?;
    // The client closes after reading the response; do not flush a pipe after it disconnects.
    Ok(())
}

async fn dispatch(app: &tauri::AppHandle, line: &str, io: &mut BufReader<NamedPipeServer>) -> Result<Reply, String> {
    let request: serde_json::Value = serde_json::from_str(line).map_err(|e| e.to_string())?;
    let generation = wait_until_ready(app, io).await?;
    let method = request.get("method").and_then(|v| v.as_str()).unwrap_or("");
    let is_write = is_write_method(method);
    let state = app.state::<McpBridge>();
    let seq = state.sequence.fetch_add(1, Ordering::Relaxed);
    let id = format!("mcp-{generation}-{seq}");
    if is_write {
        crate::quick_save::begin_quick_save(app.state(), id.clone())?;
    } else {
        crate::quick_save::check_ready(app.state())?;
    }
    let (sender, mut receiver) = oneshot::channel();
    {
        let mut core = match state.core.lock() {
            Ok(guard) => guard,
            Err(error) => {
                if is_write {
                    let _ = crate::quick_save::end_quick_save(app.state(), id);
                }
                return Err(error.to_string());
            }
        };
        if let Err(error) = core.register_pending(id.clone(), generation, is_write, sender) {
            drop(core);
            if is_write {
                let _ = crate::quick_save::end_quick_save(app.state(), id);
            }
            return Err(error);
        }
    }
    if let Err(error) = app.emit_to(
        "main",
        "mcp-request",
        serde_json::json!({ "id": id, "generation": generation, "request": request }),
    ) {
        let release = state
            .core
            .lock()
            .map(|mut core| core.abort_before_emit(&id))
            .unwrap_or(is_write);
        if release {
            let _ = crate::quick_save::end_quick_save(app.state(), id);
        }
        return Err(error.to_string());
    }
    let mut eof = String::new();
    tokio::select! {
        res = &mut receiver => {
            res.map_err(|e| e.to_string())?
        }
        read = io.read_line(&mut eof) => {
            if matches!(read, Ok(0) | Err(_)) {
                let _ = app.emit_to("main", "mcp-cancel", serde_json::json!({ "id": id, "generation": generation }));
            }
            // Wait for WebView reply (either pre-tx cancel or committed write); QuickSaves is released by respond_mcp.
            receiver.await.map_err(|e| e.to_string())?
        }
    }
}

async fn serve(app: tauri::AppHandle, name: String, mut listener: NamedPipeServer) -> Result<(), String> {
    loop {
        listener.connect().await.map_err(|e| e.to_string())?;
        let next = ServerOptions::new()
            .reject_remote_clients(true)
            .create(&name)
            .map_err(|e| e.to_string())?;
        let connected = std::mem::replace(&mut listener, next);
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = forward(&app, connected).await {
                eprintln!("MCP connection: {error}");
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::{is_write_method, update_phase, BridgeCore, McpBridge, Phase};
    use tokio::sync::oneshot;

    #[test]
    fn phase_updates_persist_before_any_subscriber_attaches() {
        let bridge = McpBridge::default();
        update_phase(&bridge, Some(Phase::SetupRequired));
        assert_eq!(*bridge.phase_tx.subscribe().borrow(), Phase::SetupRequired);
        update_phase(&bridge, Some(Phase::Ready { generation: 1 }));
        assert_eq!(*bridge.phase_tx.subscribe().borrow(), Phase::Ready { generation: 1 });
    }

    #[test]
    fn read_only_methods_are_distinguished_from_writes() {
        assert!(!is_write_method("get_context"));
        assert!(!is_write_method("get_operation_result"));
        assert!(!is_write_method("find_items"));
        assert!(!is_write_method("get_time_summary"));
        assert!(!is_write_method("list_time_entries"));
        assert!(is_write_method("save_idea"));
        assert!(is_write_method("start_timer"));
    }

    #[test]
    fn clean_reconnect_advances_generation_and_isolates_stale_replies() {
        let mut core = BridgeCore::default();
        assert_eq!(core.set_setup_required(), Some(Phase::SetupRequired));
        assert_eq!(core.set_recovering(), Some(Phase::Recovering));
        let (gen1, phase1) = core.activate_ready().unwrap();
        assert_eq!(gen1, 1);
        assert_eq!(phase1, Phase::Ready { generation: 1 });

        let (tx, mut rx) = oneshot::channel();
        core.register_pending("mcp-1-0".into(), gen1, false, tx).unwrap();
        assert_eq!(core.active_writes, 0);
        let was_write = core.complete_reply("mcp-1-0", Some(gen1), serde_json::json!({"ok": true})).unwrap();
        assert!(!was_write);
        assert_eq!(rx.try_recv().unwrap().unwrap(), serde_json::json!({"ok": true}));

        let (gen2, phase2) = core.activate_ready().unwrap();
        assert_eq!(gen2, 2);
        assert_eq!(phase2, Phase::Ready { generation: 2 });
    }

    #[test]
    fn reload_or_destroy_during_active_write_locks_host_lost_and_reports_unknown() {
        let mut core = BridgeCore::default();
        let (gen1, _) = core.activate_ready().unwrap();
        let (tx, mut rx) = oneshot::channel();
        core.register_pending("mcp-1-0".into(), gen1, true, tx).unwrap();
        assert_eq!(core.active_writes, 1);

        let err = core.activate_ready().unwrap_err();
        assert!(err.starts_with("HOST_LOST："));
        let pending_err = rx.try_recv().unwrap().unwrap_err();
        assert!(pending_err.starts_with("RESULT_UNKNOWN："));
        // Active write count stays non-zero so QuickSaves is never prematurely unlocked on an interrupted host.
        assert_eq!(core.active_writes, 1);
        assert!(core.activate_ready().is_err());
    }
}
