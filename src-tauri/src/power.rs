use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::Path,
    sync::{Mutex, OnceLock},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Emitter;
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    System::LibraryLoader::GetModuleHandleW,
    UI::WindowsAndMessaging::*,
};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Lifecycle {
    pub last_alive: u64,
    pub previous_last_alive: Option<u64>,
    pub startup_at: u64,
    pub events: Vec<PowerEvent>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PowerEvent {
    pub kind: String,
    pub at: u64,
    pub simulated: bool,
    #[serde(default)]
    pub suspended_at: Option<u64>,
    #[serde(default)]
    pub resumed_at: Option<u64>,
}

static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
static STATE: OnceLock<Mutex<Lifecycle>> = OnceLock::new();

fn serialize_and_save_to_dir(dir: &Path, state: &Lifecycle) -> Result<Vec<u8>, String> {
    let bytes = serde_json::to_vec_pretty(state).map_err(|e| e.to_string())?;
    let path = dir.join("lifecycle.json");
    let temp = path.with_extension("tmp");
    fs::write(&temp, &bytes).map_err(|e| e.to_string())?;
    fs::rename(temp, path).map_err(|e| e.to_string())?;
    Ok(bytes)
}

fn save(app: &tauri::AppHandle, state: &Lifecycle) -> Result<Vec<u8>, String> {
    let dir = super::config_dir(app)?;
    serialize_and_save_to_dir(&dir, state)
}

pub fn checkpoint_snapshot() -> Result<Vec<u8>, String> {
    let app = APP.get().ok_or("Power monitor not initialized")?;
    let mut state = STATE
        .get()
        .ok_or("Missing lifecycle")?
        .lock()
        .map_err(|error| error.to_string())?;
    state.last_alive = now_ms();
    save(app, &state)
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("System clock before epoch")
        .as_millis() as u64
}

fn record_in_state(state: &mut Lifecycle, kind: &str, at: u64, simulated: bool) -> PowerEvent {
    let suspended_at = if kind == "resume" {
        state
            .events
            .last()
            .filter(|e| e.kind == "suspend")
            .map(|e| e.at)
    } else {
        Some(at)
    };
    let event = PowerEvent {
        kind: kind.into(),
        at,
        simulated,
        suspended_at,
        resumed_at: if kind == "resume" { Some(at) } else { None },
    };
    state.events.push(event.clone());
    event
}

fn record(kind: &str, simulated: bool) -> Result<(), String> {
    let app = APP.get().ok_or("Power monitor not initialized")?;
    let event = {
        let mut state = STATE
            .get()
            .ok_or("Missing lifecycle")?
            .lock()
            .map_err(|e| e.to_string())?;
        let event = record_in_state(&mut state, kind, now_ms(), simulated);
        save(app, &state)?;
        event
    };
    app.emit("power-event", &event).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_lifecycle() -> Result<Lifecycle, String> {
    Ok(STATE
        .get()
        .ok_or("Missing lifecycle")?
        .lock()
        .map_err(|e| e.to_string())?
        .clone())
}

#[tauri::command]
#[cfg(feature = "verify")]
pub fn simulate_power(kind: String) -> Result<(), String> {
    if kind != "suspend" && kind != "resume" {
        return Err("Invalid power event".into());
    }
    record(&kind, true)
}

unsafe extern "system" fn procedure(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    if msg == WM_POWERBROADCAST {
        // Win32 PBT_APMSUSPEND=4, PBT_APMRESUMEAUTOMATIC=18.
        let kind = match wp {
            4 => Some("suspend"),
            18 => Some("resume"),
            _ => None,
        };
        if let Some(kind) = kind {
            if let Err(e) = record(kind, false) {
                eprintln!("power event: {e}");
            }
        }
    }
    DefWindowProcW(hwnd, msg, wp, lp)
}

pub fn setup(app: tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let path = super::config_dir(&app)?.join("lifecycle.json");
    let previous: Option<Lifecycle> = if path.exists() {
        Some(serde_json::from_slice(&fs::read(path)?)?)
    } else {
        None
    };
    let state = Lifecycle {
        last_alive: now_ms(),
        previous_last_alive: previous.as_ref().map(|s| s.last_alive),
        startup_at: now_ms(),
        events: previous.map(|s| s.events).unwrap_or_default(),
    };
    save(&app, &state)?;
    STATE
        .set(Mutex::new(state))
        .map_err(|_| "Lifecycle initialized twice")?;
    APP.set(app.clone())
        .map_err(|_| "Power initialized twice")?;
    thread::spawn(move || loop {
        // Architecture contract: native last_alive is persisted once per minute.
        thread::sleep(Duration::from_secs(60));
        let result = (|| {
            let mut state = STATE.get().unwrap().lock().map_err(|e| e.to_string())?;
            state.last_alive = now_ms();
            save(&app, &state).map(|_| ())
        })();
        if let Err(error) = result {
            eprintln!("lifecycle heartbeat: {error}");
            let _ = app.emit("native-error", error);
        }
    });
    thread::spawn(|| unsafe {
        let name: Vec<u16> = "TaskTerminalPowerMonitor\0".encode_utf16().collect();
        let instance = GetModuleHandleW(std::ptr::null());
        let class = WNDCLASSW {
            lpfnWndProc: Some(procedure),
            hInstance: instance,
            lpszClassName: name.as_ptr(),
            ..std::mem::zeroed()
        };
        if RegisterClassW(&class) == 0 {
            eprintln!("RegisterClassW failed");
            return;
        }
        // Invisible top-level window receives broadcasts; HWND_MESSAGE would not.
        let window = CreateWindowExW(
            0,
            name.as_ptr(),
            name.as_ptr(),
            0,
            0,
            0,
            0,
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            instance,
            std::ptr::null(),
        );
        if window.is_null() {
            eprintln!("Power window creation failed");
            return;
        }
        let mut message: MSG = std::mem::zeroed();
        while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn owner_locked_snapshot_remains_immutable_when_subsequent_heartbeat_or_power_events_write_to_disk() {
        let dir = std::env::temp_dir().join(format!("monorail-power-snapshot-test-{}", now_ms()));
        fs::create_dir_all(&dir).unwrap();
        let mutex = Mutex::new(Lifecycle {
            last_alive: 100,
            previous_last_alive: Some(50),
            startup_at: 60,
            events: Vec::new(),
        });

        let captured_snapshot = {
            let mut state = mutex.lock().unwrap();
            state.last_alive = 200;
            serialize_and_save_to_dir(&dir, &state).unwrap()
        };

        // Subsequent power events and heartbeats mutate disk lifecycle.json without losing events,
        // while the captured byte snapshot remains a self-consistent point-in-time image for backup.
        {
            let mut state = mutex.lock().unwrap();
            record_in_state(&mut state, "suspend", 250, true);
            record_in_state(&mut state, "resume", 280, true);
            state.last_alive = 300;
            serialize_and_save_to_dir(&dir, &state).unwrap();
        }

        let parsed_snapshot: Lifecycle = serde_json::from_slice(&captured_snapshot).unwrap();
        assert_eq!(parsed_snapshot.last_alive, 200);
        assert!(parsed_snapshot.events.is_empty());

        let disk_current: Lifecycle =
            serde_json::from_slice(&fs::read(dir.join("lifecycle.json")).unwrap()).unwrap();
        assert_eq!(disk_current.last_alive, 300);
        assert_eq!(disk_current.events.len(), 2);
        assert_eq!(disk_current.events[1].suspended_at, Some(250));

        let _ = fs::remove_dir_all(dir);
    }
}
