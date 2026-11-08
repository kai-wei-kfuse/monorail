use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_updater::Update;
use super::update_backup::{self, BackupInfo};
use super::update_channel::{self, derive_build_channel, Channel, UpdateIntent};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompatibilityInfo {
    pub compatible: bool,
    pub source: String,
    pub data_schema_version: Option<u32>,
    pub readable_data_schema_versions: Vec<u32>,
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseInfo {
    pub version: String,
    pub notes: Option<String>,
    pub tag: String,
    pub release_id: u64,
    pub channel: Channel,
    pub is_downgrade: bool,
    pub compatibility: CompatibilityInfo,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TargetPermit {
    pub intent: UpdateIntent,
    pub version: String,
    pub tag: String,
    pub release_id: u64,
    pub download_url: String,
    pub compatible: bool,
}

#[derive(Clone)]
pub struct Candidate {
    pub update: Option<Update>,
    pub info: ReleaseInfo,
    pub download_url: String,
}

#[derive(Default)]
pub enum Session {
    #[default]
    Idle,
    Checking,
    Current,
    Available(Candidate),
    Downloading(Candidate),
    Verifying(Candidate),
    Ready(Candidate, Vec<u8>),
    Preparing(Candidate, Vec<u8>),
    Finishing(Candidate),
    Installing(Candidate),
}

impl Session {
    pub fn phase(&self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Checking => "checking",
            Self::Current => "current",
            Self::Available(_) => "available",
            Self::Downloading(_) => "downloading",
            Self::Verifying(_) => "verifying",
            Self::Ready(..) => "ready",
            Self::Preparing(..) | Self::Finishing(_) => "preparing",
            Self::Installing(_) => "installing",
        }
    }
    pub fn busy(&self) -> bool {
        matches!(
            self,
            Self::Checking
                | Self::Downloading(_)
                | Self::Verifying(_)
                | Self::Preparing(..)
                | Self::Finishing(_)
                | Self::Installing(_)
        )
    }
    fn release(&self) -> Option<ReleaseInfo> {
        match self {
            Self::Available(c)
            | Self::Downloading(c)
            | Self::Verifying(c)
            | Self::Ready(c, _)
            | Self::Preparing(c, _)
            | Self::Finishing(c)
            | Self::Installing(c) => Some(c.info.clone()),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Step {
    #[default]
    Idle,
    Credentials,
    Github,
    Release,
    Manifest,
    Download,
    Signature,
    Commits,
    Draft,
    Lifecycle,
    Backup,
    Installer,
    Current,
    Available,
    Ready,
}

#[derive(Clone, Debug, Serialize)]
pub struct Entry {
    pub step: Step,
    pub at: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct Failure {
    pub message: String,
    pub step: Step,
    pub at: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub revision: u64,
    pub current_version: String,
    pub current_channel: Channel,
    pub selected_channel: Channel,
    pub intent: UpdateIntent,
    pub phase: &'static str,
    pub busy: bool,
    pub step: Step,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub release: Option<ReleaseInfo>,
    pub last_backup: Option<BackupInfo>,
    pub history: Vec<Entry>,
    pub error: Option<Failure>,
    pub updated_at: u64,
}

#[derive(Default)]
pub struct Store {
    pub session: Session,
    pub selected_channel: Channel,
    pub intent: UpdateIntent,
    pub permit: Option<TargetPermit>,
    pub inspected_release: Option<ReleaseInfo>,
    pub last_backup: Option<BackupInfo>,
    pub install_check_request_id: Option<String>,
    pub step: Step,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub error: Option<Failure>,
    pub history: Vec<Entry>,
    pub revision: u64,
    pub updated_at: u64,
}

#[derive(Default)]
pub struct Updates(pub Mutex<Store>);

impl Store {
    pub fn step(&mut self, step: Step) {
        if self.step != step || self.history.is_empty() {
            self.history.push(Entry {
                step,
                at: super::power::now_ms(),
            });
            self.step = step;
        }
    }

    pub fn start_check(&mut self, channel: Channel, intent: UpdateIntent) {
        self.selected_channel = channel;
        self.intent = intent;
        self.permit = None;
        self.inspected_release = None;
        self.session = Session::Checking;
        self.error = None;
        self.downloaded = 0;
        self.total = None;
        self.history.clear();
        self.step(Step::Credentials);
    }

    pub fn set_channel(&mut self, channel: Channel) -> Result<(), String> {
        if self.session.busy() {
            return Err("更新操作正在进行中，暂时不能切换更新渠道".into());
        }
        self.selected_channel = channel;
        self.intent = UpdateIntent::Upgrade;
        self.permit = None;
        self.inspected_release = None;
        self.session = Session::Idle;
        self.downloaded = 0;
        self.total = None;
        self.error = None;
        self.history.clear();
        self.step = Step::Idle;
        Ok(())
    }

    pub fn dismiss_target(&mut self) -> Result<(), String> {
        if self.session.busy() {
            return Err("更新操作正在进行中，暂时不能取消当前候选版本".into());
        }
        self.intent = UpdateIntent::Upgrade;
        self.permit = None;
        self.inspected_release = None;
        self.session = Session::Idle;
        self.downloaded = 0;
        self.total = None;
        self.error = None;
        self.history.clear();
        self.step = Step::Idle;
        Ok(())
    }

    pub fn verify_candidate_allowed(&self, candidate: &Candidate) -> Result<(), String> {
        if !candidate.info.compatibility.compatible {
            return Err(candidate.info.compatibility.reason.clone());
        }
        if candidate.info.is_downgrade {
            if self.selected_channel != Channel::Stable || self.intent != UpdateIntent::ReturnToStable {
                return Err("普通更新流程不允许降级，请先退出 Beta 并通过「安装稳定版」确认回退目标".into());
            }
            let Some(permit) = &self.permit else {
                return Err("缺少针对该稳定版本的显式回退许可，请重新选择稳定版目标".into());
            };
            if permit.intent != UpdateIntent::ReturnToStable
                || !permit.compatible
                || permit.version != candidate.info.version
                || permit.tag != candidate.info.tag
                || permit.release_id != candidate.info.release_id
                || permit.download_url != candidate.download_url
            {
                return Err("当前稳定版回退许可与候选资产不匹配或已失效，请重新检查并确认".into());
            }
            if candidate.info.channel != Channel::Stable {
                return Err("返回稳定版仅允许安装正式稳定版 Release".into());
            }
        } else {
            if candidate.info.channel == Channel::Beta && self.selected_channel != Channel::Beta {
                return Err("当前为稳定版渠道，不能下载或安装 Beta 测试版本".into());
            }
            if self.intent == UpdateIntent::ReturnToStable && candidate.info.channel != Channel::Stable {
                return Err("返回稳定版仅允许安装正式稳定版 Release".into());
            }
        }
        Ok(())
    }

    pub fn fail(&mut self, message: String) {
        self.error = Some(Failure {
            message,
            step: self.step,
            at: super::power::now_ms(),
        });
    }

    pub fn snapshot_for_version(&self, current_version: String) -> Snapshot {
        let current_channel = derive_build_channel(&current_version);
        Snapshot {
            revision: self.revision,
            current_version,
            current_channel,
            selected_channel: self.selected_channel,
            intent: self.intent,
            phase: self.session.phase(),
            busy: self.session.busy(),
            step: self.step,
            downloaded: self.downloaded,
            total: self.total,
            release: self.session.release().or_else(|| self.inspected_release.clone()),
            last_backup: self.last_backup.clone(),
            history: self.history.clone(),
            error: self.error.clone(),
            updated_at: self.updated_at,
        }
    }

    pub fn snapshot(&self, app: &tauri::AppHandle) -> Snapshot {
        self.snapshot_for_version(app.package_info().version.to_string())
    }
}

pub fn initialize(app: &tauri::AppHandle) {
    let state = app.state::<Updates>();
    let Ok(mut store) = state.0.lock() else {
        return;
    };
    if let Ok(dir) = super::config_dir(app) {
        store.last_backup = update_backup::read_last_backup_from_dir(&dir);
        match update_channel::read_channel_from_dir(&dir) {
            Ok(channel) => {
                store.selected_channel = channel;
            }
            Err(error) => {
                store.selected_channel = Channel::Stable;
                store.fail(error);
            }
        }
    }
    store.updated_at = super::power::now_ms();
}

pub fn transition<T>(
    app: &tauri::AppHandle,
    work: impl FnOnce(&mut Store) -> Result<T, String>,
) -> Result<(Snapshot, T), String> {
    let state = app.state::<Updates>();
    let (snapshot, value) = {
        let mut store = state.0.lock().map_err(|error| error.to_string())?;
        let value = work(&mut store)?;
        store.revision += 1;
        store.updated_at = super::power::now_ms();
        (store.snapshot(app), value)
    };
    app.emit_to("main", "updater-state", &snapshot)
        .map_err(|error| error.to_string())?;
    Ok((snapshot, value))
}

pub fn change(
    app: &tauri::AppHandle,
    work: impl FnOnce(&mut Store) -> Result<(), String>,
) -> Result<Snapshot, String> {
    transition(app, work).map(|(snapshot, ())| snapshot)
}

pub fn step(app: &tauri::AppHandle, step: Step) -> Result<(), String> {
    change(app, |store| {
        store.step(step);
        Ok(())
    })
    .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_candidate(version: &str, channel: Channel, is_downgrade: bool, compatible: bool) -> Candidate {
        Candidate {
            update: None,
            download_url: format!("https://api.github.com/repos/owner/repo/releases/assets/100"),
            info: ReleaseInfo {
                version: version.into(),
                notes: Some("Release notes".into()),
                tag: format!("v{version}"),
                release_id: 42,
                channel,
                is_downgrade,
                compatibility: CompatibilityInfo {
                    compatible,
                    source: "manifest".into(),
                    data_schema_version: Some(2),
                    readable_data_schema_versions: if compatible { vec![2] } else { vec![1] },
                    reason: if compatible {
                        "兼容 schema v2".into()
                    } else {
                        "目标版本不兼容 schema v2".into()
                    },
                },
            },
        }
    }

    #[test]
    fn switching_channel_clears_available_or_ready_candidates_and_bytes() {
        let mut store = Store::default();
        store.selected_channel = Channel::Beta;
        let candidate = sample_candidate("0.3.0-beta.2", Channel::Beta, false, true);
        store.session = Session::Ready(candidate.clone(), vec![1, 2, 3, 4]);
        store.downloaded = 4;
        store.total = Some(4);
        store.step(Step::Ready);

        // Switching to Stable must clear the Ready Beta package and bytes.
        store.set_channel(Channel::Stable).unwrap();
        assert_eq!(store.selected_channel, Channel::Stable);
        assert_eq!(store.session.phase(), "idle");
        assert_eq!(store.downloaded, 0);
        assert!(store.total.is_none());
        assert!(store.history.is_empty());

        // Even if someone held a clone of the Beta candidate, Stable channel rejects it.
        assert!(store.verify_candidate_allowed(&candidate).is_err());
    }

    #[test]
    fn busy_phases_reject_channel_switch_and_preserve_active_operation() {
        let mut store = Store::default();
        store.start_check(Channel::Stable, UpdateIntent::Upgrade);
        assert!(store.session.busy());
        assert!(store.set_channel(Channel::Beta).is_err());
        assert_eq!(store.selected_channel, Channel::Stable);
        assert_eq!(store.session.phase(), "checking");
    }

    #[test]
    fn downgrade_requires_matching_explicit_stable_return_permit_and_invalidates_on_channel_change() {
        let mut store = Store::default();
        store.selected_channel = Channel::Stable;
        let downgrade = sample_candidate("0.2.5", Channel::Stable, true, true);

        // Without ReturnToStable intent and matching permit, downgrade is rejected.
        assert!(store.verify_candidate_allowed(&downgrade).is_err());

        store.intent = UpdateIntent::ReturnToStable;
        store.permit = Some(TargetPermit {
            intent: UpdateIntent::ReturnToStable,
            version: "0.2.5".into(),
            tag: "v0.2.5".into(),
            release_id: 42,
            download_url: downgrade.download_url.clone(),
            compatible: true,
        });
        assert!(store.verify_candidate_allowed(&downgrade).is_ok());

        // Switching channel or starting a normal check invalidates the permit.
        store.set_channel(Channel::Beta).unwrap();
        assert!(store.permit.is_none());
        assert!(store.verify_candidate_allowed(&downgrade).is_err());
    }
}
