use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub server_url: String,
    pub shortcut: String,
    pub close_to_tray: bool,
    pub review_reminder: bool,
    pub reminder_interval: u32,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            server_url: String::new(),
            shortcut: "Super+Shift+V".to_string(),
            close_to_tray: true,
            review_reminder: true,
            reminder_interval: 30,
        }
    }
}

pub struct AppStore {
    config: Mutex<AppConfig>,
    path: PathBuf,
}

impl AppStore {
    pub fn new(app_data_dir: &PathBuf) -> Self {
        let path = app_data_dir.join("config.json");
        let config = if path.exists() {
            match fs::read_to_string(&path) {
                Ok(data) => serde_json::from_str(&data).unwrap_or_default(),
                Err(_) => AppConfig::default(),
            }
        } else {
            AppConfig::default()
        };
        Self {
            config: Mutex::new(config),
            path,
        }
    }

    pub fn get(&self) -> AppConfig {
        self.config.lock().unwrap().clone()
    }

    pub fn set(&self, partial: serde_json::Value) -> AppConfig {
        let mut cfg = self.config.lock().unwrap();
        if let Some(url) = partial.get("server_url").and_then(|v| v.as_str()) {
            cfg.server_url = url.to_string();
        }
        if let Some(s) = partial.get("shortcut").and_then(|v| v.as_str()) {
            cfg.shortcut = s.to_string();
        }
        if let Some(b) = partial.get("close_to_tray").and_then(|v| v.as_bool()) {
            cfg.close_to_tray = b;
        }
        if let Some(b) = partial.get("review_reminder").and_then(|v| v.as_bool()) {
            cfg.review_reminder = b;
        }
        if let Some(n) = partial.get("reminder_interval").and_then(|v| v.as_u64()) {
            cfg.reminder_interval = n as u32;
        }
        let _ = fs::write(&self.path, serde_json::to_string_pretty(&*cfg).unwrap());
        cfg.clone()
    }
}
