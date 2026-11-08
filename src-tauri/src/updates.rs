use std::sync::Mutex;
use tauri::State;
use super::private_release::CheckOutcome;
use super::update_channel::{Channel, UpdateIntent};
use super::update_state::{self, Session, Snapshot, Step, Updates};

#[tauri::command]
pub fn read_update_state(app: tauri::AppHandle, state: State<Updates>) -> Result<Snapshot, String> {
    Ok(state.0.lock().map_err(|error| error.to_string())?.snapshot(&app))
}

#[tauri::command]
pub fn set_update_channel(app: tauri::AppHandle, channel: Channel) -> Result<Snapshot, String> {
    update_state::change(&app, |store| {
        if store.session.busy() {
            return Err("更新操作正在进行中，暂时不能切换更新渠道".into());
        }
        super::update_channel::write_channel(&app, channel)?;
        store.set_channel(channel)
    })
}

#[tauri::command]
pub fn dismiss_update_target(app: tauri::AppHandle) -> Result<Snapshot, String> {
    update_state::change(&app, |store| store.dismiss_target())
}

#[tauri::command]
pub async fn check_update(app: tauri::AppHandle) -> Result<Snapshot, String> {
    let (snapshot, started_channel) = update_state::transition(&app, |store| {
        // Repeated checks observe the current operation; they never reset or replace it.
        if store.session.busy() {
            return Ok(None);
        }
        match super::update_channel::read_channel(&app) {
            Ok(channel) => {
                store.start_check(channel, UpdateIntent::Upgrade);
                Ok(Some(channel))
            }
            Err(error) => {
                store.session = Session::Idle;
                store.step = Step::Idle;
                store.fail(error);
                Ok(None)
            }
        }
    })?;
    let Some(channel) = started_channel else {
        return Ok(snapshot);
    };
    let result = super::private_release::check(&app, channel, UpdateIntent::Upgrade, |step| {
        update_state::step(&app, step)
    })
    .await;
    update_state::change(&app, |store| {
        match result {
            Ok(CheckOutcome::Available(candidate, permit)) => {
                store.permit = permit;
                store.session = Session::Available(candidate);
                store.step(Step::Available);
            }
            Ok(CheckOutcome::Current) => {
                store.permit = None;
                store.session = Session::Current;
                store.step(Step::Current);
            }
            Ok(CheckOutcome::IncompatibleTarget(info)) => {
                store.permit = None;
                store.session = Session::Idle;
                store.inspected_release = Some(info.clone());
                store.fail(info.compatibility.reason);
            }
            Err(error) => {
                store.permit = None;
                store.session = Session::Idle;
                store.fail(error);
            }
        }
        Ok(())
    })
}

#[tauri::command]
pub async fn check_stable_update(app: tauri::AppHandle) -> Result<Snapshot, String> {
    let (snapshot, started) = update_state::transition(&app, |store| {
        if store.session.busy() {
            return Err("更新操作正在进行中，请等待当前步骤完成后再选择稳定版".into());
        }
        match super::update_channel::read_channel(&app) {
            Ok(Channel::Stable) => {
                store.start_check(Channel::Stable, UpdateIntent::ReturnToStable);
                Ok(true)
            }
            Ok(Channel::Beta) => {
                Err("请先退出 Beta 切换为稳定版渠道，再选择安装稳定版".into())
            }
            Err(error) => {
                store.session = Session::Idle;
                store.step = Step::Idle;
                store.fail(error);
                Ok(false)
            }
        }
    })?;
    if !started {
        return Ok(snapshot);
    }
    let result = super::private_release::check(
        &app,
        Channel::Stable,
        UpdateIntent::ReturnToStable,
        |step| update_state::step(&app, step),
    )
    .await;
    update_state::change(&app, |store| {
        match result {
            Ok(CheckOutcome::Available(candidate, permit)) => {
                store.permit = permit;
                store.session = Session::Available(candidate);
                store.step(Step::Available);
            }
            Ok(CheckOutcome::Current) => {
                store.permit = None;
                store.session = Session::Current;
                store.step(Step::Current);
            }
            Ok(CheckOutcome::IncompatibleTarget(info)) => {
                store.permit = None;
                store.session = Session::Idle;
                store.inspected_release = Some(info.clone());
                store.fail(info.compatibility.reason);
            }
            Err(error) => {
                store.permit = None;
                store.session = Session::Idle;
                store.fail(error);
            }
        }
        Ok(())
    })
}

#[tauri::command]
pub async fn download_update(app: tauri::AppHandle) -> Result<Snapshot, String> {
    let (_, candidate) = update_state::transition(&app, |store| {
        let Session::Available(candidate) = &store.session else {
            return Err("当前状态不能下载，请查看更新步骤或重新检查".into());
        };
        store.verify_candidate_allowed(candidate)?;
        let candidate = candidate.clone();
        store.session = Session::Downloading(candidate.clone());
        store.error = None;
        store.downloaded = 0;
        store.total = None;
        store.step(Step::Download);
        Ok(candidate)
    })?;
    let update = candidate
        .update
        .as_ref()
        .ok_or("缺少原生更新句柄，请重新检查更新")?;
    let notification_error = Mutex::new(None);
    let verify_candidate = candidate.clone();
    let result = update
        .download(
            |chunk, total| {
                if let Err(error) = update_state::change(&app, |store| {
                    store.downloaded += chunk as u64;
                    store.total = total;
                    Ok(())
                }) {
                    *notification_error.lock().unwrap() = Some(error);
                }
            },
            || {
                // The official callback runs after the bytes arrive and before signature verification.
                if let Err(error) = update_state::change(&app, |store| {
                    store.session = Session::Verifying(verify_candidate.clone());
                    store.step(Step::Signature);
                    Ok(())
                }) {
                    *notification_error.lock().unwrap() = Some(error);
                }
            },
        )
        .await;
    let notification_error = notification_error
        .into_inner()
        .map_err(|error| error.to_string())?;
    update_state::change(&app, |store| {
        match (result, notification_error) {
            (Ok(bytes), None) => {
                if let Err(error) = store.verify_candidate_allowed(&candidate) {
                    store.session = Session::Idle;
                    store.downloaded = 0;
                    store.total = None;
                    store.fail(error);
                    return Ok(());
                }
                store.session = Session::Ready(candidate, bytes);
                store.step(Step::Ready);
            }
            (result, notification_error) => {
                store.session = Session::Available(candidate);
                store.fail(match result {
                    Err(error) => error.to_string(),
                    Ok(_) => format!("更新进度推送失败：{}", notification_error.unwrap()),
                });
            }
        }
        Ok(())
    })
}

#[tauri::command]
pub fn prepare_update_install(app: tauri::AppHandle) -> Result<Snapshot, String> {
    update_state::change(&app, |store| {
        match std::mem::replace(&mut store.session, Session::Idle) {
            Session::Ready(candidate, bytes) => {
                if let Err(error) = store.verify_candidate_allowed(&candidate) {
                    store.session = Session::Idle;
                    store.downloaded = 0;
                    store.total = None;
                    store.fail(error.clone());
                    return Err(error);
                }
                let prep_req_id = match super::quick_save::begin_prepare_install(&app) {
                    Ok(id) => id,
                    Err(error) => {
                        store.session = Session::Ready(candidate, bytes);
                        return Err(error);
                    }
                };
                store.install_check_request_id = Some(prep_req_id);
                store.session = Session::Preparing(candidate, bytes);
                store.error = None;
                store.step(Step::Commits);
                Ok(())
            }
            previous => {
                store.session = previous;
                Err("当前状态不能安装，请先完整下载并验证更新".into())
            }
        }
    })
}

#[tauri::command]
pub fn cancel_update_install(app: tauri::AppHandle, error: String) -> Result<Snapshot, String> {
    update_state::change(&app, |store| {
        match std::mem::replace(&mut store.session, Session::Idle) {
            Session::Preparing(candidate, bytes) | Session::Ready(candidate, bytes) => {
                if let Some(req_id) = store.install_check_request_id.take() {
                    super::quick_save::cancel_install_with_request(&app, Some(&req_id))?;
                }
                store.session = Session::Ready(candidate, bytes);
                store.fail(error);
                Ok(())
            }
            previous => {
                store.session = previous;
                Err("安装收尾尚未结束，无法确认解除保存封口，请查看当前步骤".into())
            }
        }
    })
}

#[tauri::command]
pub async fn install_update(app: tauri::AppHandle) -> Result<Snapshot, String> {
    let (_, (candidate, bytes, channel, intent, prep_req_id)) = update_state::transition(&app, |store| {
        match std::mem::replace(&mut store.session, Session::Idle) {
            Session::Preparing(candidate, bytes) => {
                if let Err(error) = store.verify_candidate_allowed(&candidate) {
                    if let Some(req_id) = store.install_check_request_id.take() {
                        let _ = super::quick_save::cancel_install_with_request(&app, Some(&req_id));
                    }
                    store.session = Session::Idle;
                    store.downloaded = 0;
                    store.total = None;
                    store.fail(error.clone());
                    return Err(error);
                }
                let prep_req_id = store.install_check_request_id.clone();
                store.session = Session::Finishing(candidate.clone());
                store.step(Step::Draft);
                Ok((candidate, bytes, store.selected_channel, store.intent, prep_req_id))
            }
            previous => {
                store.session = previous;
                Err("请先完成安装准备".into())
            }
        }
    })?;
    let current_version = app.package_info().version.to_string();
    let mut owned_req_id = prep_req_id.clone();
    let result = async {
        match super::quick_save::prepare_install(&app, prep_req_id.as_deref()).await {
            Ok(check_req_id) => {
                owned_req_id = Some(check_req_id);
            }
            Err((maybe_owned, err)) => {
                if maybe_owned.is_some() {
                    owned_req_id = maybe_owned;
                }
                return Err(err);
            }
        }
        update_state::step(&app, Step::Lifecycle)?;
        let lifecycle_json = super::power::checkpoint_snapshot()?;
        let reminders_json = super::reminders::snapshot_bytes(&app)?;
        update_state::step(&app, Step::Backup)?;
        let owner_snapshots = super::update_backup::OwnerConfigSnapshots {
            lifecycle_json: Some(lifecycle_json),
            reminders_json,
        };
        let backup = super::update_backup::create_and_verify_backup(
            &app,
            &current_version,
            &candidate.info.version,
            channel,
            intent,
            &owner_snapshots,
        )?;
        update_state::change(&app, |store| {
            store.last_backup = Some(backup);
            store.session = Session::Installing(candidate.clone());
            store.step(Step::Installer);
            Ok(())
        })?;
        candidate
            .update
            .as_ref()
            .ok_or_else(|| "缺少原生更新句柄".to_string())?
            .install(&bytes)
            .map_err(|error| error.to_string())
    }
    .await;
    // On Windows the successful path exits the process after launching the verified installer.
    if let Some(req_id) = owned_req_id.as_deref() {
        super::quick_save::cancel_install_with_request(&app, Some(req_id))?;
    }
    update_state::change(&app, |store| {
        store.install_check_request_id = None;
        store.session = Session::Ready(candidate, bytes);
        if let Err(error) = result {
            store.fail(error);
        }
        Ok(())
    })
}
