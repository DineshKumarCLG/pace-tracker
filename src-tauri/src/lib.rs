use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use tauri::Manager;

pub mod commands;
pub mod db;
pub mod git;
pub mod heartbeat;
pub mod idle;
pub mod power;

/// Global state for the power monitor background thread.
/// Fields are read when the app shuts down to stop the monitor thread.
#[allow(dead_code)]
struct PowerMonitorState {
    handle: Option<JoinHandle<()>>,
    stop: Option<Arc<AtomicBool>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = app
                .get_webview_window("main")
                .expect("no main window")
                .set_focus();
        }))
        .setup(|app| {
            // Start power monitor for screen lock/sleep/wake detection.
            // Gracefully handles platforms where power monitoring is unavailable.
            let app_handle = app.handle().clone();
            match power::setup_power_monitor(app_handle) {
                Some((handle, stop)) => {
                    app.manage(Mutex::new(PowerMonitorState {
                        handle: Some(handle),
                        stop: Some(stop),
                    }));
                }
                None => {
                    app.manage(Mutex::new(PowerMonitorState {
                        handle: None,
                        stop: None,
                    }));
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db::initialize_db,
            commands::start_session,
            commands::end_session,
            commands::get_active_session,
            commands::recover_stale_session,
            commands::get_device_wake_time,
            commands::start_idle_detection,
            commands::stop_idle_detection,
            commands::start_break,
            commands::end_break,
            commands::get_active_break,
            commands::get_visible_breaks,
            commands::create_task,
            commands::update_task_status,
            commands::archive_task,
            commands::list_tasks,
            commands::create_project,
            commands::archive_project,
            commands::list_projects,
            commands::collect_git_events,
            commands::get_git_events,
            commands::create_review_cycle,
            commands::close_review_cycle,
            commands::resolve_tie,
            commands::get_review_history,
            commands::get_warning_count,
            commands::submit_founder_review,
            commands::apply_dilution,
            commands::get_dilution_events_for_cycle,
            commands::compute_startup_health,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PACE");
}
