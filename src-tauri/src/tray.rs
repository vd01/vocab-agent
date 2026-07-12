use tauri::{
    menu::{MenuBuilder, MenuItem, PredefinedMenuItem, CheckMenuItemBuilder},
    tray::TrayIconBuilder,
    App, AppHandle, Manager, Runtime,
};

pub fn setup_tray<R: Runtime>(app: &App<R>) -> Result<(), Box<dyn std::error::Error>> {
    let show_item = MenuItem::with_id(app, "show", "显示/隐藏", true, None::<&str>)?;
    let separator1 = PredefinedMenuItem::separator(app)?;
    let reminder_item = CheckMenuItemBuilder::with_id("reminder", "复习提醒")
        .checked(true)
        .build(app)?;
    let separator2 = PredefinedMenuItem::separator(app)?;
    let settings_item = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
    let separator3 = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    let menu = MenuBuilder::new(app)
        .item(&show_item)
        .item(&separator1)
        .item(&reminder_item)
        .item(&separator2)
        .item(&settings_item)
        .item(&separator3)
        .item(&quit_item)
        .build()?;

    let _tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("Vocab Agent Lite")
        .on_menu_event(move |app_handle, event| match event.id().0.as_str() {
            "show" => {
                toggle_window(app_handle);
            }
            "reminder" => {
                let store = app_handle.state::<crate::store::AppStore>();
                let mut cfg = store.get();
                let new_val = !cfg.review_reminder;
                let _ = store.set(serde_json::json!({ "review_reminder": new_val }));
                cfg.review_reminder = new_val;
            }
            "settings" => {
                if let Some(win) = app_handle.get_webview_window("main") {
                    let cfg = app_handle.state::<crate::store::AppStore>().get();
                    if cfg.server_url.is_empty() {
                        let _ = win.eval("window.location.href = 'tauri://localhost'");
                    } else {
                        let base = cfg.server_url.trim_end_matches('/');
                        let _ = win.eval(&format!("window.location.href = '{}/settings'", base));
                    }
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
            "quit" => {
                app_handle.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click { .. } = event {
                let app = tray.app_handle();
                toggle_window(app);
            }
        })
        .build(app)?;

    Ok(())
}

fn toggle_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_visible().unwrap_or(false) && win.is_focused().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
        }
    }
}
