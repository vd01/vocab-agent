use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    image::Image,
    menu::{CheckMenuItemBuilder, MenuBuilder, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    App, AppHandle, Manager, Runtime,
};

static LAST_TOGGLE: AtomicBool = AtomicBool::new(false);

fn setup_html_b64() -> String {
    use data_encoding::BASE64;
    BASE64.encode(include_bytes!("../../desktop-dist/index.html"))
}

pub fn setup_tray<R: Runtime>(app: &App<R>) -> Result<(), Box<dyn std::error::Error>> {
    let show_item = MenuItem::with_id(app, "show", "显示/隐藏", true, None::<&str>)?;
    let quick_lookup_item = MenuItem::with_id(app, "quick-lookup", "快捷查词", true, None::<&str>)?;
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
        .item(&quick_lookup_item)
        .item(&separator1)
        .item(&reminder_item)
        .item(&separator2)
        .item(&settings_item)
        .item(&separator3)
        .item(&quit_item)
        .build()?;

    let icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))?;

    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .show_menu_on_left_click(false)
        .menu(&menu)
        .tooltip("Vocab Agent Lite")
        .on_menu_event(move |app_handle, event| match event.id().0.as_str() {
            "show" => {
                toggle_window(app_handle);
            }
            "quick-lookup" => {
                crate::toggle_quick_lookup(app_handle);
            }
            "reminder" => {
                let store = app_handle.state::<crate::store::AppStore>();
                let new_val = !store.get().review_reminder;
                let _ = store.set(serde_json::json!({ "review_reminder": new_val }));
            }
            "settings" => {
                if let Some(win) = app_handle.get_webview_window("main") {
                    let html_b64 = setup_html_b64();
                    let _ = win.eval(format!(
                        "(function(){{var b=atob('{}');var u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);var h=new TextDecoder('utf-8').decode(u);document.open();document.write(h);document.close();}})();",
                        html_b64
                    ));
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
            if let tauri::tray::TrayIconEvent::Click { button, .. } = event {
                if button == tauri::tray::MouseButton::Left {
                    if LAST_TOGGLE.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
                        return;
                    }
                    let app = tray.app_handle();
                    toggle_window(app);
                    std::thread::spawn(|| {
                        std::thread::sleep(std::time::Duration::from_millis(300));
                        LAST_TOGGLE.store(false, Ordering::SeqCst);
                    });
                }
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
