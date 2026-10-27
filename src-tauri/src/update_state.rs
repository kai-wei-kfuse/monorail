use serde::Serialize;
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_updater::Update;

#[derive(Default)]
pub enum Session {
    #[default]
    Idle,
    Checking,
    Current,
    Available(Update),
    Downloading(Update),
    Verifying(Update),
    Ready(Update, Vec<u8>),
    Preparing(Update, Vec<u8>),
    Finishing(Update),
    Installing(Update),
}

impl Session {
    pub fn phase(&self) -> &'static str {
        match self {
            Self::Idle => "idle", Self::Checking => "checking", Self::Current => "current",
            Self::Available(_) => "available", Self::Downloading(_) => "downloading",
            Self::Verifying(_) => "verifying", Self::Ready(..) => "ready",
            Self::Preparing(..) | Self::Finishing(_) => "preparing", Self::Installing(_) => "installing",
        }
    }
    pub fn busy(&self) -> bool {
        matches!(self, Self::Checking | Self::Downloading(_) | Self::Verifying(_)
            | Self::Preparing(..) | Self::Finishing(_) | Self::Installing(_))
    }
    fn release(&self) -> Option<ReleaseInfo> {
        match self {
            Self::Available(u) | Self::Downloading(u) | Self::Verifying(u) | Self::Ready(u, _)
            | Self::Preparing(u, _) | Self::Finishing(u) | Self::Installing(u) =>
                Some(ReleaseInfo { version: u.version.clone(), notes: u.body.clone() }),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Step { #[default] Idle, Credentials, Github, Release, Manifest, Download, Signature, Commits, Draft, Lifecycle, Installer, Current, Available, Ready }

#[derive(Clone, Serialize)]
pub struct ReleaseInfo { version: String, notes: Option<String> }
#[derive(Clone, Serialize)]
pub struct Entry { step: Step, at: u64 }
#[derive(Clone, Serialize)]
pub struct Failure { pub message: String, step: Step, at: u64 }

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub revision: u64,
    current_version: String,
    phase: &'static str,
    busy: bool,
    step: Step,
    downloaded: u64,
    total: Option<u64>,
    release: Option<ReleaseInfo>,
    history: Vec<Entry>,
    pub error: Option<Failure>,
    updated_at: u64,
}

#[derive(Default)]
pub struct Store {
    pub session: Session,
    pub step: Step,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub error: Option<Failure>,
    history: Vec<Entry>,
    revision: u64,
    updated_at: u64,
}
#[derive(Default)]
pub struct Updates(pub Mutex<Store>);

impl Store {
    pub fn step(&mut self, step: Step) {
        if self.step != step || self.history.is_empty() {
            self.history.push(Entry { step, at: super::power::now_ms() });
            self.step = step;
        }
    }
    pub fn start_check(&mut self) {
        self.session = Session::Checking;
        self.error = None;
        self.downloaded = 0;
        self.total = None;
        self.history.clear();
        self.step(Step::Credentials);
    }
    pub fn fail(&mut self, message: String) {
        self.error = Some(Failure { message, step: self.step, at: super::power::now_ms() });
    }
    pub fn snapshot(&self, app: &tauri::AppHandle) -> Snapshot {
        Snapshot { revision: self.revision, current_version: app.package_info().version.to_string(),
            phase: self.session.phase(), busy: self.session.busy(), step: self.step,
            downloaded: self.downloaded, total: self.total, release: self.session.release(),
            history: self.history.clone(), error: self.error.clone(), updated_at: self.updated_at }
    }
}

pub fn transition<T>(app: &tauri::AppHandle, work: impl FnOnce(&mut Store) -> Result<T, String>) -> Result<(Snapshot, T), String> {
    let state = app.state::<Updates>();
    let (snapshot, value) = {
        let mut store = state.0.lock().map_err(|error| error.to_string())?;
        let value = work(&mut store)?;
        store.revision += 1;
        store.updated_at = super::power::now_ms();
        (store.snapshot(app), value)
    };
    app.emit_to("main", "updater-state", &snapshot).map_err(|error| error.to_string())?;
    Ok((snapshot, value))
}

pub fn change(app: &tauri::AppHandle, work: impl FnOnce(&mut Store) -> Result<(), String>) -> Result<Snapshot, String> {
    transition(app, work).map(|(snapshot, ())| snapshot)
}

pub fn step(app: &tauri::AppHandle, step: Step) -> Result<(), String> {
    change(app, |store| { store.step(step); Ok(()) }).map(|_| ())
}
