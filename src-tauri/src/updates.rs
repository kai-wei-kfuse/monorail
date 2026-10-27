use std::sync::Mutex;
use tauri::State;
use super::update_state::{self, Session, Snapshot, Step, Updates};

#[tauri::command]
pub fn read_update_state(app: tauri::AppHandle, state: State<Updates>) -> Result<Snapshot, String> {
    Ok(state.0.lock().map_err(|error| error.to_string())?.snapshot(&app))
}

#[tauri::command]
pub async fn check_update(app: tauri::AppHandle) -> Result<Snapshot, String> {
    let (snapshot, started) = update_state::transition(&app, |store| {
        // Repeated checks observe the current operation; they never reset or replace it.
        if store.session.busy() { return Ok(false); }
        store.start_check();
        Ok(true)
    })?;
    if !started { return Ok(snapshot); }
    let result = super::private_release::check(&app, |step| update_state::step(&app, step)).await;
    update_state::change(&app, |store| {
        match result {
            Ok(Some(update)) => { store.session = Session::Available(update); store.step(Step::Available); }
            Ok(None) => { store.session = Session::Current; store.step(Step::Current); }
            Err(error) => { store.session = Session::Idle; store.fail(error); }
        }
        Ok(())
    })
}

#[tauri::command]
pub async fn download_update(app: tauri::AppHandle) -> Result<Snapshot, String> {
    let (_, update) = update_state::transition(&app, |store| {
        let Session::Available(update) = &store.session else { return Err("当前状态不能下载，请查看更新步骤或重新检查".into()); };
        let update = update.clone();
        store.session = Session::Downloading(update.clone());
        store.error = None; store.downloaded = 0; store.total = None;
        store.step(Step::Download);
        Ok(update)
    })?;
    let notification_error = Mutex::new(None);
    let result = update.download(|chunk, total| {
        if let Err(error) = update_state::change(&app, |store| {
            store.downloaded += chunk as u64; store.total = total; Ok(())
        }) { *notification_error.lock().unwrap() = Some(error); }
    }, || {
        // The official callback runs after the bytes arrive and before signature verification.
        if let Err(error) = update_state::change(&app, |store| {
            store.session = Session::Verifying(update.clone()); store.step(Step::Signature); Ok(())
        }) { *notification_error.lock().unwrap() = Some(error); }
    }).await;
    let notification_error = notification_error.into_inner().map_err(|error| error.to_string())?;
    update_state::change(&app, |store| {
        match (result, notification_error) {
            (Ok(bytes), None) => { store.session = Session::Ready(update, bytes); store.step(Step::Ready); }
            (result, notification_error) => {
                store.session = Session::Available(update);
                store.fail(match result { Err(error) => error.to_string(), Ok(_) => format!("更新进度推送失败：{}", notification_error.unwrap()) });
            }
        }
        Ok(())
    })
}

#[tauri::command]
pub fn prepare_update_install(app: tauri::AppHandle) -> Result<Snapshot, String> {
    update_state::change(&app, |store| {
        match std::mem::replace(&mut store.session, Session::Idle) {
            Session::Ready(update, bytes) => { store.session = Session::Preparing(update, bytes); store.error = None; store.step(Step::Commits); Ok(()) }
            previous => { store.session = previous; Err("当前状态不能安装，请先完整下载并验证更新".into()) }
        }
    })
}

#[tauri::command]
pub fn cancel_update_install(app: tauri::AppHandle, error: String) -> Result<Snapshot, String> {
    update_state::change(&app, |store| {
        match std::mem::replace(&mut store.session, Session::Idle) {
            Session::Preparing(update, bytes) | Session::Ready(update, bytes) => {
                store.session = Session::Ready(update, bytes); store.fail(error); Ok(())
            }
            previous => { store.session = previous; Err("安装收尾尚未结束，无法确认解除保存封口，请查看当前步骤".into()) }
        }
    })
}

#[tauri::command]
pub async fn install_update(app: tauri::AppHandle) -> Result<Snapshot, String> {
    let (_, (update, bytes)) = update_state::transition(&app, |store| {
        match std::mem::replace(&mut store.session, Session::Idle) {
            Session::Preparing(update, bytes) => { store.session = Session::Finishing(update.clone()); store.step(Step::Draft); Ok((update, bytes)) }
            previous => { store.session = previous; return Err("请先完成安装准备".into()); }
        }
    })?;
    let result = async {
        super::quick_save::prepare_install(&app).await?;
        update_state::step(&app, Step::Lifecycle)?;
        super::power::checkpoint()?;
        update_state::change(&app, |store| { store.session = Session::Installing(update.clone()); store.step(Step::Installer); Ok(()) })?;
        update.install(&bytes).map_err(|error| error.to_string())
    }.await;
    // On Windows the successful path exits the process after launching the verified installer.
    super::quick_save::cancel_install(&app)?;
    update_state::change(&app, |store| {
        store.session = Session::Ready(update, bytes);
        if let Err(error) = result { store.fail(error); }
        Ok(())
    })
}
