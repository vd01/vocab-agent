use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::env;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

const PBKDF2_ITERATIONS: u32 = 600_000;
const SALT_LEN: usize = 32;
const NONCE_LEN: usize = 12;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub server_url: String,
    pub shortcut: String,
    pub close_to_tray: bool,
    pub review_reminder: bool,
    pub reminder_interval: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encrypted_password: Option<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            server_url: String::new(),
            shortcut: "Super+Shift+V".to_string(),
            close_to_tray: true,
            review_reminder: true,
            reminder_interval: 30,
            encrypted_password: None,
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

    pub fn save_password(&self, password: &str) -> Result<(), String> {
        let encrypted = encrypt_password(password)?;
        let mut cfg = self.config.lock().unwrap();
        cfg.encrypted_password = Some(encrypted);
        let _ = fs::write(&self.path, serde_json::to_string_pretty(&*cfg).unwrap());
        Ok(())
    }

    pub fn clear_password(&self) -> Result<(), String> {
        let mut cfg = self.config.lock().unwrap();
        cfg.encrypted_password = None;
        let _ = fs::write(&self.path, serde_json::to_string_pretty(&*cfg).unwrap());
        Ok(())
    }

    pub fn decrypt_password(&self) -> Option<String> {
        let cfg = self.config.lock().unwrap();
        let enc = cfg.encrypted_password.as_ref()?;
        decrypt_password(enc).ok()
    }
}

fn derive_key() -> [u8; 32] {
    let username = env::var("USERNAME").unwrap_or_else(|_| "unknown".to_string());
    let computername = env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown".to_string());
    let identity = format!("{}:{}", computername, username);
    let mut key = [0u8; 32];
    let salt = b"vocab-agent-desktop-encryption-salt";
    pbkdf2_hmac::<Sha256>(identity.as_bytes(), salt, PBKDF2_ITERATIONS, &mut key);
    key
}

fn encrypt_password(password: &str) -> Result<String, String> {
    let key = derive_key();
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;

    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);

    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let mut payload = salt.to_vec();
    payload.extend_from_slice(password.as_bytes());

    let ciphertext = cipher
        .encrypt(nonce, payload.as_ref())
        .map_err(|e| e.to_string())?;

    let mut result = nonce_bytes.to_vec();
    result.extend_from_slice(&ciphertext);

    Ok(data_encoding::BASE64.encode(&result))
}

fn decrypt_password(encoded: &str) -> Result<String, String> {
    let data = data_encoding::BASE64.decode(encoded.as_bytes()).map_err(|e| e.to_string())?;
    if data.len() < NONCE_LEN {
        return Err("invalid encrypted data".to_string());
    }

    let key = derive_key();
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;

    let (nonce_bytes, ciphertext) = data.split_at(NONCE_LEN);
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| e.to_string())?;

    if plaintext.len() < SALT_LEN {
        return Err("invalid decrypted data".to_string());
    }

    String::from_utf8(plaintext[SALT_LEN..].to_vec()).map_err(|e| e.to_string())
}
