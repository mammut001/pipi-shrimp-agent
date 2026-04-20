/**
 * Tauri AI Agent - Main entry point
 *
 * This is the main library that gets compiled into the Tauri application.
 * The actual binary entry point is in main.rs which calls run().
 */

mod commands;
mod models;
mod providers;
mod utils;
mod claude;
mod database;
mod tools;
mod mcp;

use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::Manager;

use claude::{ClaudeClient, ChatResponse, Message};
use commands::browser::BrowserState;
use commands::web::BrowserController;
use commands::telegram::TelegramState;
use database::{DbSession, DbMessage, DbProject, DbTokenUsage, DailyTokenStats, ModelTokenStats,
               init_database, get_all_sessions, save_session, delete_session, save_message, delete_message,
               get_messages_for_session, save_project, get_all_projects, delete_project,
               update_project, save_token_usage, get_daily_token_stats, get_monthly_token_stats,
               get_model_token_stats, get_total_token_stats,
               save_swarm_snapshot, load_swarm_snapshot, clear_swarm_snapshots};
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
pub struct FontDbState {
    pub prebuilt: PrebuiltFonts,
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
    #[allow(non_snake_case)]
    browserConnected: Option<bool>,
    state: tauri::State<'_, Arc<Mutex<ClaudeState>>>,
) -> Result<ChatResponse, String> {
    // Convert empty string to None for custom API
    let base_url = base_url.filter(|s| !s.is_empty());
    let browser_connected = browserConnected.unwrap_or(false);
    // Clone the client out of the lock so the mutex is released before the
    // long-running HTTP request (otherwise all concurrent requests serialize).
    let client = {
        let state = state.lock().await;
        state.client.clone()
    };
    client
        .chat(messages, api_key, model, base_url, system_prompt, browser_connected)
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
    #[allow(non_snake_case)]
    noTools: Option<bool>,
    #[allow(non_snake_case)]
    browserConnected: Option<bool>,
    #[allow(non_snake_case)]
    sessionId: String,
    // Optional explicit API format override: "anthropic" or "openai".
    // When absent the format is auto-detected from key / model / base URL.
    #[allow(non_snake_case)]
    apiFormat: Option<String>,
    state: tauri::State<'_, Arc<Mutex<ClaudeState>>>,
    window: tauri::Window,
) -> Result<ChatResponse, String> {
    // Convert empty string to None for custom API
    let base_url = baseUrl.filter(|s| !s.is_empty());
    let no_tools = noTools.unwrap_or(false);
    let browser_connected = browserConnected.unwrap_or(false);
    let api_format = apiFormat.filter(|s| !s.is_empty());
    // Clone out of lock before the long-running streaming call.
    let client = {
        let state = state.lock().await;
        state.client.clone()
    };
    client
        .chat_streaming(messages, apiKey, model, base_url, systemPrompt, no_tools, window, browser_connected, sessionId, api_format)
        .await
        .map_err(|e| e.to_string())
}

/**
 * Stop the current running request (cancel generation)
 */
#[tauri::command]
#[allow(non_snake_case)]
async fn stop_subprocess(sessionId: Option<String>) -> Result<(), String> {
    claude::stop_current_request(sessionId)
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

    // Clone out of lock before HTTP call.
    let client = {
        let state = state.lock().await;
        state.client.clone()
    };
    match client
        .chat(messages, apiKey, model, base_url, None, false)
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

#[tauri::command]
fn db_delete_message(message_id: String) -> Result<(), String> {
    delete_message(&message_id).map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(non_snake_case)]
fn delete_messages_by_ids(messageIds: Vec<String>) -> Result<(), String> {
    database::delete_messages_by_ids(&messageIds).map_err(|e| e.to_string())
}

#[derive(serde::Deserialize, serde::Serialize)]
struct CompactBoundaryPayload {
    id: String,
    content: String,
    subtype: String,
    compact_type: String,
    pre_compact_token_count: i32,
    post_compact_token_count: i32,
    summary_version: i64,
    created_at: i64,
    session_memory_path: Option<String>,
    preserved_segment: Option<serde_json::Value>,
    pre_compact_discovered_tools: Option<serde_json::Value>,
}

#[tauri::command]
#[allow(non_snake_case)]
fn save_compact_boundary(sessionId: String, boundary: CompactBoundaryPayload) -> Result<(), String> {
    let artifacts = serde_json::to_string(&boundary).ok();
    let message = database::DbMessage {
        id: boundary.id,
        session_id: sessionId,
        role: "system".to_string(), // boundaries are system messages
        content: boundary.content,
        reasoning: None,
        artifacts,
        tool_calls: None,
        token_usage: None,
        created_at: boundary.created_at,
    };
    database::save_message(&message).map_err(|e| e.to_string())
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
fn db_get_daily_token_stats(year_month: String, api_config_id: Option<String>) -> Result<Vec<DailyTokenStats>, String> {
    get_daily_token_stats(&year_month, api_config_id.as_deref()).map_err(|e| e.to_string())
}

/**
 * Get monthly token stats
 */
#[tauri::command]
fn db_get_monthly_token_stats(api_config_id: Option<String>) -> Result<Vec<DailyTokenStats>, String> {
    get_monthly_token_stats(api_config_id.as_deref()).map_err(|e| e.to_string())
}

/**
 * Get token stats by model
 */
#[tauri::command]
fn db_get_model_token_stats(api_config_id: Option<String>) -> Result<Vec<ModelTokenStats>, String> {
    get_model_token_stats(api_config_id.as_deref()).map_err(|e| e.to_string())
}

/**
 * Get total token stats (input, output, total)
 */
#[tauri::command]
fn db_get_total_token_stats(api_config_id: Option<String>) -> Result<(i64, i64, i64), String> {
    get_total_token_stats(api_config_id.as_deref()).map_err(|e| e.to_string())
}

/**
 * Swarm snapshot persistence commands (minimal SQLite support).
 *
 * CURRENT: localStorage is the active backend (see persistence.ts).
 * These commands are ready for when the bridge switches to 'tauri' mode.
 */

#[tauri::command]
fn swarm_save_snapshot(snapshot: serde_json::Value) -> Result<(), String> {
    let snapshot_json = serde_json::to_string(&snapshot).map_err(|e| e.to_string())?;
    let saved_at = chrono::Utc::now().timestamp();
    save_swarm_snapshot(&snapshot_json, saved_at).map_err(|e| e.to_string())
}

#[tauri::command]
fn swarm_load_snapshot() -> Result<Option<serde_json::Value>, String> {
    let result = load_swarm_snapshot().map_err(|e| e.to_string())?;
    match result {
        Some(json_str) => {
            let value: serde_json::Value = serde_json::from_str(&json_str).map_err(|e| e.to_string())?;
            Ok(Some(value))
        }
        None => Ok(None),
    }
}

#[tauri::command]
fn swarm_clear_snapshot() -> Result<(), String> {
    clear_swarm_snapshots().map_err(|e| e.to_string())
}

/// Resolve the project root: during `tauri dev` cwd is `src-tauri/`,
/// so we walk up one level if the cwd ends with "src-tauri".
fn project_root() -> std::path::PathBuf {
    let cwd = std::env::current_dir().unwrap_or_default();
    if cwd.file_name().map(|n| n == "src-tauri").unwrap_or(false) {
        cwd.parent().unwrap_or(&cwd).to_path_buf()
    } else {
        cwd
    }
}

/// Read a file relative to a base directory (or project root if None).
#[tauri::command]
fn read_project_file(relative_path: String, base_dir: Option<String>) -> Result<String, String> {
    let root = match base_dir {
        Some(d) if !d.is_empty() => std::path::PathBuf::from(d),
        _ => project_root(),
    };
    let full = root.join(&relative_path);
    std::fs::read_to_string(&full)
        .map_err(|e| format!("Cannot read '{}': {}", full.display(), e))
}

/// Write a file relative to a base directory (or project root if None).
#[tauri::command]
fn write_project_file(relative_path: String, content: String, base_dir: Option<String>) -> Result<(), String> {
    let root = match base_dir {
        Some(d) if !d.is_empty() => std::path::PathBuf::from(d),
        _ => project_root(),
    };
    let full = root.join(&relative_path);
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Cannot create dirs: {}", e))?;
    }
    std::fs::write(&full, content).map_err(|e| format!("Cannot write '{}': {}", full.display(), e))
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
        .plugin(tauri_plugin_notification::init())
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
            commands::web::get_semantic_tree,
            commands::web::cdp_click,
            commands::web::cdp_type,
            commands::web::cdp_scroll,
            commands::web::launch_chrome_debug,
            commands::web::disconnect_browser,
            commands::web::resync_page,
            commands::web::cdp_execute_script,
            commands::web::cdp_screenshot,
            commands::web::cdp_extract_content,
            commands::open_url,
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
            db_delete_message,
            delete_messages_by_ids,
            save_compact_boundary,
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
            // Reset token estimate
            commands::reset_token_estimate,
            // Swarm snapshot persistence commands
            swarm_save_snapshot,
            swarm_load_snapshot,
            swarm_clear_snapshot,
            // Typst rendering commands
            render_typst_to_svg,
            render_typst_to_pdf,
            get_font_count,
            // Project file helpers (roadmap panel, no workspace required)
            read_project_file,
            write_project_file,
            // Workspace / Work Dir commands
            commands::open_folder_dialog,
            commands::init_pipi_shrimp,
            commands::get_next_output_dir,
            commands::get_app_default_dir,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    // Clean up all PTY sessions on app exit
    commands::terminal::close_all_terminals();
}
