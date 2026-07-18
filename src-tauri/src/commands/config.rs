use crate::store::AppStore;
use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};

pub fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())
}

#[derive(Serialize, Clone)]
pub struct ConfigResponse {
    server_url: String,
    shortcut: String,
    close_to_tray: bool,
    review_reminder: bool,
    reminder_interval: u32,
    quick_lookup_shortcut: String,
}

impl From<crate::store::AppConfig> for ConfigResponse {
    fn from(cfg: crate::store::AppConfig) -> Self {
        Self {
            server_url: cfg.server_url,
            shortcut: cfg.shortcut,
            close_to_tray: cfg.close_to_tray,
            review_reminder: cfg.review_reminder,
            reminder_interval: cfg.reminder_interval,
            quick_lookup_shortcut: cfg.quick_lookup_shortcut,
        }
    }
}

#[tauri::command(rename = "config-get")]
pub fn config_get(store: State<'_, AppStore>) -> Result<ConfigResponse, String> {
    Ok(store.get().into())
}

#[tauri::command(rename = "config-set")]
pub fn config_set(
    app: tauri::AppHandle,
    store: State<'_, AppStore>,
    partial: serde_json::Value,
) -> Result<ConfigResponse, String> {
    let old_cfg = store.get();
    let new_cfg = store.set(partial);

    // If server_url changed, navigate the main window to the new URL
    if new_cfg.server_url != old_cfg.server_url && !new_cfg.server_url.is_empty() {
        let url = new_cfg.server_url.trim_end_matches('/');
        if let Some(win) = app.get_webview_window("main") {
            // Use Tauri's native navigate() instead of win.eval("window.location.href = ...").
            // eval-based navigation can be blocked by webview security policies when
            // crossing security boundaries (e.g. HTTPS → HTTP localhost).
            if let Ok(parsed) = url.parse::<url::Url>() {
                let _ = win.navigate(parsed);
            }
            let _ = win.show();
            let _ = win.set_focus();
        }
        // Also re-warm quick-lookup with new URL
        crate::prewarm_quick_lookup(&app, url);
    }

    Ok(new_cfg.into())
}

#[tauri::command(rename = "check-server")]
pub async fn check_server(url: String) -> Result<bool, String> {
    let url = url.trim_end_matches('/');
    let client = http_client()?;
    let res = client.get(url).send().await.map_err(|e| e.to_string())?;
    Ok(res.status().is_success() || res.status() == reqwest::StatusCode::FOUND || res.status() == reqwest::StatusCode::TEMPORARY_REDIRECT)
}

/// Update the quick-lookup shortcut at runtime.
/// Unregisters the old shortcut, registers the new one, and updates the shared handler state.
#[tauri::command(rename = "set-quick-lookup-shortcut")]
pub fn set_quick_lookup_shortcut(
    app: tauri::AppHandle,
    store: State<'_, AppStore>,
    keys: State<'_, Arc<Mutex<crate::ShortcutKeys>>>,
    shortcut: String,
) -> Result<ConfigResponse, String> {
    
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    // Parse the new shortcut
    let new_sc = crate::parse_shortcut(&shortcut)
        .ok_or_else(|| format!("Invalid shortcut format: {}", shortcut))?;

    // Unregister old quick-lookup shortcut
    let old_cfg = store.get();
    if let Some(old_sc) = crate::parse_shortcut(&old_cfg.quick_lookup_shortcut) {
        let _ = app.global_shortcut().unregister(old_sc);
    }

    // Register the new one
    app.global_shortcut().register(new_sc)
        .map_err(|e| format!("Failed to register shortcut: {}", e))?;

    // Update the shared handler state so the handler recognizes the new key
    {
        let mut k = keys.lock().map_err(|e| e.to_string())?;
        k.ql = Some((new_sc.mods, new_sc.key));
    }

    // Save to config
    Ok(store.set(serde_json::json!({ "quick_lookup_shortcut": shortcut })).into())
}
