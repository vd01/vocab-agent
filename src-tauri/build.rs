fn main() {
  tauri_build::try_build(
    tauri_build::Attributes::new()
      .app_manifest(
        tauri_build::AppManifest::new()
          .commands(&[
            "config-get",
            "config-set",
            "check-server",
            "reminder-start",
            "reminder-stop",
          ])
      )
  ).expect("failed to run build");
}
