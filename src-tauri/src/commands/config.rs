use crate::store::AppStore;
use serde::Serialize;
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
    has_password: bool,
}

impl From<crate::store::AppConfig> for ConfigResponse {
    fn from(cfg: crate::store::AppConfig) -> Self {
        Self {
            server_url: cfg.server_url,
            shortcut: cfg.shortcut,
            close_to_tray: cfg.close_to_tray,
            review_reminder: cfg.review_reminder,
            reminder_interval: cfg.reminder_interval,
            has_password: cfg.encrypted_password.is_some(),
        }
    }
}

#[tauri::command]
pub fn config_get(store: State<'_, AppStore>) -> Result<ConfigResponse, String> {
    Ok(store.get().into())
}

#[tauri::command]
pub fn config_set(store: State<'_, AppStore>, partial: serde_json::Value) -> Result<ConfigResponse, String> {
    Ok(store.set(partial).into())
}

#[tauri::command]
pub fn password_save(store: State<'_, AppStore>, password: String) -> Result<(), String> {
    store.save_password(&password)
}

#[tauri::command]
pub fn password_clear(store: State<'_, AppStore>) -> Result<(), String> {
    store.clear_password()
}

#[tauri::command]
pub async fn auto_login(store: State<'_, AppStore>) -> Result<bool, String> {
    let cfg = store.get();
    if cfg.server_url.is_empty() {
        return Ok(false);
    }
    let password = match store.decrypt_password() {
        Some(p) => p,
        None => return Ok(false),
    };

    let url = cfg.server_url.trim_end_matches('/');
    let client = http_client()?;
    let res = client
        .post(format!("{}/api/auth", url))
        .json(&serde_json::json!({ "password": password }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Ok(false);
    }

    Ok(true)
}

#[tauri::command]
pub async fn check_server(url: String) -> Result<bool, String> {
    let url = url.trim_end_matches('/');
    let client = http_client()?;
    let res = client.get(url).send().await.map_err(|e| e.to_string())?;
    Ok(res.status().is_success() || res.status() == reqwest::StatusCode::FOUND || res.status() == reqwest::StatusCode::TEMPORARY_REDIRECT)
}

#[tauri::command]
pub async fn open_setup(app: tauri::AppHandle) -> Result<(), String> {
    crate::store::SET_SETUP_MODE.store(true, std::sync::atomic::Ordering::SeqCst);
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.eval("window.location.href = 'index.html'");
        let _ = win.show();
        let _ = win.set_focus();
    }
    Ok(())
}
