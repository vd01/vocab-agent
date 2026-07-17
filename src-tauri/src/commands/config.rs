use crate::store::AppStore;
use serde::Serialize;
use tauri::State;

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
pub fn config_set(store: State<'_, AppStore>, partial: serde_json::Value) -> Result<ConfigResponse, String> {
    Ok(store.set(partial).into())
}

#[tauri::command(rename = "check-server")]
pub async fn check_server(url: String) -> Result<bool, String> {
    let url = url.trim_end_matches('/');
    let client = http_client()?;
    let res = client.get(url).send().await.map_err(|e| e.to_string())?;
    Ok(res.status().is_success() || res.status() == reqwest::StatusCode::FOUND || res.status() == reqwest::StatusCode::TEMPORARY_REDIRECT)
}
