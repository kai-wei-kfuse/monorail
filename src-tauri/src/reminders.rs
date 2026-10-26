use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    sync::{Mutex, OnceLock},
    thread,
    time::Duration,
};
use tauri::Emitter;
use tauri_plugin_notification::NotificationExt;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Reminder {
    id: String,
    at: u64,
    title: String,
    body: String,
}
static PLANS: OnceLock<Mutex<Vec<Reminder>>> = OnceLock::new();
#[tauri::command]
pub fn set_reminders(app: tauri::AppHandle, plans: Vec<Reminder>) -> Result<(), String> {
    super::evidence(
        app,
        format!(
            "reminder-plan:{}",
            serde_json::to_string(&plans).map_err(|e| e.to_string())?
        ),
    )?;
    *PLANS
        .get()
        .ok_or("Reminder scheduler unavailable")?
        .lock()
        .map_err(|e| e.to_string())? = plans;
    Ok(())
}
pub fn setup(app: tauri::AppHandle) {
    PLANS
        .set(Mutex::new(Vec::new()))
        .expect("Reminder scheduler initialized twice");
    thread::spawn(move || {
        let mut fired = HashSet::new();
        loop {
            // Native polling resolution; reminders do not depend on WebView timers.
            thread::sleep(Duration::from_millis(200));
            let plans = PLANS
                .get()
                .unwrap()
                .lock()
                .expect("Reminder mutex poisoned")
                .clone();
            for plan in plans {
                if plan.at > super::power::now_ms() || fired.contains(&plan.id) {
                    continue;
                }
                match app
                    .notification()
                    .builder()
                    .title(&plan.title)
                    .body(&plan.body)
                    .show()
                {
                    Ok(()) => {
                        fired.insert(plan.id.clone());
                        let _ = super::evidence(
                            app.clone(),
                            format!("notification-dispatched:{}:{}", plan.id, plan.at),
                        );
                        let _ = app.emit("reminder-fired", &plan);
                    }
                    Err(error) => {
                        eprintln!("notification failed: {error}");
                        let _ = app.emit("native-error", error.to_string());
                    }
                }
            }
        }
    });
}
