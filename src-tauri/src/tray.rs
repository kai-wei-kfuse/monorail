use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};

pub fn setup(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let open = MenuItem::with_id(app, "open", "显示主窗口", true, None::<&str>)?;
    let quick = MenuItem::with_id(
        app,
        "quick",
        "快速记录",
        true,
        None::<&str>,
    )?;
    let exit = MenuItem::with_id(app, "exit", "退出", true, None::<&str>)?;
    let mini = MenuItem::with_id(app, "mini", "开启 / 关闭小窗口", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quick, &mini, &exit])?;
    TrayIconBuilder::new()
        .icon(app.default_window_icon().ok_or("Missing application icon")?.clone())
        .menu(&menu)
        .tooltip("单轨")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => {
                if let Some(w) = app.get_webview_window("main") {
                    if let Err(e) = w.unminimize().and_then(|_| w.show()).and_then(|_| w.set_focus()) {
                        eprintln!("show: {e}");
                    }
                }
            }
            "quick" => {
                if let Err(e) = super::windows::show_quickbar(app.clone()) {
                    eprintln!("quickbar: {e}");
                }
            }
            "exit" => app.exit(0),
            "mini" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = super::mini_window::toggle_mini(app).await { eprintln!("mini: {error}"); }
                });
            }
            _ => {}
        })
        .build(app)?;
    Ok(())
}
