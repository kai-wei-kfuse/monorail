fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "read_config",
            "save_config",
            "save_quick_record",
            "save_attachment",
            "evidence",
            "read_lifecycle",
            "simulate_power",
            "set_reminders",
            "show_quickbar",
            "dialog_active",
            "shortcut_error",
            "set_shortcut",
            "verification_enabled",
        ]),
    ))
    .expect("Tauri build configuration failed");
}
