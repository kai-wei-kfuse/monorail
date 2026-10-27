use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
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
#[derive(Default)]
struct Scheduler {
    plans: Vec<Reminder>,
    /// Delivered plan ids. Persisted so a restart does not repeat overdue reminders (#49).
    fired: HashSet<String>,
}
static STATE: OnceLock<Mutex<Scheduler>> = OnceLock::new();
const FILE: &str = "reminders.json";

/// Plans that are due and not yet delivered.
fn due(plans: &[Reminder], fired: &HashSet<String>, now: u64) -> Vec<Reminder> {
    plans
        .iter()
        .filter(|p| p.at <= now && !fired.contains(&p.id))
        .cloned()
        .collect()
}
/// Ids no longer planned can never fire again, so they are dropped to keep the file small.
fn prune(fired: &mut HashSet<String>, plans: &[Reminder]) {
    fired.retain(|id| plans.iter().any(|p| &p.id == id));
}

fn save(app: &tauri::AppHandle, fired: &HashSet<String>) -> Result<(), String> {
    let path = super::config_dir(app)?.join(FILE);
    let temp = path.with_extension("tmp");
    fs::write(
        &temp,
        serde_json::to_vec(fired).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(temp, path).map_err(|e| e.to_string())
}
fn load(app: &tauri::AppHandle) -> Result<HashSet<String>, String> {
    let path = super::config_dir(app)?.join(FILE);
    if !path.exists() {
        return Ok(HashSet::new());
    }
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    serde_json::from_slice(&bytes).map_err(|e| format!("{FILE}: {e}"))
}

#[tauri::command]
pub fn set_reminders(app: tauri::AppHandle, plans: Vec<Reminder>) -> Result<(), String> {
    super::evidence(
        app.clone(),
        format!(
            "reminder-plan:{}",
            serde_json::to_string(&plans).map_err(|e| e.to_string())?
        ),
    )?;
    let mut state = STATE
        .get()
        .ok_or("Reminder scheduler unavailable")?
        .lock()
        .map_err(|e| e.to_string())?;
    prune(&mut state.fired, &plans);
    state.plans = plans;
    save(&app, &state.fired)
}

fn deliver(app: &tauri::AppHandle, plan: &Reminder) -> Result<(), String> {
    app.notification()
        .builder()
        .title(&plan.title)
        .body(&plan.body)
        .show()
        .map_err(|e| e.to_string())?;
    let mut state = STATE.get().unwrap().lock().map_err(|e| e.to_string())?;
    state.fired.insert(plan.id.clone());
    save(app, &state.fired)?;
    let _ = super::evidence(
        app.clone(),
        format!("notification-dispatched:{}:{}", plan.id, plan.at),
    );
    let _ = app.emit("reminder-fired", plan);
    Ok(())
}

pub fn setup(app: tauri::AppHandle) {
    let fired = load(&app).unwrap_or_else(|error| {
        eprintln!("reminders: {error}");
        let _ = app.emit("native-error", error);
        HashSet::new()
    });
    if STATE
        .set(Mutex::new(Scheduler {
            plans: Vec::new(),
            fired,
        }))
        .is_err()
    {
        panic!("Reminder scheduler initialized twice");
    }
    thread::spawn(move || loop {
        // Native polling resolution; reminders do not depend on WebView timers.
        thread::sleep(Duration::from_millis(200));
        let pending = {
            let state = STATE.get().unwrap().lock().expect("Reminder mutex poisoned");
            due(&state.plans, &state.fired, super::power::now_ms())
        };
        for plan in pending {
            if let Err(error) = deliver(&app, &plan) {
                eprintln!("notification failed: {error}");
                let _ = app.emit("native-error", error);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    fn plan(id: &str, at: u64) -> Reminder {
        Reminder {
            id: id.into(),
            at,
            title: String::new(),
            body: String::new(),
        }
    }
    #[test]
    fn delivered_ids_are_not_due_again() {
        let plans = vec![plan("a", 10), plan("b", 10), plan("c", 99)];
        let fired = HashSet::from(["a".to_string()]);
        let ids: Vec<_> = due(&plans, &fired, 50).into_iter().map(|p| p.id).collect();
        assert_eq!(ids, vec!["b"]);
    }
    #[test]
    fn prune_keeps_only_planned_ids() {
        let mut fired = HashSet::from(["a".to_string(), "gone".to_string()]);
        prune(&mut fired, &[plan("a", 1)]);
        assert_eq!(fired, HashSet::from(["a".to_string()]));
    }
}
