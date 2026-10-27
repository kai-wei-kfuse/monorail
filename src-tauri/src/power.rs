use serde::{Deserialize, Serialize};
use std::{
    fs,
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

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Lifecycle {
    pub last_alive: u64,
    pub previous_last_alive: Option<u64>,
    pub startup_at: u64,
    pub events: Vec<PowerEvent>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct PowerEvent {
    kind: String,
    at: u64,
    simulated: bool,
    #[serde(default)]
    suspended_at: Option<u64>,
    #[serde(default)]
    resumed_at: Option<u64>,
}
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
static STATE: OnceLock<Mutex<Lifecycle>> = OnceLock::new();

pub fn checkpoint() -> Result<(), String> {
    let app = APP.get().ok_or("Power monitor not initialized")?;
    let mut state = STATE.get().ok_or("Missing lifecycle")?.lock().map_err(|error| error.to_string())?;
    state.last_alive = now_ms();
    save(app, &state)
}
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("System clock before epoch")
        .as_millis() as u64
}

fn save(app: &tauri::AppHandle, state: &Lifecycle) -> Result<(), String> {
    let path = super::config_dir(app)?.join("lifecycle.json");
    let temp = path.with_extension("tmp");
    fs::write(
        &temp,
        serde_json::to_vec_pretty(state).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(temp, path).map_err(|e| e.to_string())
}
fn record(kind: &str, simulated: bool) -> Result<(), String> {
    let app = APP.get().ok_or("Power monitor not initialized")?;
    let mut state = STATE
        .get()
        .ok_or("Missing lifecycle")?
        .lock()
        .map_err(|e| e.to_string())?;
    let at = now_ms();
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
    save(app, &state)?;
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
            save(&app, &state)
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
