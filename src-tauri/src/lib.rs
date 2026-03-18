/**
 * Tauri AI Agent - Main entry point
 *
 * This is the main library that gets compiled into the Tauri application.
 * The actual binary entry point is in main.rs which calls run().
 */

mod commands;
mod models;
mod utils;
mod claude;
mod database;

use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::Manager;

use claude::{ClaudeClient, ChatResponse, Message};
use database::{DbSession, DbMessage, DbProject, init_database, get_all_sessions, save_session, delete_session, save_message, get_messages_for_session, save_project, get_all_projects, delete_project, update_project};
use utils::{FontDb, init_font_database, compile_typst_to_svg_with_fonts};

/**
 * State for Claude SDK client
 */
struct ClaudeState {
    client: ClaudeClient,
}

/**
 * State for cached font database (initialized once at startup)
 * This avoids reloading system fonts on every compilation
 */
struct FontDbState {
    font_db: FontDb,
}

/**
 * Send a chat message using Claude SDK (Anthropic API)
 */
#[tauri::command]
async fn send_claude_sdk_chat(
    messages: Vec<Message>,
    api_key: String,
    model: String,
    base_url: Option<String>,
    system_prompt: Option<String>,
    state: tauri::State<'_, Arc<Mutex<ClaudeState>>>,
) -> Result<ChatResponse, String> {
    // Convert empty string to None for custom API
    let base_url = base_url.filter(|s| !s.is_empty());
    let state = state.lock().await;
    state.client
        .chat(messages, api_key, model, base_url, system_prompt)
        .await
        .map_err(|e| e.to_string())
}

/**
 * Send a chat message using Claude SDK with streaming (emits events)
 */
#[tauri::command]
async fn send_claude_sdk_chat_streaming(
    messages: Vec<Message>,
    api_key: String,
    model: String,
    base_url: Option<String>,
    system_prompt: Option<String>,
    state: tauri::State<'_, Arc<Mutex<ClaudeState>>>,
    window: tauri::Window,
) -> Result<ChatResponse, String> {
    // Convert empty string to None for custom API
    let base_url = base_url.filter(|s| !s.is_empty());
    let state = state.lock().await;
    state.client
        .chat_streaming(messages, api_key, model, base_url, system_prompt, window)
        .await
        .map_err(|e| e.to_string())
}

/**
 * Stop the current running request (cancel generation)
 */
#[tauri::command]
async fn stop_subprocess() -> Result<(), String> {
    claude::stop_current_request()
        .await
        .map_err(|e| e.to_string())
}

/**
 * Test API connection
 */
#[tauri::command]
async fn test_connection(
    api_key: String,
    model: String,
    base_url: Option<String>,
    state: tauri::State<'_, Arc<Mutex<ClaudeState>>>,
) -> Result<bool, String> {
    // Convert empty string to None for custom API
    let base_url = base_url.filter(|s| !s.is_empty());

    // Create a simple test message
    let messages = vec![Message {
        role: "user".to_string(),
        content: "Hi".to_string(),
        tool_calls: None,
        tool_call_id: None,
    }];

    let state = state.lock().await;
    match state
        .client
        .chat(messages, api_key, model, base_url, None)
        .await
    {
        Ok(_) => Ok(true),
        Err(e) => Err(e.to_string()),
    }
}

/**
 * Database commands for session/message persistence
 */

#[tauri::command]
fn db_save_session(session: DbSession) -> Result<(), String> {
    save_session(&session).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_get_all_sessions() -> Result<Vec<DbSession>, String> {
    get_all_sessions().map_err(|e| e.to_string())
}

#[tauri::command]
fn db_delete_session(session_id: String) -> Result<(), String> {
    delete_session(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_save_message(message: DbMessage) -> Result<(), String> {
    save_message(&message).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_get_messages(session_id: String) -> Result<Vec<DbMessage>, String> {
    get_messages_for_session(&session_id).map_err(|e| e.to_string())
}

/**
 * Database commands for projects
 */

#[tauri::command]
fn db_save_project(project: DbProject) -> Result<(), String> {
    save_project(&project).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_get_all_projects() -> Result<Vec<DbProject>, String> {
    get_all_projects().map_err(|e| e.to_string())
}

#[tauri::command]
fn db_delete_project(project_id: String) -> Result<(), String> {
    delete_project(&project_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_update_project(project: DbProject) -> Result<(), String> {
    update_project(&project).map_err(|e| e.to_string())
}

/**
 * Render Typst source to SVG (async command)
 * Uses cached font database from State for better performance
 */
#[tauri::command]
async fn render_typst_to_svg(
    source: String,
    font_state: tauri::State<'_, FontDbState>,
) -> Result<String, String> {
    // Use the cached font database from State
    let font_db = &font_state.font_db;
    compile_typst_to_svg_with_fonts(&source, font_db)
}

/**
 * Check how many fonts are available (diagnostic)
 */
#[tauri::command]
fn get_font_count(font_state: tauri::State<'_, FontDbState>) -> usize {
    font_state.font_db.faces().count()
}

/**
 * Main entry point for the Tauri application
 */
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // Initialize database - CRITICAL, cannot proceed without it
            if let Err(e) = init_database() {
                eprintln!("❌ CRITICAL: Failed to initialize database: {}", e);
                eprintln!("   Make sure the database file is writable at: ~/.local/share/pipi-shrimp-agent/data.db");
                panic!("Database initialization failed: {}. Application cannot start.", e);
            }

            // Get the main window
            let _window = app.get_window("main").unwrap();

            // Initialize Claude HTTP client (no Node.js required)
            let claude_client = ClaudeClient::new();

            // Manage Claude state
            app.manage(Arc::new(Mutex::new(ClaudeState {
                client: claude_client,
            })));

            // Initialize font database and manage it in State
            // This avoids reloading system fonts on every compilation
            println!("🔤 Loading system fonts...");
            let font_db = init_font_database();
            let font_count = font_db.faces().count();
            println!("✅ Loaded {} fonts", font_count);
            app.manage(FontDbState { font_db });

            println!("✅ Main window created successfully");

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
            commands::execute_node,
            // File operation commands
            commands::read_file,
            commands::write_file,
            commands::path_exists,
            commands::create_directory,
            commands::list_files,
            // Config commands
            commands::get_config,
            commands::set_config,
            commands::delete_config,
            // Web automation commands
            commands::web_automation,
            commands::open_url,
            // Claude commands (CLI-based)
            claude::check_claude_available,
            claude::get_claude_version,
            claude::execute_claude_command,
            claude::send_claude_chat,
            claude::claude_execute,
            claude::claude_chat,
            // Claude SDK commands (API-based)
            send_claude_sdk_chat,
            send_claude_sdk_chat_streaming,
            stop_subprocess,
            test_connection,
            commands::fetch_available_models,
            // Database commands
            db_save_session,
            db_get_all_sessions,
            db_delete_session,
            db_save_message,
            db_get_messages,
            // Project commands
            db_save_project,
            db_get_all_projects,
            db_delete_project,
            db_update_project,
            // Typst rendering commands
            render_typst_to_svg,
            get_font_count,
            // Workspace / Work Dir commands
            commands::open_folder_dialog,
            commands::init_pipi_shrimp,
            commands::get_next_output_dir,
            commands::list_pipi_shrimp_index,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
