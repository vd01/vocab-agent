use store::AppStore;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

mod commands;
mod store;
mod tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&data_dir).ok();

            let store = AppStore::new(&data_dir);
            let cfg = store.get();

            app.manage(store);
            app.manage(commands::notification::ReminderState);

            tray::setup_tray(app)?;

            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{
                    Code, GlobalShortcutExt, Modifiers, ShortcutState,
                };

                let main_shortcut = parse_shortcut(&cfg.shortcut);
                let ql_shortcut = parse_shortcut(&cfg.quick_lookup_shortcut);

                // Extract (modifiers, code) for comparison in handler
                let main_key: Option<(Modifiers, Code)> = main_shortcut.map(|s| (s.mods, s.key));
                let ql_key: Option<(Modifiers, Code)> = ql_shortcut.map(|s| (s.mods, s.key));

                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |app, shortcut, event| {
                            if event.state() != ShortcutState::Pressed {
                                return;
                            }

                            let fired: (Modifiers, Code) = (shortcut.mods, shortcut.key);

                            // Check quick-lookup shortcut first
                            if let Some(qk) = ql_key {
                                if fired == qk {
                                    toggle_quick_lookup(app);
                                    return;
                                }
                            }

                            // Check main window shortcut
                            if let Some(mk) = main_key {
                                if fired == mk {
                                    if let Some(win) = app.get_webview_window("main") {
                                        if win.is_visible().unwrap_or(false)
                                            && win.is_focused().unwrap_or(false)
                                        {
                                            let _ = win.hide();
                                        } else {
                                            let _ = win.show();
                                            let _ = win.set_focus();
                                        }
                                    }
                                    return;
                                }
                            }

                            // Fallback: toggle main window for any other registered shortcut
                            if let Some(win) = app.get_webview_window("main") {
                                if win.is_visible().unwrap_or(false)
                                    && win.is_focused().unwrap_or(false)
                                {
                                    let _ = win.hide();
                                } else {
                                    let _ = win.show();
                                    let _ = win.set_focus();
                                }
                            }
                        })
                        .build(),
                )?;

                if let Some(shortcut) = main_shortcut {
                    let _ = app.handle().global_shortcut().register(shortcut);
                }
                if let Some(shortcut) = ql_shortcut {
                    let _ = app.handle().global_shortcut().register(shortcut);
                }
            }

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let store = app_handle.state::<AppStore>();
                let cfg = store.get();

                if !cfg.server_url.is_empty() {
                    let url = cfg.server_url.trim_end_matches('/');
                    log::info!("[Startup] Checking server at {}", url);

                    let client = match commands::config::http_client() {
                        Ok(c) => c,
                        Err(e) => {
                            log::error!("[Startup] Failed to create HTTP client: {}", e);
                            if let Some(win) = app_handle.get_webview_window("main") {
                                let _ = win.eval(format!("document.body.innerHTML = '<div style=\"display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui;color:#ef4444\"><p>HTTP 客户端创建失败: {}</p></div>'; document.body.style.background='#0a0a0a'", e));
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                            return;
                        }
                    };

                    let mut connected = false;
                    match client.get(url).send().await {
                        Ok(res) => {
                            let status = res.status();
                            log::info!("[Startup] Server responded: {}", status);
                            if status.is_success() || status == reqwest::StatusCode::FOUND || status == reqwest::StatusCode::TEMPORARY_REDIRECT {
                                connected = true;
                            }
                        }
                        Err(e) => {
                            log::error!("[Startup] Server check failed: {}", e);
                        }
                    }

                    if connected {
                        if let Some(win) = app_handle.get_webview_window("main") {
                            let _ = win.eval(format!("window.location.href = '{}'", url));
                            let _ = win.show();
                            let _ = win.set_focus();
                        }

                        if cfg.review_reminder {
                            spawn_reminder(app_handle.clone(), cfg.reminder_interval);
                        }
                    } else {
                        if let Some(win) = app_handle.get_webview_window("main") {
                            let _ = win.eval("if(typeof showConnectError === 'function') showConnectError(); else { document.body.innerHTML = '<div style=\"display:flex;align-items:center;justify-content:center;height:100vh;font-family:system-ui;color:#ef4444\"><p>无法连接到服务端，请通过托盘菜单打开设置重新配置</p></div>'; }");
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                } else {
                    if let Some(win) = app_handle.get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            let label = window.label().to_string();
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    if label == "quick-lookup" {
                        api.prevent_close();
                        let _ = window.hide();
                        return;
                    }
                    let store = window.state::<AppStore>();
                    let cfg = store.get();
                    if cfg.close_to_tray {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
                tauri::WindowEvent::Focused(false)
                    // Auto-hide quick-lookup window on focus loss
                    if label == "quick-lookup" => {
                        let _ = window.hide();
                    }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::config::config_get,
            commands::config::config_set,
            commands::config::check_server,
            commands::config::set_quick_lookup_shortcut,
            commands::clipboard::read_clipboard,
            commands::notification::reminder_start,
            commands::notification::reminder_stop,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn toggle_quick_lookup<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(win) = app.get_webview_window("quick-lookup") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
            // Notify frontend to check clipboard
            let _ = win.emit("quick-lookup-activated", ());
        }
    } else {
        // Create the quick-lookup window
        let store = app.state::<AppStore>();
        let cfg = store.get();
        let url = if cfg.server_url.is_empty() {
            // Dev mode or no server configured
            #[cfg(debug_assertions)]
            { "http://localhost:3088/quick-lookup".to_string() }
            #[cfg(not(debug_assertions))]
            { return; }
        } else {
            format!("{}/quick-lookup", cfg.server_url.trim_end_matches('/'))
        };

        let _win = WebviewWindowBuilder::new(app, "quick-lookup", WebviewUrl::External(url.parse().unwrap()))
            .title("Quick Lookup")
            .inner_size(480.0, 400.0)
            .min_inner_size(320.0, 200.0)
            .max_inner_size(600.0, 600.0)
            .center()
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(true)
            .visible(true)
            .build();
    }
}

fn spawn_reminder(app_handle: tauri::AppHandle, interval_minutes: u32) {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Duration;

    static REMINDER_STARTED: AtomicBool = AtomicBool::new(false);
    if REMINDER_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }

    let interval_secs = interval_minutes as u64 * 60;
    tauri::async_runtime::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(interval_secs));
        tick.tick().await;

        loop {
            tick.tick().await;

            let cfg = {
                let s = app_handle.state::<AppStore>();
                s.get()
            };

            if !cfg.review_reminder || cfg.server_url.is_empty() {
                continue;
            }

            let check_url = format!("{}/api/review-due", cfg.server_url.trim_end_matches('/'));

            let check_client = match commands::config::http_client() {
                Ok(c) => c,
                Err(_) => continue,
            };
            match check_client.get(&check_url).send().await {
                Ok(res) if res.status().is_success() => {
                    if let Ok(data) = res.json::<serde_json::Value>().await {
                        if let Some(due) = data.get("due").and_then(|v| v.as_u64()) {
                            if due > 0 {
                                use tauri_plugin_notification::NotificationExt;
                                let _ = app_handle
                                    .notification()
                                    .builder()
                                    .title("Vocab Agent Lite 复习提醒")
                                    .body(format!("你有 {} 个单词待复习", due))
                                    .show();
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    });
}

pub fn parse_shortcut(s: &str) -> Option<tauri_plugin_global_shortcut::Shortcut> {
    use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};

    let parts: Vec<&str> = s.split('+').map(|p| p.trim()).collect();
    if parts.is_empty() {
        return None;
    }

    let mut modifiers = Modifiers::empty();
    let mut code = None;

    for part in parts {
        match part.to_lowercase().as_str() {
            "ctrl" | "control" => modifiers |= Modifiers::CONTROL,
            "alt" => modifiers |= Modifiers::ALT,
            "shift" => modifiers |= Modifiers::SHIFT,
            "super" | "meta" | "win" | "command" | "cmd" => modifiers |= Modifiers::SUPER,
            c if c.len() == 1 && c.chars().next().unwrap().is_ascii_alphabetic() => {
                code = Some(match c.chars().next().unwrap() {
                    'a' => Code::KeyA,
                    'b' => Code::KeyB,
                    'c' => Code::KeyC,
                    'd' => Code::KeyD,
                    'e' => Code::KeyE,
                    'f' => Code::KeyF,
                    'g' => Code::KeyG,
                    'h' => Code::KeyH,
                    'i' => Code::KeyI,
                    'j' => Code::KeyJ,
                    'k' => Code::KeyK,
                    'l' => Code::KeyL,
                    'm' => Code::KeyM,
                    'n' => Code::KeyN,
                    'o' => Code::KeyO,
                    'p' => Code::KeyP,
                    'q' => Code::KeyQ,
                    'r' => Code::KeyR,
                    's' => Code::KeyS,
                    't' => Code::KeyT,
                    'u' => Code::KeyU,
                    'v' => Code::KeyV,
                    'w' => Code::KeyW,
                    'x' => Code::KeyX,
                    'y' => Code::KeyY,
                    'z' => Code::KeyZ,
                    _ => return None,
                });
            }
            "space" => code = Some(Code::Space),
            "tab" => code = Some(Code::Tab),
            "escape" | "esc" => code = Some(Code::Escape),
            other => {
                {
                    let n = other.strip_prefix('f')?;
                    code = match n.parse::<u8>() {
                        Ok(1) => Some(Code::F1),
                        Ok(2) => Some(Code::F2),
                        Ok(3) => Some(Code::F3),
                        Ok(4) => Some(Code::F4),
                        Ok(5) => Some(Code::F5),
                        Ok(6) => Some(Code::F6),
                        Ok(7) => Some(Code::F7),
                        Ok(8) => Some(Code::F8),
                        Ok(9) => Some(Code::F9),
                        Ok(10) => Some(Code::F10),
                        Ok(11) => Some(Code::F11),
                        Ok(12) => Some(Code::F12),
                        _ => return None,
                    };
                }
            }
        }
    }

    code.map(|c| Shortcut::new(Some(modifiers), c))
}
