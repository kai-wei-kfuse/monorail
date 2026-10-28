use serde::Serialize;
use std::{cell::Cell, sync::{atomic::{AtomicU64, Ordering}, mpsc}};
use tauri::{Emitter, Manager, WebviewWindow};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    UI::{Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::{IsWindowVisible, WINDOWPOS, WM_NCDESTROY, WM_WINDOWPOSCHANGED, SWP_HIDEWINDOW, SWP_SHOWWINDOW}},
};

// Only the mini HWND's UI-thread notifications advance this sequence. It is not a cached visibility flag.
static REVISION: AtomicU64 = AtomicU64::new(0);
const SUBCLASS_ID: usize = 0x4d494e49; // MINI; unique within this HWND and callback pair.
#[derive(Clone, Copy, Serialize)]
pub struct Visibility { visible: bool, revision: u64 }
struct Hook { last_visible: Cell<bool>, notify: Box<dyn Fn(bool) + Send> }
impl Hook {
    fn changed(&self, visible: bool) {
        // Destruction sends both HIDEWINDOW and NCDESTROY. Emit only the actual transition.
        if self.last_visible.replace(visible) != visible { (self.notify)(visible); }
    }
}

unsafe extern "system" fn visibility_proc(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM, id: usize, data: usize) -> LRESULT {
    if message == WM_NCDESTROY {
        // The UI thread owns the allocation after install; detach before forwarding destruction.
        unsafe { RemoveWindowSubclass(hwnd, Some(visibility_proc), id); }
        let hook = unsafe { Box::from_raw(data as *mut Hook) };
        hook.changed(false);
        return unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
    }
    if message == WM_WINDOWPOSCHANGED {
        let position = unsafe { &*(lparam as *const WINDOWPOS) };
        if position.flags & (SWP_SHOWWINDOW | SWP_HIDEWINDOW) != 0 {
            let hook = unsafe { &*(data as *const Hook) };
            hook.changed(unsafe { IsWindowVisible(hwnd) } != 0);
        }
    }
    unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
}

/// Must run on the HWND's own UI thread. Covers JS hide(), tray toggles, and native close alike.
unsafe fn attach(hwnd: HWND, notify: impl Fn(bool) + Send + 'static) -> Result<(), String> {
    let hook = Box::into_raw(Box::new(Hook { last_visible: Cell::new(unsafe { IsWindowVisible(hwnd) } != 0), notify: Box::new(notify) }));
    if unsafe { SetWindowSubclass(hwnd, Some(visibility_proc), SUBCLASS_ID, hook as usize) } == 0 {
        unsafe { drop(Box::from_raw(hook)); }
        return Err("无法监听小窗的原生显示状态".into());
    }
    Ok(())
}

/// Called from the existing blocking window-creation worker, before its first show().
pub fn install(window: &WebviewWindow) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as usize;
    let app = window.app_handle().clone();
    let (sender, receiver) = mpsc::channel();
    window.run_on_main_thread(move || {
        let result = unsafe { attach(hwnd as HWND, move |visible| {
            let revision = REVISION.fetch_add(1, Ordering::SeqCst) + 1;
            if let Err(error) = app.emit_to("main", "mini-visibility", Visibility { visible, revision }) {
                eprintln!("mini visibility: {error}");
            }
        }) };
        if sender.send(result).is_err() { eprintln!("mini visibility installation receiver disconnected"); }
    }).map_err(|e| e.to_string())?;
    receiver.recv().map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn read_mini_visibility(app: tauri::AppHandle) -> Result<Visibility, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (sender, receiver) = mpsc::channel();
        let target = app.clone();
        app.run_on_main_thread(move || {
            // Query and revision are sampled together on the window thread, including lazy creation.
            let result = (|| {
                let visible = match target.get_webview_window("mini") {
                    None => false,
                    Some(window) => (unsafe { IsWindowVisible(window.hwnd().map_err(|e| e.to_string())?.0) }) != 0,
                };
                Ok(Visibility { visible, revision: REVISION.load(Ordering::SeqCst) })
            })();
            if sender.send(result).is_err() { eprintln!("mini visibility query receiver disconnected"); }
        }).map_err(|e| e.to_string())?;
        receiver.recv().map_err(|e| e.to_string())?
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use windows_sys::Win32::UI::WindowsAndMessaging::{CreateWindowExW, DestroyWindow, ShowWindow, SetWindowPos,
        SW_HIDE, SW_SHOWNOACTIVATE, WS_POPUP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOZORDER};

    #[test]
    fn actual_hwnd_show_hide_and_destroy_notify_without_focus_or_polling() {
        unsafe {
            // Built-in class, no application data or Tauri context. Show without stealing keyboard focus.
            let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
            let hwnd = CreateWindowExW(0, class.as_ptr(), std::ptr::null(), WS_POPUP, 0, 0, 1, 1,
                std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null());
            assert!(!hwnd.is_null());
            struct Window(HWND);
            impl Drop for Window { fn drop(&mut self) { unsafe { DestroyWindow(self.0); } } }
            let window = Window(hwnd);
            let values = Arc::new(Mutex::new(Vec::new()));
            let received = values.clone();
            attach(hwnd, move |visible| received.lock().unwrap().push(visible)).unwrap();
            ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            assert_eq!(*values.lock().unwrap(), vec![true]);
            // Content-driven resizing must not masquerade as a visibility change.
            SetWindowPos(hwnd, std::ptr::null_mut(), 0, 0, 2, 2, SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOZORDER);
            assert_eq!(*values.lock().unwrap(), vec![true]);
            ShowWindow(hwnd, SW_HIDE);
            assert_eq!(*values.lock().unwrap(), vec![true, false]);
            ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            drop(window);
            assert_eq!(*values.lock().unwrap(), vec![true, false, true, false]);
            assert_eq!(Arc::strong_count(&values), 1, "destroy must release the subclass callback");
        }
    }
    #[test]
    fn failed_attachment_releases_the_callback() {
        let owned = Arc::new(());
        let held = owned.clone();
        let result = unsafe { attach(std::ptr::null_mut(), move |_| { let _ = &held; }) };
        assert!(result.is_err());
        assert_eq!(Arc::strong_count(&owned), 1);
    }
}
