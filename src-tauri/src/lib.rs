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
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_fs::FsExt;

use claude::{ClaudeClient, ChatResponse, Message};
use commands::browser::BrowserState;
use database::{DbSession, DbMessage, DbProject, DbTokenUsage, DailyTokenStats, ModelTokenStats,
               init_database, get_all_sessions, save_session, delete_session, save_message, 
               get_messages_for_session, save_project, get_all_projects, delete_project, 
               update_project, save_token_usage, get_daily_token_stats, get_monthly_token_stats,
               get_model_token_stats, get_total_token_stats};
use utils::{PrebuiltFonts, init_font_database, build_fonts, compile_typst_to_svg_with_prebuilt, compile_typst_to_pdf_with_prebuilt};

/**
 * State for Claude SDK client
 */
struct ClaudeState {
    client: ClaudeClient,
}

/**
 * Pre-built font state (initialized once at startup).
 * Fonts are Arc-wrapped internally, so cloning for each render is O(n) but free of disk I/O.
 */
struct FontDbState {
    prebuilt: PrebuiltFonts,
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
    #[allow(non_snake_case)]
    apiKey: String,
    model: String,
    #[allow(non_snake_case)]
    baseUrl: Option<String>,
    #[allow(non_snake_case)]
    systemPrompt: Option<String>,
    state: tauri::State<'_, Arc<Mutex<ClaudeState>>>,
    window: tauri::Window,
) -> Result<ChatResponse, String> {
    // Convert empty string to None for custom API
    let base_url = baseUrl.filter(|s| !s.is_empty());
    let state = state.lock().await;
    state.client
        .chat_streaming(messages, apiKey, model, base_url, systemPrompt, window)
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
    #[allow(non_snake_case)]
    apiKey: String,
    model: String,
    #[allow(non_snake_case)]
    baseUrl: Option<String>,
    state: tauri::State<'_, Arc<Mutex<ClaudeState>>>,
) -> Result<bool, String> {
    // Convert empty string to None for custom API
    let base_url = baseUrl.filter(|s| !s.is_empty());

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
        .chat(messages, apiKey, model, base_url, None)
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
 * Save token usage record
 */
#[tauri::command]
fn db_save_token_usage(usage: DbTokenUsage) -> Result<(), String> {
    save_token_usage(&usage).map_err(|e| e.to_string())
}

/**
 * Get daily token stats for a specific month (YYYY-MM format)
 */
#[tauri::command]
fn db_get_daily_token_stats(year_month: String) -> Result<Vec<DailyTokenStats>, String> {
    get_daily_token_stats(&year_month).map_err(|e| e.to_string())
}

/**
 * Get monthly token stats
 */
#[tauri::command]
fn db_get_monthly_token_stats() -> Result<Vec<DailyTokenStats>, String> {
    get_monthly_token_stats().map_err(|e| e.to_string())
}

/**
 * Get token stats by model
 */
#[tauri::command]
fn db_get_model_token_stats() -> Result<Vec<ModelTokenStats>, String> {
    get_model_token_stats().map_err(|e| e.to_string())
}

/**
 * Get total token stats (input, output, total)
 */
#[tauri::command]
fn db_get_total_token_stats() -> Result<(i64, i64, i64), String> {
    get_total_token_stats().map_err(|e| e.to_string())
}

/**
 * Render Typst source to SVG.
 *
 * Uses pre-built fonts from State (no disk I/O per render).
 * Runs the blocking compile call on a dedicated thread via spawn_blocking
 * so it doesn't stall the async Tokio executor.
 */
#[tauri::command]
async fn render_typst_to_svg(
    source: String,
    font_state: tauri::State<'_, FontDbState>,
) -> Result<String, String> {
    // Clone the fonts (Arc clones — cheap, no disk I/O)
    let book = font_state.prebuilt.book.clone();
    let fonts = font_state.prebuilt.fonts.clone();

    // Run the blocking Typst compilation on a thread-pool thread
    tokio::task::spawn_blocking(move || {
        let prebuilt = PrebuiltFonts { book, fonts };
        compile_typst_to_svg_with_prebuilt(&source, &prebuilt)
    })
    .await
    .map_err(|e| format!("Thread error: {}", e))?
}

/**
 * Render Typst source to PDF and save to file.
 */
#[tauri::command]
async fn render_typst_to_pdf(
    source: String,
    file_path: String,
    font_state: tauri::State<'_, FontDbState>,
) -> Result<String, String> {
    let book = font_state.prebuilt.book.clone();
    let fonts = font_state.prebuilt.fonts.clone();

    let pdf_bytes = tokio::task::spawn_blocking(move || {
        let prebuilt = PrebuiltFonts { book, fonts };
        compile_typst_to_pdf_with_prebuilt(&source, &prebuilt)
    })
    .await
    .map_err(|e| format!("Thread error: {}", e))??;

    // Write PDF to file
    std::fs::write(&file_path, pdf_bytes)
        .map_err(|e| format!("Failed to write PDF: {}", e))?;

    Ok(file_path)
}

/**
 * Check how many fonts are available (diagnostic)
 */
#[tauri::command]
fn get_font_count(font_state: tauri::State<'_, FontDbState>) -> usize {
    font_state.prebuilt.fonts.len()
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
        .setup(|app| {
            // Initialize database - CRITICAL, cannot proceed without it
            if let Err(e) = init_database() {
                eprintln!("❌ CRITICAL: Failed to initialize database: {}", e);
                eprintln!("   Make sure the database file is writable at: ~/.local/share/pipi-shrimp-agent/data.db");
                panic!("Database initialization failed: {}. Application cannot start.", e);
            }

            // Get the main window
            let _window = app.get_webview_window("main").unwrap();

            // Initialize Claude HTTP client (no Node.js required)
            let claude_client = ClaudeClient::new();

            // Manage Claude state
            app.manage(Arc::new(Mutex::new(ClaudeState {
                client: claude_client,
            })));

            // Build fonts once at startup — avoids reading font files on every render
            println!("🔤 Loading system fonts...");
            let font_db = init_font_database();
            let prebuilt = build_fonts(&font_db);
            println!("✅ Pre-built {} fonts for Typst rendering", prebuilt.fonts.len());
            app.manage(FontDbState { prebuilt });

            // Initialize BrowserState for second WebviewWindow approach
            app.manage(Arc::new(Mutex::new(BrowserState::default())));
            println!("🌐 Browser state initialized");

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
            commands::update_session_title,
            // Project commands
            db_save_project,
            db_get_all_projects,
            db_delete_project,
            db_update_project,
            // Token usage commands
            db_save_token_usage,
            db_get_daily_token_stats,
            db_get_monthly_token_stats,
            db_get_model_token_stats,
            db_get_total_token_stats,
            // Typst rendering commands
            render_typst_to_svg,
            render_typst_to_pdf,
            get_font_count,
            // Workspace / Work Dir commands
            commands::open_folder_dialog,
            commands::init_pipi_shrimp,
            commands::get_next_output_dir,
            commands::list_pipi_shrimp_index,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
