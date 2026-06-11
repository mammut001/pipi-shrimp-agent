#![allow(
    clippy::too_many_arguments,
    clippy::field_reassign_with_default,
    dead_code,
)]

pub mod browser;
mod claude;
/**
 * Tauri AI Agent - Main entry point
 *
 * This is the main library that gets compiled into the Tauri application.
 * The actual binary entry point is in main.rs which calls run().
 */
mod commands;
mod database;
mod errors;
mod mcp;
mod models;
mod providers;
mod services;
mod tools;
mod utils;

use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;

use claude::ClaudeClient;
use commands::browser::BrowserState;
use commands::claude_sdk::ClaudeState;
use commands::telegram::TelegramState;
use commands::typst_render::FontDbState;
use commands::web::BrowserController;
use database::init_database;
use utils::{build_fonts, init_font_database};

/// Tracks whether critical subsystems initialized successfully at startup.
/// Managed as Tauri state so the frontend can query startup health.
#[derive(Debug, Clone, serde::Serialize)]
pub struct StartupHealthState {
    pub database_ok: bool,
    pub database_error: Option<String>,
}

#[tauri::command]
fn get_startup_health(state: tauri::State<'_, StartupHealthState>) -> StartupHealthState {
    (*state).clone()
}

/**
 * Main entry point for the Tauri application
 */
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .on_page_load(|webview, _payload| {
            if webview.label() == "main" {
                if let Err(error) = webview.show() {
                    eprintln!("⚠️ Failed to show main window after page load: {}", error);
                }
            }
        })
        .setup(|app| {
            // Initialize database — start in degraded mode if it fails instead of
            // panicking. The frontend can query startup health and surface diagnostics.
            let db_health = match init_database() {
                Ok(()) => StartupHealthState {
                    database_ok: true,
                    database_error: None,
                },
                Err(e) => {
                    eprintln!("❌ Failed to initialize database: {}", e);
                    eprintln!("   The app will continue in degraded mode — sessions and history will not persist.");
                    eprintln!("   Make sure the database file is writable at: ~/.local/share/pipi-shrimp-agent/data.db");
                    StartupHealthState {
                        database_ok: false,
                        database_error: Some(e.to_string()),
                    }
                }
            };
            app.manage(db_health);

            // Confirm the main window exists.
            let _window = app.get_webview_window("main").unwrap();

            // Initialize Claude HTTP client (no Node.js required)
            let claude_client = ClaudeClient::new();

            // Manage Claude state
            app.manage(Arc::new(Mutex::new(ClaudeState {
                client: claude_client,
            })));

            // Build fonts once at startup — avoids reading font files on every render
            // AUDIT-FIX: Font loading is now deferred and non-blocking. If font database
            // initialization fails, we log a warning instead of panicking to allow
            // the application to start (Typst rendering will fail gracefully).
            println!("🔤 Loading system fonts...");
            let font_db = init_font_database();
            let prebuilt = build_fonts(&font_db);
            println!("✅ Pre-built {} fonts for Typst rendering", prebuilt.fonts.len());
            app.manage(FontDbState { prebuilt });

            // Initialize BrowserState for second WebviewWindow approach
            app.manage(Arc::new(Mutex::new(BrowserState::default())));

            // Initialize BrowserController for CDP execution
            app.manage(Arc::new(Mutex::new(BrowserController::default())));
            println!("🌐 Browser state initialized");

            // Initialize Telegram state
            app.manage(Arc::new(Mutex::new(TelegramState::default())));
            println!("📱 Telegram state initialized");

            // Initialize Tool Registry
            let mut tool_registry = tools::registry::ToolRegistry::new();
            tools::registry::register_builtin_tools(&mut tool_registry);
            println!("🔧 Tool registry initialized with {} tools", tool_registry.len());
            app.manage(commands::tools::ToolRegistryState(Arc::new(Mutex::new(tool_registry))));

            // Initialize Agent State
            app.manage(commands::agent::AgentState {
                agents: Arc::new(Mutex::new(std::collections::HashMap::new())),
            });
            println!("🤖 Agent state initialized");

            // Initialize MCP State
            let mcp_data_dir = dirs::data_local_dir()
                .unwrap_or_else(|| std::path::PathBuf::from("."))
                .join("pipi-shrimp-agent");
            app.manage(commands::mcp::MCPState {
                manager: mcp::client::new_shared_manager(),
                config_store: mcp::config_store::new_shared_config_store(mcp_data_dir),
            });
            println!("🔌 MCP state initialized");

            println!("✅ Main window created successfully");

            println!("✅ PiPi Shrimp Agent initialized successfully");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Chat commands
            commands::start_session,
            commands::send_message,
            commands::get_session,
            commands::execute_tool,
            // Code execution commands
            commands::execute_bash,
            commands::execute_python,
            commands::execute_python_session,
            commands::close_python_session,
            commands::execute_node,
            // File operation commands
            commands::read_file,
            commands::write_file,
            commands::path_exists,
            commands::create_directory,
            commands::list_files,
            commands::analyze_project_structure,
            commands::scan_memory_files,
            // Config commands
            commands::get_config,
            commands::set_config,
            commands::delete_config,
            // Web automation commands
            commands::web::connect_browser,
            commands::web::navigate_and_wait,
            commands::web::get_page_state,
            commands::web::get_page_state_text,
            commands::web::get_semantic_tree,
            commands::web::browser_click,
            commands::web::browser_type,
            commands::web::browser_scroll,
            commands::web::browser_press_key,
            commands::web::browser_wait,
            commands::web::browser_get_text,
            commands::web::browser_screenshot,
            commands::web::browser_extract_content,
            commands::web::cdp_click,
            commands::web::cdp_type,
            commands::web::cdp_scroll,
            commands::web::launch_chrome_debug,
            commands::web::disconnect_browser,
            commands::web::get_browser_connection_state,
            commands::web::get_browser_observability_snapshot,
            commands::web::get_browser_failure,
            commands::web::list_browser_failures,
            commands::web::retry_browser_action,
            commands::web::take_over_browser,
            commands::web::export_browser_benchmark_report,
            commands::web::resync_page,
            commands::web::cdp_execute_script,
            commands::web::cdp_screenshot,
            commands::web::cdp_extract_content,
            commands::open_url,
            // Claude SDK commands (API-based)
            commands::claude_sdk::send_claude_sdk_chat,
            commands::claude_sdk::send_claude_sdk_chat_streaming,
            commands::claude_sdk::stop_subprocess,
            commands::claude_sdk::test_connection,
            commands::fetch_available_models,
            // Database commands
            commands::database_bridge::db_save_session,
            commands::database_bridge::db_get_diagnostics,
            commands::database_bridge::export_database_backup,
            commands::database_bridge::open_data_directory,
            commands::database_bridge::list_backups,
            commands::database_bridge::restore_from_backup,
            commands::database_bridge::db_get_all_sessions,
            commands::database_bridge::db_delete_session,
            commands::database_bridge::db_save_message,
            commands::database_bridge::db_get_messages,
            commands::database_bridge::db_delete_message,
            commands::database_bridge::delete_messages_by_ids,
            commands::database_bridge::save_compact_boundary,
            commands::update_session_title,
            // Project commands
            commands::database_bridge::db_save_project,
            commands::database_bridge::db_get_all_projects,
            commands::database_bridge::db_delete_project,
            commands::database_bridge::db_update_project,
            // Telegram persistence commands
            commands::database_bridge::db_save_telegram_binding,
            commands::database_bridge::db_get_telegram_binding,
            commands::database_bridge::db_list_telegram_bindings,
            commands::database_bridge::db_save_telegram_task,
            commands::database_bridge::db_get_telegram_task,
            commands::database_bridge::db_find_telegram_task_by_source,
            commands::database_bridge::db_list_telegram_tasks_for_chat,
            commands::database_bridge::db_list_telegram_tasks_by_statuses,
            commands::database_bridge::db_set_telegram_runtime_state,
            commands::database_bridge::db_get_telegram_runtime_state,
            // Token usage commands
            commands::database_bridge::db_save_token_usage,
            commands::database_bridge::db_get_daily_token_stats,
            commands::database_bridge::db_get_monthly_token_stats,
            commands::database_bridge::db_get_model_token_stats,
            commands::database_bridge::db_get_total_token_stats,
            // Reset token estimate
            commands::reset_token_estimate,
            // Swarm snapshot persistence commands
            commands::database_bridge::swarm_save_snapshot,
            commands::database_bridge::swarm_load_snapshot,
            commands::database_bridge::swarm_clear_snapshot,
            // Typst rendering commands
            commands::typst_render::render_typst_to_svg,
            commands::typst_render::render_typst_to_pdf,
            commands::typst_render::get_font_count,
            // Project file helpers (roadmap panel, no workspace required)
            commands::project_file::get_project_root,
            commands::project_file::read_project_file,
            commands::project_file::write_project_file,
            // Workspace / Work Dir commands
            commands::open_folder_dialog,
            commands::init_pipi_shrimp,
            commands::get_next_output_dir,
            commands::get_app_default_dir,
            commands::get_app_autoresearch_dir,
            commands::get_app_memory_projects_dir,
            commands::delete_app_chat_dir,
            commands::list_pipi_shrimp_index,
            commands::delete_session_work_dir,
            commands::create_workflow_run_directory,
            commands::delete_workflow_run_directory,
            commands::reveal_in_finder,
            commands::open_file_external,
            commands::open_file_with_app,
            // Document management commands
            commands::get_next_doc_number,
            commands::create_doc,
            commands::list_docs,
            commands::read_doc,
            commands::delete_doc,
            commands::update_doc,
            commands::update_doc_index,
            // Browser window commands (second WebviewWindow for PageAgent)
            commands::open_browser_window,
            commands::show_browser_window,
            commands::close_browser_window,
            commands::execute_agent_task,
            commands::get_browser_url,
            commands::inject_script,
            commands::is_agent_busy,
            commands::browser_go_back,
            commands::inspect_browser_state,
            commands::browser_navigate,
            commands::browser_reload,
            // Embedded webview commands (fallback/legacy)
            commands::set_embedded_mode,
            commands::get_embedded_mode,
            commands::capture_screenshot,
            commands::get_browser_dimensions,
            // Embedded surface commands (primary for real-browser-in-app experience)
            commands::open_embedded_surface,
            commands::move_browser_surface,
            commands::set_embedded_surface_visibility,
            commands::get_embedded_surface_url,
            commands::execute_on_embedded_surface,
            commands::inspect_embedded_surface,
            commands::navigate_embedded_surface,
            commands::reload_embedded_surface,
            commands::close_embedded_surface,
            // HTTP proxy command (bypass page CSP for LLM API calls)
            commands::browser::proxy_http_request,
            // DevTools command (debug only)
            commands::browser::open_devtools,
            // Telegram commands
            commands::telegram_connect,
            commands::telegram_disconnect,
            commands::telegram_send_message,
            commands::telegram_get_status,
            commands::telegram_get_bot_info,
            commands::telegram_validate_token,
            commands::telegram_get_pending_count,
            commands::telegram_send_typing,
            commands::telegram_send_chat_action,
            commands::telegram_answer_callback_query,
            commands::telegram_get_file_url,
            commands::telegram_get_updates,
            // Compact commands (Layer 1: Microcompact)
            commands::estimate_tokens,
            commands::estimate_messages_tokens,
            commands::microcompact_clear_old_tool_results,
            commands::microcompact_by_count,
            commands::get_session_token_stats,
            commands::get_recent_tool_results,
            // Session Memory commands (Layer 2)
            commands::init_session_memory,
            commands::get_session_memory,
            commands::write_session_memory,
            commands::is_session_memory_empty,
            commands::session_memory_exists,
            commands::get_session_memory_dir,
            commands::get_session_memory_path,
            commands::get_session_memory_sections,
            commands::estimate_session_memory_tokens,
            commands::get_session_memory_info,
            // Tool pipeline commands
            commands::execute_tool_batch,
            commands::execute_single_tool,
            commands::preview_tool_policy,
            commands::cancel_tool_execution,
            commands::get_available_tools,
            // Multi-agent commands
            commands::run_agent,
            commands::get_agent_result,
            // Skill execution commands
            commands::execute_skill,
            // Search commands
            commands::search_files,
            commands::glob_search,
            // File commands
            commands::read_binary_file,
            // Code commands
            commands::lsp_operation,
            // Web commands
            commands::web_search,
            commands::web_fetch,
            // Terminal PTY commands
            commands::terminal_create,
            commands::terminal_input,
            commands::terminal_resize,
            commands::terminal_close,
            // MCP commands
            commands::mcp::mcp_connect_server,
            commands::mcp::mcp_disconnect_server,
            commands::mcp::mcp_disconnect_all,
            commands::mcp::mcp_get_server_runtimes,
            commands::mcp::mcp_list_tools,
            commands::mcp::mcp_list_all_tools,
            commands::mcp::mcp_call_tool,
            commands::mcp::mcp_list_resources,
            commands::mcp::mcp_read_resource,
            commands::mcp::mcp_get_configured_servers,
            commands::mcp::mcp_add_server,
            commands::mcp::mcp_update_server,
            commands::mcp::mcp_remove_server,
            commands::mcp::mcp_get_preset_templates,
            // Startup health
            get_startup_health,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    // Clean up all PTY sessions on app exit
    commands::terminal::close_all_terminals();
}
