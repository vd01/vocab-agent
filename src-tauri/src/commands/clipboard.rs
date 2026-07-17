use tauri::AppHandle;

/// Read text from the system clipboard.
#[tauri::command(rename = "read-clipboard")]
pub fn read_clipboard(app: AppHandle) -> Result<String, String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard()
        .read_text()
        .map_err(|e| format!("Failed to read clipboard: {}", e))
}
