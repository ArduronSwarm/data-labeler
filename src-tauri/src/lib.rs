#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_sql::Builder::default().build())
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      commands::get_project,
      commands::get_all_projects,
      commands::create_project,
      commands::delete_project,
      commands::update_project,
      commands::get_images,
      commands::add_image,
      commands::add_images,
      commands::get_annotations,
      commands::save_annotation,
      commands::delete_annotation,
      commands::update_image_status,
      commands::auto_split_dataset,
      commands::export_dataset,
      commands::start_python_server,
      commands::stop_python_server,
      commands::run_yolo_detection,
      commands::validate_project,
      commands::scan_folder_for_images,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

mod commands;
mod database;
