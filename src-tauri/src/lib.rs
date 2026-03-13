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

use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::Manager;

use claude::{ClaudeClient, ChatResponse, Message};

/**
 * State for Claude SDK client
 */
struct ClaudeState {
    client: ClaudeClient,
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
    let state = state.lock().await;
    state.client
        .chat(messages, api_key, model, base_url, system_prompt)
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
    // Create a simple test message
    let messages = vec![Message {
        role: "user".to_string(),
        content: "Hi".to_string(),
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
 * Main entry point for the Tauri application
 */
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            println!("🚀 AI Agent starting...");

            // Get the main window
            let _window = app.get_window("main").unwrap();

            // Initialize Claude SDK client
            // Resolve the path to node-scripts/claude-sdk.js
            // During `tauri dev`, CWD is typically src-tauri/, so we need to
            // check both CWD and one level up (project root) to find node-scripts/
            let node_script_path = {
                let candidates = if let Ok(cwd) = std::env::current_dir() {
                    vec![
                        cwd.join("node-scripts/claude-sdk.js"),              // CWD/node-scripts/
                        cwd.join("../node-scripts/claude-sdk.js"),           // CWD/../node-scripts/ (project root)
                    ]
                } else {
                    vec![PathBuf::from("node-scripts/claude-sdk.js")]
                };

                candidates.into_iter()
                    .find(|p| p.exists())
                    .unwrap_or_else(|| {
                        // Fallback: assume project root is one level up from src-tauri
                        std::env::current_dir()
                            .map(|cwd| cwd.join("../node-scripts/claude-sdk.js"))
                            .unwrap_or_else(|_| PathBuf::from("node-scripts/claude-sdk.js"))
                    })
                    // Canonicalize to get a clean absolute path
                    .canonicalize()
                    .unwrap_or_else(|_| PathBuf::from("node-scripts/claude-sdk.js"))
            };

            println!("📂 Node script path: {:?}", node_script_path);

            let claude_client = ClaudeClient::new(node_script_path);

            // Manage Claude state
            app.manage(Arc::new(Mutex::new(ClaudeState {
                client: claude_client,
            })));

            println!("✅ Main window created successfully");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Chat commands
            commands::start_session,
            commands::send_message,
            commands::get_session,
            // Code execution commands
            commands::execute_bash,
            commands::execute_python,
            commands::execute_node,
            // File operation commands
            commands::read_file,
            commands::write_file,
            commands::path_exists,
            commands::create_directory,
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
            test_connection,
            commands::fetch_available_models,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
