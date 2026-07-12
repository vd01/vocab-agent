use crate::store::AppStore;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

pub struct ReminderState;

#[tauri::command]
pub async fn reminder_start(
    app: AppHandle,
    store: State<'_, AppStore>,
) -> Result<(), String> {
    let cfg = store.get();
    if !cfg.review_reminder || cfg.server_url.is_empty() {
        return Ok(());
    }

    let ah = app.clone();
    let interval_secs = cfg.reminder_interval as u64 * 60;

    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(interval_secs));
        tick.tick().await;

        loop {
            tick.tick().await;

            let cfg = {
                let s = ah.state::<AppStore>();
                s.get()
            };

            if !cfg.review_reminder || cfg.server_url.is_empty() {
                continue;
            }

            let check_url = format!("{}/api/review-due", cfg.server_url.trim_end_matches('/'));

            match reqwest::get(&check_url).await {
                Ok(res) if res.status().is_success() => {
                    if let Ok(data) = res.json::<serde_json::Value>().await {
                        if let Some(due) = data.get("due").and_then(|v| v.as_u64()) {
                            if due > 0 {
                                use tauri_plugin_notification::NotificationExt;
                                let _ = ah
                                    .notification()
                                    .builder()
                                    .title("Vocab Agent 复习提醒")
                                    .body(&format!("你有 {} 个单词待复习", due))
                                    .show();
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn reminder_stop() -> Result<(), String> {
    Ok(())
}
