use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};

pub fn setup(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let open = MenuItem::with_id(app, "open", "打开任务终端", true, None::<&str>)?;
    let quick = MenuItem::with_id(
        app,
        "quick",
        "快速记录 Ctrl+Alt+Shift+R",
        true,
        None::<&str>,
    )?;
    let exit = MenuItem::with_id(app, "exit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quick, &exit])?;
    let pixels = vec![32u8; 16 * 16 * 4];
    TrayIconBuilder::new()
        .icon(tauri::image::Image::new_owned(pixels, 16, 16))
        .menu(&menu)
        .tooltip("Task Terminal Skeleton")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => {
                if let Some(w) = app.get_webview_window("main") {
                    if let Err(e) = w.show().and_then(|_| w.set_focus()) {
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
            _ => {}
        })
        .build(app)?;
    Ok(())
}
