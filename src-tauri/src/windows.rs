use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    UI::{Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::{WA_INACTIVE, WM_ACTIVATE, WM_NCDESTROY}},
};
static DIALOG: AtomicBool = AtomicBool::new(false);
static SHORTCUTS: Mutex<Vec<(String, Shortcut)>> = Mutex::new(Vec::new());
const QUICKBAR_ACTIVATION_SUBCLASS_ID: usize = 0x51424143; // QBAC
struct QuickbarActivationHook { hide: Box<dyn Fn() + Send> }

unsafe extern "system" fn quickbar_activation_proc(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM, id: usize, data: usize) -> LRESULT {
    if message == WM_NCDESTROY {
        unsafe { RemoveWindowSubclass(hwnd, Some(quickbar_activation_proc), id); }
        unsafe { drop(Box::from_raw(data as *mut QuickbarActivationHook)); }
        return unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
    }
    let result = unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
    // WebView2 moves keyboard focus during native dragging. Only top-level deactivation means leaving the quick bar.
    if message == WM_ACTIVATE && (wparam & 0xffff) == WA_INACTIVE as usize && !DIALOG.load(Ordering::SeqCst) {
        let hook = unsafe { &*(data as *const QuickbarActivationHook) };
        (hook.hide)();
    }
    result
}

// setup runs on the window's UI thread, as required by SetWindowSubclass.
unsafe fn install_quickbar_auto_hide(hwnd: HWND, hide: impl Fn() + Send + 'static) -> Result<(), String> {
    let hook = Box::into_raw(Box::new(QuickbarActivationHook { hide: Box::new(hide) }));
    if unsafe { SetWindowSubclass(hwnd, Some(quickbar_activation_proc), QUICKBAR_ACTIVATION_SUBCLASS_ID, hook as usize) } == 0 {
        unsafe { drop(Box::from_raw(hook)); }
        return Err("无法监听快速记录窗口的激活状态".into());
    }
    Ok(())
}

fn parse_shortcut(shortcut: &str) -> Result<Shortcut, String> {
    let normalized = shortcut.split('+').map(|token| {
        let token = token.trim();
        if token.eq_ignore_ascii_case("Win") { "Super" } else { token }
    }).collect::<Vec<_>>().join("+");
    normalized.parse().map_err(|e| format!("快捷键 {shortcut} 无效：{e}"))
}

fn registration_error(shortcut: &str, error: tauri_plugin_global_shortcut::Error) -> String {
    // Plugin 2.4.1 erases global-hotkey 0.8's AlreadyRegistered variant into this Display string.
    const ALREADY_REGISTERED: &str = "HotKey already registered: ";
    if matches!(&error, tauri_plugin_global_shortcut::Error::GlobalHotkey(message)
        if message.starts_with(ALREADY_REGISTERED)) {
        return format!("快捷键 {shortcut} 已被系统或别的程序占用，换一个组合");
    }
    format!("快捷键 {shortcut} 注册失败：{error}")
}

#[tauri::command]
pub fn set_shortcut(app: tauri::AppHandle, key: String, shortcut: String) -> Result<(), String> {
    let label = match key.as_str() {
        "quickbarHotkey" => "quickbar",
        "mainHotkey" => "main",
        _ => return Err(format!("Unknown shortcut key: {key}")),
    };
    // Existing explicit smoke-test override; never try alternative shortcuts on conflict.
    let shortcut = if label == "quickbar" {
        std::env::var("TASK_TERMINAL_SHORTCUT").unwrap_or(shortcut)
    } else { shortcut };
    let parsed = parse_shortcut(&shortcut)?;
    let mut bindings = SHORTCUTS.lock().map_err(|e| e.to_string())?;
    let previous = bindings.iter().find(|(k, _)| k == &key).map(|(_, s)| *s);
    if previous == Some(parsed) { return Ok(()); }
    if bindings.iter().any(|(k, s)| k != &key && *s == parsed) {
        return Err(format!("快捷键 {shortcut} 已由另一个设置项使用"));
    }
    // Acquire the replacement first: an OS conflict leaves the working binding intact.
    app.global_shortcut().on_shortcut(parsed, move |app, _, event| {
        if event.state != ShortcutState::Pressed { return; }
        if let Some(window) = app.get_webview_window(label) {
            let result = if label == "quickbar" {
                window.is_visible().and_then(|visible| if visible { window.hide() }
                    else { window.show().and_then(|_| window.set_focus()) })
            } else { window.unminimize().and_then(|_| window.show()).and_then(|_| window.set_focus()) };
            if let Err(error) = result { eprintln!("shortcut: {error}"); }
        }
    }).map_err(|error| registration_error(&shortcut, error))?;
    if let Some(old) = previous {
        if let Err(error) = app.global_shortcut().unregister(old) {
            let rollback = app.global_shortcut().unregister(parsed);
            return Err(format!("旧快捷键注销失败：{error}；新快捷键撤回结果：{rollback:?}"));
        }
    }
    bindings.retain(|(k, _)| k != &key);
    bindings.push((key, parsed));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{parse_shortcut, registration_error};
    use tauri_plugin_global_shortcut::{Error, Shortcut};

    #[test]
    fn quickbar_stays_visible_during_drag_and_hides_only_on_deactivation() {
        use super::{install_quickbar_auto_hide, DIALOG};
        use std::sync::{Arc, atomic::{AtomicUsize, Ordering}};
        use windows_sys::Win32::UI::WindowsAndMessaging::{CreateWindowExW, DestroyWindow, IsWindowVisible,
            SendMessageW, ShowWindow, SW_HIDE, SW_SHOWNOACTIVATE, WA_ACTIVE, WA_INACTIVE,
            WM_ACTIVATE, WM_ENTERSIZEMOVE, WM_EXITSIZEMOVE, WM_KILLFOCUS, WS_POPUP};
        unsafe {
            let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
            let hwnd = CreateWindowExW(0, class.as_ptr(), std::ptr::null(), WS_POPUP, 0, 0, 1, 1,
                std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null());
            assert!(!hwnd.is_null());
            struct Window(super::HWND);
            impl Drop for Window { fn drop(&mut self) { unsafe { DestroyWindow(self.0); } } }
            let _window = Window(hwnd);
            let hides = Arc::new(AtomicUsize::new(0));
            let received = hides.clone();
            let raw_hwnd = hwnd as usize;
            install_quickbar_auto_hide(hwnd, move || {
                received.fetch_add(1, Ordering::SeqCst);
                ShowWindow(raw_hwnd as super::HWND, SW_HIDE);
            }).unwrap();
            ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            for message in [WM_ENTERSIZEMOVE, WM_KILLFOCUS, WM_EXITSIZEMOVE] {
                SendMessageW(hwnd, message, 0, 0);
                assert_ne!(IsWindowVisible(hwnd), 0, "drag focus changes must not hide quickbar");
            }
            SendMessageW(hwnd, WM_ACTIVATE, WA_ACTIVE as usize, 0);
            assert_ne!(IsWindowVisible(hwnd), 0);
            DIALOG.store(true, Ordering::SeqCst);
            SendMessageW(hwnd, WM_ACTIVATE, WA_INACTIVE as usize, 0);
            DIALOG.store(false, Ordering::SeqCst);
            assert_ne!(IsWindowVisible(hwnd), 0, "native dialogs must preserve quickbar");
            SendMessageW(hwnd, WM_ACTIVATE, WA_INACTIVE as usize, 0);
            assert_eq!(IsWindowVisible(hwnd), 0, "leaving the window must still hide quickbar");
            assert!(hides.load(Ordering::SeqCst) > 0);
            for _ in 0..3 {
                let before = hides.load(Ordering::SeqCst);
                ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                assert_ne!(IsWindowVisible(hwnd), 0, "reopening must remain possible");
                SendMessageW(hwnd, WM_ACTIVATE, WA_INACTIVE as usize, 0);
                // ShowWindow may synchronously send another deactivation; every cycle must reach the hide callback.
                assert!(hides.load(Ordering::SeqCst) > before);
                assert_eq!(IsWindowVisible(hwnd), 0);
            }
            drop(_window);
            assert_eq!(Arc::strong_count(&hides), 1, "destroy must release the hide callback");
        }
    }

    #[test]
    fn failed_auto_hide_install_releases_the_callback() {
        let held = std::sync::Arc::new(());
        let callback = held.clone();
        assert!(unsafe { super::install_quickbar_auto_hide(std::ptr::null_mut(), move || { let _ = &callback; }) }.is_err());
        assert_eq!(std::sync::Arc::strong_count(&held), 1);
    }

    #[test]
    fn win_modifier_matches_super() {
        for (input, expected) in [
            ("Win+Shift+R", "Super+Shift+R"),
            ("Ctrl+Win+R", "Ctrl+Super+R"),
            ("wIn+Shift+R", "Super+Shift+R"),
            (" Ctrl + WIN + R ", "Ctrl+Super+R"),
            ("Ctrl+Alt+Shift+R", "Ctrl+Alt+Shift+R"),
        ] {
            assert_eq!(parse_shortcut(input).unwrap(), expected.parse::<Shortcut>().unwrap());
        }
    }

    #[test]
    fn win_modifier_order_does_not_change_the_shortcut() {
        assert_eq!(parse_shortcut("Shift+Win+R").unwrap(), parse_shortcut("Win+Shift+R").unwrap());
    }

    #[test]
    fn normalization_only_replaces_whole_modifier_tokens() {
        assert!(parse_shortcut("Window+R").is_err());
        assert!(parse_shortcut("Ctrl+Win++R").is_err());
    }

    #[test]
    fn registration_conflict_preserves_the_displayed_win_name() {
        let parsed = parse_shortcut("Win+Shift+R").unwrap();
        let error = Error::GlobalHotkey(format!("HotKey already registered: {parsed:?}"));
        assert_eq!(registration_error("Win+Shift+R", error),
            "快捷键 Win+Shift+R 已被系统或别的程序占用，换一个组合");
    }

    #[test]
    fn other_registration_errors_keep_their_details() {
        let error = Error::GlobalHotkey("native registration failure".into());
        assert_eq!(registration_error("Win+Shift+R", error),
            "快捷键 Win+Shift+R 注册失败：native registration failure");
    }
}

#[tauri::command]
pub fn dialog_active(active: bool) {
    DIALOG.store(active, Ordering::SeqCst);
}
#[tauri::command]
pub fn show_quickbar(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("quickbar")
        .ok_or("Missing quickbar")?;
    window
        .show()
        .and_then(|_| window.set_focus())
        .map_err(|e| e.to_string())
}
pub fn setup(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    for label in ["main", "quickbar"] {
        let window = app.get_webview_window(label).ok_or("Missing window")?;
        if label == "quickbar" {
            let quickbar = window.clone();
            // Tauri/Tao must update their visibility flags too; raw ShowWindow leaves show() thinking it is already visible.
            unsafe { install_quickbar_auto_hide(window.hwnd()?.0, move || {
                if let Err(error) = quickbar.hide() { eprintln!("hide quickbar: {error}"); }
            })?; }
        }
        let target = window.clone();
        window.on_window_event(move |event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                if let Err(e) = target.hide() {
                    eprintln!("hide: {e}");
                }
            }
            WindowEvent::Focused(true) if target.label() == "main" => {
                if let Err(e) = target.emit("main-visible", ()) {
                    eprintln!("emit: {e}");
                }
            }
            _ => {}
        });
    }
    // Bootstrap registers both bindings from settings.yaml through set_shortcut.
    Ok(())
}
