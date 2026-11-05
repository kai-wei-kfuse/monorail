use serde::{Deserialize, Serialize};
use std::{fs, path::Path, sync::{Arc, atomic::{AtomicBool, Ordering}, mpsc}};
use tauri::{Manager, PhysicalPosition, PhysicalSize, WebviewWindow, WindowEvent};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    UI::{Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::{WM_ENTERSIZEMOVE, WM_EXITSIZEMOVE, WM_NCDESTROY, WM_NCHITTEST, WM_NCLBUTTONDOWN,
            HTTOP, HTBOTTOM, HTTOPLEFT, HTBOTTOMLEFT, HTTOPRIGHT, HTBOTTOMRIGHT, HTLEFT, HTRIGHT, HTCLIENT}},
};
static SWITCH: std::sync::Mutex<()> = std::sync::Mutex::new(());
const MOVE_SUBCLASS_ID: usize = 0x4d47454f; // MGEO

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
struct Geometry { x: i32, y: i32, width: u32, height: u32 }

#[derive(Debug, Clone, Copy, PartialEq)]
struct WorkArea { x: i32, y: i32, width: u32, height: u32 }

fn clamp_to_work_area(geometry: Geometry, area: WorkArea) -> (i32, i32) {
    let max_x = (area.x + area.width as i32 - geometry.width as i32).max(area.x);
    let max_y = (area.y + area.height as i32 - geometry.height as i32).max(area.y);
    (geometry.x.clamp(area.x, max_x), geometry.y.clamp(area.y, max_y))
}

fn current_work_area(window: &WebviewWindow) -> Result<Option<WorkArea>, String> {
    let monitor = match window.current_monitor().map_err(|e| e.to_string())? {
        Some(monitor) => Some(monitor),
        None => window.primary_monitor().map_err(|e| e.to_string())?,
    };
    Ok(monitor.map(|monitor| {
        let area = monitor.work_area();
        WorkArea { x: area.position.x, y: area.position.y, width: area.size.width, height: area.size.height }
    }))
}

fn read_geometry(path: &Path) -> Result<Option<Geometry>, String> {
    match fs::read(path) {
        Ok(bytes) => {
            let value: Geometry = serde_json::from_slice(&bytes).map_err(|e| format!("小窗位置文件无效：{e}"))?;
            if value.width == 0 || value.height == 0 { return Err("小窗尺寸必须为正数".into()); }
            Ok(Some(value))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}
/// 弹层展开中（0.3.0-beta.4 D1）：收起时小窗本体的左上角（物理像素）、本体高度、向上展开时窗口上移了多少。
/// 展开期间位置和高度都是临时的，不保存、不夹紧；用户这时拖动小窗，按上移量换算回本体位置。
#[derive(Debug, Clone, Copy, PartialEq)]
struct Expanded { x: i32, y: i32, bar_height: u32, up_offset: i32 }
static EXPANDED: std::sync::Mutex<Option<Expanded>> = std::sync::Mutex::new(None);

/// 弹层放哪边、给多高（物理像素）：下面放得下就往下；放不下且上面更宽就往上；高度不超过那一侧的工作区剩余。
fn place_popup(bar_y: i32, bar_height: u32, popup: u32, area: WorkArea) -> (bool, u32) {
    let below = (area.y + area.height as i32 - (bar_y + bar_height as i32)).max(0) as u32;
    let above = (bar_y - area.y).max(0) as u32;
    let up = popup > below && above > below;
    (up, popup.min(if up { above } else { below }))
}

#[derive(Serialize)]
pub struct MiniFit { up: bool, popup: f64 }

/// 小窗随弹层变高（自动完成、分类下拉）。尺寸参数是逻辑像素；popup 为 0 表示收起，回到本体的位置和高度。
/// 锁只在读写状态时短暂持有：set_size / set_position 会同步触发 Resized，事件里的 save_geometry 也要拿这把锁。
fn expanded() -> Result<std::sync::MutexGuard<'static, Option<Expanded>>, String> { EXPANDED.lock().map_err(|e| e.to_string()) }

#[tauri::command]
pub fn fit_mini_window(window: WebviewWindow, width: f64, bar_height: f64, popup: f64) -> Result<MiniFit, String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let px = |v: f64| (v.max(0.0) * scale).round() as u32;
    let (w, bar) = (px(width), px(bar_height).max(1));
    if popup <= 0.0 {
        let anchor = expanded()?.take();
        window.set_size(PhysicalSize::new(w, bar)).map_err(|e| e.to_string())?;
        if let Some(anchor) = anchor { window.set_position(PhysicalPosition::new(anchor.x, anchor.y)).map_err(|e| e.to_string())?; }
        save_geometry(&window, false)?;
        return Ok(MiniFit { up: false, popup: 0.0 });
    }
    let current = *expanded()?;
    let (x, y) = match current {
        Some(anchor) => (anchor.x, anchor.y),
        None => { let p = window.outer_position().map_err(|e| e.to_string())?; (p.x, p.y) }
    };
    let (up, granted) = match current_work_area(&window)? {
        Some(area) => place_popup(y, bar, px(popup), area),
        None => (false, px(popup)),
    };
    let up_offset = if up { granted as i32 } else { 0 };
    *expanded()? = Some(Expanded { x, y, bar_height: bar, up_offset });
    window.set_size(PhysicalSize::new(w, bar + granted)).map_err(|e| e.to_string())?;
    window.set_position(PhysicalPosition::new(x, y - up_offset)).map_err(|e| e.to_string())?;
    Ok(MiniFit { up, popup: granted as f64 / scale })
}

/// 隐藏前把展开的弹层收回去，下次打开时窗口是本体的大小和位置。
fn collapse(window: &WebviewWindow) -> Result<(), String> {
    let anchor = expanded()?.take();
    if let Some(anchor) = anchor {
        let size = window.inner_size().map_err(|e| e.to_string())?;
        window.set_size(PhysicalSize::new(size.width, anchor.bar_height)).map_err(|e| e.to_string())?;
        window.set_position(PhysicalPosition::new(anchor.x, anchor.y)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// user_moved：用户刚拖完小窗（WM_EXITSIZEMOVE）。展开中只有这时才按上移量把新位置换算回本体位置；
/// 其余时候（程序自己改尺寸、位置引起的 Resized）展开中的位置是临时的，原样记本体，不夹紧、不挪窗口。
fn save_geometry(window: &WebviewWindow, user_moved: bool) -> Result<(), String> {
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.inner_size().map_err(|e| e.to_string())?;
    // Minimized windows can report an empty client area; preserve the last usable geometry.
    if size.width == 0 || size.height == 0 { return Ok(()); }
    let anchor = {
        let mut state = expanded()?;
        if let (true, Some(anchor)) = (user_moved, state.as_mut()) {
            anchor.x = position.x;
            anchor.y = position.y + anchor.up_offset;
        }
        *state
    };
    if let Some(anchor) = anchor {
        let value = Geometry { x: anchor.x, y: anchor.y, width: size.width, height: anchor.bar_height };
        let path = super::config_dir(window.app_handle())?.join("mini-window.json");
        return fs::write(path, serde_json::to_vec(&value).map_err(|e| e.to_string())?).map_err(|e| e.to_string());
    }
    let mut value = Geometry { x: position.x, y: position.y, width: size.width, height: size.height };
    if let Some(area) = current_work_area(window)? {
        let (cx, cy) = clamp_to_work_area(value, area);
        if (cx, cy) != (value.x, value.y) {
            window.set_position(PhysicalPosition::new(cx, cy)).map_err(|e| e.to_string())?;
            value.x = cx;
            value.y = cy;
        }
    }
    let path = super::config_dir(window.app_handle())?.join("mini-window.json");
    fs::write(path, serde_json::to_vec(&value).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

struct MoveHook { in_sizemove: Arc<AtomicBool>, window: WebviewWindow }

fn horizontal_resize_hit(hit: LRESULT) -> LRESULT {
    match hit as u32 {
        HTTOP | HTBOTTOM => HTCLIENT as LRESULT,
        HTTOPLEFT | HTBOTTOMLEFT => HTLEFT as LRESULT,
        HTTOPRIGHT | HTBOTTOMRIGHT => HTRIGHT as LRESULT,
        _ => hit,
    }
}

fn horizontal_resize_command(hit: WPARAM) -> Option<WPARAM> {
    let mapped = horizontal_resize_hit(hit as LRESULT);
    if mapped == HTCLIENT as LRESULT { None } else { Some(mapped as WPARAM) }
}

unsafe extern "system" fn sizemove_proc(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM, id: usize, data: usize) -> LRESULT {
    if message == WM_NCLBUTTONDOWN {
        // Tauri's separate resize-border child posts this directly, bypassing the parent's hit test.
        return match horizontal_resize_command(wparam) {
            Some(hit) => unsafe { DefSubclassProc(hwnd, message, hit, lparam) },
            None => 0,
        };
    }
    if message == WM_NCHITTEST {
        // Prevent entering vertical sizing at all, rather than fighting the resize with equal height constraints.
        return horizontal_resize_hit(unsafe { DefSubclassProc(hwnd, message, wparam, lparam) });
    }
    if message == WM_NCDESTROY {
        unsafe { RemoveWindowSubclass(hwnd, Some(sizemove_proc), id); }
        unsafe { drop(Box::from_raw(data as *mut MoveHook)); }
        return unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
    }
    let hook = unsafe { &*(data as *const MoveHook) };
    if message == WM_ENTERSIZEMOVE {
        hook.in_sizemove.store(true, Ordering::SeqCst);
    } else if message == WM_EXITSIZEMOVE {
        hook.in_sizemove.store(false, Ordering::SeqCst);
        let result = unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
        if let Err(error) = save_geometry(&hook.window, true) { eprintln!("mini window: {error}"); }
        return result;
    }
    unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
}

fn install_sizemove_guard(window: &WebviewWindow, in_sizemove: Arc<AtomicBool>) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as usize;
    let clone = window.clone();
    let (sender, receiver) = mpsc::channel();
    window.run_on_main_thread(move || {
        let raw = Box::into_raw(Box::new(MoveHook { in_sizemove, window: clone }));
        let result = if unsafe { SetWindowSubclass(hwnd as HWND, Some(sizemove_proc), MOVE_SUBCLASS_ID, raw as usize) } == 0 {
            unsafe { drop(Box::from_raw(raw)); }
            Err("无法监听小窗的拖动完成状态".into())
        } else { Ok(()) };
        if sender.send(result).is_err() { eprintln!("mini sizemove installation receiver disconnected"); }
    }).map_err(|e| e.to_string())?;
    receiver.recv().map_err(|e| e.to_string())?
}

fn create(app: &tauri::AppHandle) -> Result<WebviewWindow, String> {
    let config = app.config().app.windows.iter().find(|window| window.label == "mini").ok_or("缺少小窗配置")?;
    let geometry = read_geometry(&super::config_dir(app)?.join("mini-window.json"))?;
    let window = tauri::WebviewWindowBuilder::from_config(app, config).map_err(|e| e.to_string())?.build().map_err(|e| e.to_string())?;
    if let Err(error) = super::mini_visibility::install(&window) {
        window.destroy().map_err(|cleanup| format!("{error}；小窗清理失败：{cleanup}"))?;
        return Err(error);
    }
    let in_sizemove = Arc::new(AtomicBool::new(false));
    if let Err(error) = install_sizemove_guard(&window, in_sizemove.clone()) {
        window.destroy().map_err(|cleanup| format!("{error}；小窗清理失败：{cleanup}"))?;
        return Err(error);
    }
    if let Some(value) = geometry {
        window.set_size(PhysicalSize::new(value.width, value.height)).map_err(|e| e.to_string())?;
        window.set_position(PhysicalPosition::new(value.x, value.y)).map_err(|e| e.to_string())?;
    }
    save_geometry(&window, false)?;
    let target = window.clone();
    window.on_window_event(move |event| {
        let result = match event {
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = collapse(&target);
                let _ = save_geometry(&target, false);
                target.hide().map_err(|e| e.to_string())
            }
            WindowEvent::Resized(_) if !in_sizemove.load(Ordering::SeqCst) => save_geometry(&target, false),
            _ => Ok(()),
        };
        if let Err(error) = result { eprintln!("mini window: {error}"); }
    });
    Ok(window)
}

#[tauri::command]
pub async fn toggle_mini(app: tauri::AppHandle) -> Result<bool, String> {
    // WebView2 creation deadlocks on the Windows UI thread (Tauri from_config contract).
    // Serialize tray and IPC toggles inside the blocking worker, including first creation.
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = SWITCH.lock().map_err(|e| e.to_string())?;
        toggle(&app)
    }).await.map_err(|e| e.to_string())?
}
fn toggle(app: &tauri::AppHandle) -> Result<bool, String> {
    let window = match app.get_webview_window("mini") { Some(window) => window, None => create(app)? };
    if window.is_visible().map_err(|e| e.to_string())? {
        collapse(&window)?;
        save_geometry(&window, false)?;
        window.hide().map_err(|e| e.to_string())?;
        Ok(false)
    } else {
        save_geometry(&window, false)?;
        window.show().and_then(|_| window.set_focus()).map_err(|e| e.to_string())?;
        Ok(true)
    }
}

#[tauri::command]
pub fn show_main(app: tauri::AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("缺少主窗口")?;
    window.unminimize().and_then(|_| window.show()).and_then(|_| window.set_focus()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resize_hits_disable_vertical_edges_and_keep_corners_horizontal() {
        for (hit, expected) in [
            (HTTOP, HTCLIENT), (HTBOTTOM, HTCLIENT),
            (HTTOPLEFT, HTLEFT), (HTBOTTOMLEFT, HTLEFT),
            (HTTOPRIGHT, HTRIGHT), (HTBOTTOMRIGHT, HTRIGHT),
            (HTLEFT, HTLEFT), (HTRIGHT, HTRIGHT), (HTCLIENT, HTCLIENT),
        ] {
            assert_eq!(horizontal_resize_hit(hit as LRESULT), expected as LRESULT);
        }
        assert_eq!(horizontal_resize_hit(-1), -1, "non-resize hit results must pass through");
    }
    #[test]
    fn resize_border_child_cannot_start_a_vertical_resize() {
        for hit in [HTTOP, HTBOTTOM] {
            assert_eq!(horizontal_resize_command(hit as WPARAM), None);
        }
        for (hit, expected) in [(HTLEFT, HTLEFT), (HTRIGHT, HTRIGHT),
            (HTTOPLEFT, HTLEFT), (HTBOTTOMLEFT, HTLEFT), (HTTOPRIGHT, HTRIGHT), (HTBOTTOMRIGHT, HTRIGHT)] {
            assert_eq!(horizontal_resize_command(hit as WPARAM), Some(expected as WPARAM));
        }
    }
    #[test]
    fn geometry_round_trip_and_corruption_are_explicit() {
        let path = std::env::temp_dir().join(format!("monorail-mini-{}.json", std::process::id()));
        let value = Geometry { x: -1200, y: 40, width: 520, height: 88 };
        fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
        assert_eq!(read_geometry(&path).unwrap(), Some(value));
        fs::write(&path, b"broken").unwrap();
        assert!(read_geometry(&path).is_err());
        fs::write(&path, br#"{"x":0,"y":0,"width":0,"height":88}"#).unwrap();
        assert!(read_geometry(&path).is_err());
        fs::remove_file(&path).unwrap();
        assert_eq!(read_geometry(&path).unwrap(), None);
    }
    #[test]
    fn clamp_to_work_area_keeps_window_above_taskbar_and_inside_monitor() {
        let area = WorkArea { x: 0, y: 0, width: 2560, height: 1392 };
        let overlap = Geometry { x: 2, y: 1370, width: 320, height: 46 };
        assert_eq!(clamp_to_work_area(overlap, area), (2, 1346));
        let expanded = Geometry { x: 2, y: 1346, width: 520, height: 88 };
        assert_eq!(clamp_to_work_area(expanded, area), (2, 1304));
        let negative = Geometry { x: -100, y: -20, width: 320, height: 46 };
        assert_eq!(clamp_to_work_area(negative, area), (0, 0));
    }
    #[test]
    fn popup_opens_down_when_it_fits_and_flips_up_only_when_above_is_roomier() {
        let area = WorkArea { x: 0, y: 0, width: 2560, height: 1392 };
        // 靠上：下面放得下，往下，给全高
        assert_eq!(place_popup(100, 46, 600, area), (false, 600));
        // 贴底边：下面只剩 10，上面宽，往上，给全高
        assert_eq!(place_popup(1336, 46, 600, area), (true, 600));
        // 上下都放不下：选更宽的一侧，高度截到那一侧的剩余
        assert_eq!(place_popup(400, 46, 1200, area), (false, 946));
        assert_eq!(place_popup(1000, 46, 1200, area), (true, 1000));
        // 下面不够但比上面宽：仍往下，截到下面的剩余
        assert_eq!(place_popup(300, 46, 1200, area), (false, 1046));
        // 副屏在主屏上方（负坐标）
        let upper = WorkArea { x: 0, y: -1080, width: 1920, height: 1040 };
        assert_eq!(place_popup(-80, 46, 400, upper), (true, 400));
    }
}
