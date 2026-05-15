use crate::browser::dom::PageState;
use crate::commands::web::{self, BrowserController};
/**
 * Chat commands
 *
 * Handles chat session management and message sending using SQLite
 */
use crate::models::{SendMessageRequest, SendMessageResponse};
use crate::services::chat::browser_tool_service::{
    execute_browser_chat_tool_call, parse_browser_chat_tool_call, BrowserChatRuntime,
    BrowserToolTarget,
};
use crate::services::chat::session_service::{
    delete_session_service, get_session_service, list_sessions_service,
    reset_token_estimate_service, save_message_to_db_service, send_message_service,
    start_session_service, update_session_cwd_service, update_session_title_service,
};
use crate::utils::{AppError, AppResult};
use async_trait::async_trait;
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::Mutex;

pub use crate::services::chat::session_service::SessionData;

#[cfg(test)]
use crate::services::chat::browser_tool_service::{
    browser_not_connected_message, browser_target_from_args, serialize_page_state_for_chat,
    BrowserChatToolCall,
};

struct LiveBrowserChatRuntime<'a> {
    browser_state: tauri::State<'a, Arc<Mutex<BrowserController>>>,
}

#[async_trait]
impl BrowserChatRuntime for LiveBrowserChatRuntime<'_> {
    async fn navigate_and_wait(
        &self,
        url: String,
        wait_selector: Option<String>,
    ) -> Result<(), String> {
        web::navigate_and_wait(url, wait_selector, self.browser_state.clone())
            .await
            .map(|_| ())
    }

    async fn resync_page(&self) -> Result<(), String> {
        web::resync_page(self.browser_state.clone())
            .await
            .map(|_| ())
    }

    async fn get_page_state(&self) -> Result<PageState, String> {
        web::get_page_state(self.browser_state.clone()).await
    }

    async fn click(&self, target: &BrowserToolTarget) -> Result<String, String> {
        web::browser_click(
            target.element_id,
            target.backend_node_id,
            target.navigation_id.clone(),
            self.browser_state.clone(),
        )
        .await
    }

    async fn type_text(&self, target: &BrowserToolTarget, text: String) -> Result<String, String> {
        web::browser_type(
            target.element_id,
            target.backend_node_id,
            target.navigation_id.clone(),
            text,
            self.browser_state.clone(),
        )
        .await
    }

    async fn scroll(&self, direction: String, pixels: i64) -> Result<String, String> {
        web::browser_scroll(direction, pixels, self.browser_state.clone()).await
    }

    async fn get_text(&self, max_length: Option<u64>) -> Result<String, String> {
        web::browser_get_text(max_length, self.browser_state.clone()).await
    }

    async fn screenshot(&self) -> Result<String, String> {
        web::browser_screenshot(self.browser_state.clone()).await
    }

    async fn extract_content(&self) -> Result<String, String> {
        web::browser_extract_content(self.browser_state.clone()).await
    }

    async fn press_key(&self, key: String) -> Result<String, String> {
        web::browser_press_key(key, self.browser_state.clone()).await
    }

    async fn wait(
        &self,
        seconds: Option<u64>,
        wait_selector: Option<String>,
    ) -> Result<String, String> {
        web::browser_wait(seconds, wait_selector, self.browser_state.clone()).await
    }
}

/**
 * Start a new chat session
 *
 * Creates a new session in SQLite database
 */
#[tauri::command]
pub async fn start_session(_app: AppHandle) -> AppResult<String> {
    start_session_service().await
}

/**
 * Send a message to the chat
 *
 * Saves message to database and returns assistant's response
 */
#[tauri::command]
pub async fn send_message(
    _app: AppHandle,
    req: SendMessageRequest,
) -> AppResult<SendMessageResponse> {
    send_message_service(req).await
}

/**
 * Save a message to database (called from frontend after streaming)
 */
#[allow(dead_code)]
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn save_message_to_db(
    _app: AppHandle,
    session_id: String,
    role: String,
    content: String,
    reasoning: Option<String>,
    attachments: Option<String>,
    artifacts: Option<String>,
    tool_calls: Option<String>,
    token_usage: Option<String>,
) -> AppResult<String> {
    save_message_to_db_service(
        session_id,
        role,
        content,
        reasoning,
        attachments,
        artifacts,
        tool_calls,
        token_usage,
    )
    .await
}

/**
 * Get a session by ID
 *
 * Returns the session data with messages from database
 */
#[tauri::command]
pub async fn get_session(_app: AppHandle, session_id: String) -> AppResult<String> {
    get_session_service(session_id).await
}

/**
 * List all sessions
 *
 * Returns all session IDs and their basic info (without messages)
 */
#[allow(dead_code)]
#[tauri::command]
pub async fn list_sessions(_app: AppHandle) -> AppResult<Vec<SessionData>> {
    list_sessions_service().await
}

/**
 * Delete a session
 */
#[allow(dead_code)]
#[tauri::command]
pub async fn delete_session(_app: AppHandle, session_id: String) -> AppResult<()> {
    delete_session_service(session_id).await
}

/**
 * Delete all token usage records
 */
#[tauri::command]
pub async fn reset_token_estimate(_app: AppHandle) -> AppResult<()> {
    reset_token_estimate_service().await
}

/**
 * Update session title
 */
#[tauri::command]
pub async fn update_session_title(
    _app: AppHandle,
    session_id: String,
    title: String,
) -> AppResult<()> {
    update_session_title_service(session_id, title).await
}

/**
 * Update session working directory
 */
#[allow(dead_code)]
#[tauri::command]
pub async fn update_session_cwd(_app: AppHandle, session_id: String, cwd: String) -> AppResult<()> {
    update_session_cwd_service(session_id, cwd).await
}

/**
 * Execute a tool (function call)
 */
#[tauri::command]
pub async fn execute_tool(
    tool_name: String,
    arguments: String,
    work_dir: Option<String>,
    browser_state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
    font_state: tauri::State<'_, crate::FontDbState>,
    #[allow(non_snake_case)] apiKey: Option<String>,
    model: Option<String>,
    #[allow(non_snake_case)] baseUrl: Option<String>,
    provider: Option<String>,
    #[allow(non_snake_case)] apiFormat: Option<String>,
    #[allow(non_snake_case)] providerCapabilities: Option<crate::claude::provider::ProviderCapabilities>,
) -> AppResult<String> {
    println!("🔧 Executing tool: {} with args: {}", tool_name, arguments);

    // Parse arguments from JSON string
    let args: serde_json::Value = serde_json::from_str(&arguments)
        .map_err(|e| AppError::InternalError(format!("Invalid tool arguments: {}", e)))?;

    // === Phase 6: Rust-side path/command validation (defense-in-depth) ===
    // This is a backup to the TypeScript-side preToolUseHooks validation
    use crate::commands::path_security;

    match tool_name.as_str() {
        "read_file" | "write_file" | "create_directory" | "path_exists" | "list_files" => {
            if let Some(path) = args.get("path").and_then(|v| v.as_str()) {
                if let Err(e) = path_security::validate_path(path, work_dir.as_deref()) {
                    return Err(AppError::SecurityError(e.message.clone()));
                }
            }
        }
        "search_files" | "glob_search" | "grep_files" => {
            if let Some(path) = args.get("path").and_then(|v| v.as_str()) {
                if let Err(e) = path_security::validate_path(path, work_dir.as_deref()) {
                    return Err(AppError::SecurityError(e.message.clone()));
                }
            }
        }
        "pdf_read" => {
            if let Some(path) = args.get("path").and_then(|v| v.as_str()) {
                if let Err(e) = path_security::validate_path(path, work_dir.as_deref()) {
                    return Err(AppError::SecurityError(e.message.clone()));
                }
            }
        }
        "scaffold_generate" | "git_init_workdir" => {
            if let Some(path) = args.get("workDir").and_then(|v| v.as_str()) {
                if let Err(e) = path_security::validate_path(path, work_dir.as_deref()) {
                    return Err(AppError::SecurityError(e.message.clone()));
                }
            }
        }
        "execute_command" => {
            if let Some(command) = args.get("command").and_then(|v| v.as_str()) {
                if let Err(e) = path_security::validate_command(command) {
                    return Err(AppError::SecurityError(e.message.clone()));
                }
            }
        }
        _ => {}
    }

    if let Some(browser_call) = parse_browser_chat_tool_call(&tool_name, &args)? {
        let runtime = LiveBrowserChatRuntime { browser_state };
        return Ok(execute_browser_chat_tool_call(browser_call, &runtime).await);
    }

    // Execute tool and convert result to JSON
    let result_json = match tool_name.as_str() {
        "pdf_read"
        | "paper_extract_meta"
        | "baseline_extract"
        | "arxiv_search"
        | "scaffold_generate"
        | "git_init_workdir"
        | "bootstrap_finalize" => {
            let provider_context = match (apiKey, model) {
                (Some(api_key), Some(model_name)) if !api_key.trim().is_empty() && !model_name.trim().is_empty() => {
                    Some(crate::tools::autoresearch_bootstrap::BootstrapProviderContext {
                        api_key,
                        model: model_name,
                        base_url: baseUrl.filter(|value| !value.trim().is_empty()),
                        provider: provider.filter(|value| !value.trim().is_empty()),
                        api_format: apiFormat.filter(|value| !value.trim().is_empty()),
                        provider_capabilities: providerCapabilities,
                    })
                }
                _ => None,
            };

            let context = crate::tools::autoresearch_bootstrap::BootstrapExecutionContext {
                work_dir: work_dir.clone(),
                provider: provider_context,
            };

            match crate::tools::autoresearch_bootstrap::execute_tool(&tool_name, &args, &context)
                .await?
            {
                Some(result) => result,
                None => unreachable!("bootstrap tool should have been handled"),
            }
        }
        "read_file" => {
            let path = args.get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'path' argument for read_file".to_string()))?;
            match crate::commands::file::read_file_for_tool(path, work_dir.as_deref()) {
                Ok(result) => serde_json::to_string(&result)
                    .map_err(|e| AppError::InternalError(format!("Failed to serialize: {}", e)))?,
                Err(error) => serde_json::json!({
                    "error": true,
                    "error_kind": error.error_kind,
                    "message": error.message,
                    "path": error.path,
                    "cause": error.cause,
                }).to_string(),
            }
        }
        "write_file" => {
            let path = args.get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'path' argument for write_file".to_string()))?;
            let content = args.get("content")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'content' argument for write_file".to_string()))?;
            match crate::commands::file::write_file_for_tool(path, content, work_dir.as_deref()) {
                Ok(result) => serde_json::to_string(&result)
                    .map_err(|e| AppError::InternalError(format!("Failed to serialize: {}", e)))?,
                Err(error) => serde_json::json!({
                    "error": true,
                    "error_kind": error.error_kind,
                    "message": error.message,
                    "path": error.path,
                    "cause": error.cause,
                }).to_string(),
            }
        }
        "execute_command" => {
            let command = args.get("command")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'command' argument for execute_command".to_string()))?;
            let work_dir_override = args.get("cwd").and_then(|v| v.as_str());
            let result = crate::commands::code::execute_bash_for_tool(
                command,
                work_dir_override,
                work_dir.as_deref(),
                None,
                None,
            )?;
            serde_json::to_string(&result).map_err(|e| AppError::InternalError(format!("Failed to serialize: {}", e)))?
        }
        "create_directory" => {
            let path = args.get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'path' argument for create_directory".to_string()))?;
            match crate::commands::file::create_directory_for_tool(path, work_dir.as_deref()) {
                Ok(result) => serde_json::to_string(&result)
                    .map_err(|e| AppError::InternalError(format!("Failed to serialize: {}", e)))?,
                Err(error) => serde_json::json!({
                    "error": true,
                    "error_kind": error.error_kind,
                    "message": error.message,
                    "path": error.path,
                    "cause": error.cause,
                }).to_string(),
            }
        }
        "path_exists" => {
            let path = args.get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'path' argument for path_exists".to_string()))?;
            let result = crate::commands::file::path_exists(path.to_string(), work_dir.clone()).await?;
            serde_json::to_string(&result).map_err(|e| AppError::InternalError(format!("Failed to serialize: {}", e)))?
        }
        "list_files" => {
            let path = args.get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'path' argument for list_files".to_string()))?;
            let pattern = args.get("pattern")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let result = crate::commands::file::list_files(path.to_string(), pattern, work_dir.clone()).await?;
            serde_json::to_string(&result).map_err(|e| AppError::InternalError(format!("Failed to serialize: {}", e)))?
        }
        "search_files" => {
            let pattern = args.get("pattern")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'pattern' argument for search_files".to_string()))?;
            let path = args.get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'path' argument for search_files".to_string()))?;
            let extensions = args.get("extensions")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|e| e.as_str().map(String::from)).collect());
            crate::commands::search::search_files(pattern.to_string(), path.to_string(), extensions, work_dir.clone()).await?
        }
        "glob_search" => {
            let pattern = args.get("pattern")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'pattern' argument for glob_search".to_string()))?;
            let path = args.get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'path' argument for glob_search".to_string()))?;
            crate::commands::search::glob_search(pattern.to_string(), path.to_string(), work_dir.clone()).await?
        }
        "grep_files" => {
            let pattern = args.get("pattern")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'pattern' argument for grep_files".to_string()))?;
            let path = args.get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'path' argument for grep_files".to_string()))?;
            crate::commands::search::grep_files(pattern.to_string(), path.to_string(), work_dir.clone()).await?
        }
        // get_current_workspace 由 TS 侧拦截（chatStore.ts executeTool），
        // 直接从内存中的 session.workDir 返回，不会走到 Rust 这里。
        // 这个分支是安全兜底：万一绕过 TS 直接调用 execute_tool，返回提示而不是崩溃。
        "get_current_workspace" => {
            serde_json::json!({
                "error": false,
                "message": "get_current_workspace is handled by the frontend. The workspace path is injected into the system prompt automatically."
            }).to_string()
        }

        "Skill" => {
            let skill_name = args.get("skill")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'skill' argument for Skill".to_string()))?;

            match crate::commands::skill::execute_skill(skill_name.to_string(), work_dir.clone()).await {
                Ok(res) => {
                    if res.success {
                        // Return the SKILL.md content directly so the AI can read and follow it
                        res.output.unwrap_or_else(|| format!("Skill '{}' loaded but has no content.", skill_name))
                    } else {
                        format!("Skill '{}' not found. Available skills: autoresearch, resume, pdf, docx, xlsx, web_research, form_fill. Error: {}",
                            skill_name,
                            res.error.unwrap_or_else(|| "unknown".to_string()))
                    }
                },
                Err(e) => format!("ERROR: Failed to execute skill '{}': {}", skill_name, e),
            }
        }

        "render_typst_to_svg" => {
            let source = args.get("source")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'source' argument for render_typst_to_svg".to_string()))?;
            let book = font_state.prebuilt.book.clone();
            let fonts = font_state.prebuilt.fonts.clone();
            let source_owned = source.to_string();
            let svg = tokio::task::spawn_blocking(move || {
                let prebuilt = crate::utils::typst::PrebuiltFonts { book, fonts };
                crate::utils::typst::compile_typst_to_svg_with_prebuilt(&source_owned, &prebuilt)
            })
            .await
            .map_err(|e| AppError::InternalError(format!("Thread error: {}", e)))?
            .map_err(|e| {
                let mut msg = format!("Typst compilation failed: {}", e);
                if e.contains("label") && e.contains("does not exist") {
                    msg += "\n\nHint: The '@' character starts a label reference in Typst. Escape it as '\\@' in .typ files (e.g., user\\@example.com).";
                }
                AppError::InternalError(msg)
            })?;
            serde_json::json!({ "svg": svg }).to_string()
        }

        "render_typst_to_pdf" => {
            let source = args.get("source")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'source' argument for render_typst_to_pdf".to_string()))?;
            let file_path = args.get("file_path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'file_path' argument for render_typst_to_pdf".to_string()))?;
            let book = font_state.prebuilt.book.clone();
            let fonts = font_state.prebuilt.fonts.clone();
            let source_owned = source.to_string();
            let pdf_bytes = tokio::task::spawn_blocking(move || {
                let prebuilt = crate::utils::typst::PrebuiltFonts { book, fonts };
                crate::utils::typst::compile_typst_to_pdf_with_prebuilt(&source_owned, &prebuilt)
            })
            .await
            .map_err(|e| AppError::InternalError(format!("Thread error: {}", e)))?
            .map_err(|e| {
                let mut msg = format!("Typst compilation failed: {}", e);
                if e.contains("label") && e.contains("does not exist") {
                    msg += "\n\nHint: The '@' character starts a label reference in Typst. Escape it as '\\@' in .typ files (e.g., user\\@example.com).";
                }
                AppError::InternalError(msg)
            })?;
            std::fs::write(file_path, pdf_bytes)
                .map_err(|e| AppError::InternalError(format!("Failed to write PDF: {}", e)))?;
            serde_json::json!({ "file_path": file_path, "message": format!("PDF saved to {}", file_path) }).to_string()
        }

        "compile_typst_file" => {
            let typ_path = args.get("file_path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'file_path' argument for compile_typst_file".to_string()))?;
            let output_dir = args.get("output_dir")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'output_dir' argument for compile_typst_file".to_string()))?;

            let typ_path_buf = std::path::PathBuf::from(typ_path);
            let output_dir_buf = std::path::PathBuf::from(output_dir);
            let book = font_state.prebuilt.book.clone();
            let fonts = font_state.prebuilt.fonts.clone();

            let (svg_string, pdf_bytes) = tokio::task::spawn_blocking(move || {
                let prebuilt = crate::utils::typst::PrebuiltFonts { book, fonts };
                let templates_dir = crate::utils::typst::find_templates_dir();
                crate::utils::typst::compile_typst_file(
                    &typ_path_buf,
                    &prebuilt,
                    templates_dir.as_deref(),
                )
            })
            .await
            .map_err(|e| AppError::InternalError(format!("Thread error: {}", e)))?
            .map_err(|e| {
                let mut msg = format!("Typst compilation failed: {}", e);
                if e.contains("file not found") || e.contains("not found") && e.contains("@preview") {
                    msg += "\n\nAvailable bundled @preview packages: basic-resume:0.2.9, grotesk-cv:1.0.5, nabcv:0.1.0, brilliant-cv:3.3.0, calligraphics:1.0.0. Do NOT invent package names. Call Skill(\"resume\") to load the correct code examples for each template.";
                }
                if e.contains("label") && e.contains("does not exist") {
                    msg += "\n\nHint: The '@' character starts a label reference in Typst. You MUST escape it as '\\@' inside .typ files (e.g., user\\@example.com). Do NOT escape @ in .toml files.";
                }
                AppError::InternalError(msg)
            })?;

            // Write PDF
            let pdf_path = output_dir_buf.join("resume.pdf");
            std::fs::create_dir_all(&output_dir_buf)
                .map_err(|e| AppError::InternalError(format!("Failed to create output dir: {}", e)))?;
            std::fs::write(&pdf_path, pdf_bytes)
                .map_err(|e| AppError::InternalError(format!("Failed to write PDF: {}", e)))?;

            // Write SVG preview
            let svg_path = output_dir_buf.join("resume-preview.svg");
            std::fs::write(&svg_path, &svg_string)
                .map_err(|e| AppError::InternalError(format!("Failed to write SVG: {}", e)))?;

            serde_json::json!({
                "pdf_path": pdf_path.to_string_lossy(),
                "svg_path": svg_path.to_string_lossy(),
                "svg": svg_string,
                "message": format!("Resume compiled successfully. PDF: {}", pdf_path.display())
            }).to_string()
        }

        // 第一层防御：unknown tool 返回合法 JSON，让 Claude 自己 fallback 到文本回复
        _ => {
            let supported_tools = vec![
                "read_file", "write_file", "append_file", "list_files", "path_exists",
                "create_directory", "code_execution", "search_files", "glob_search",
                "grep_files", "get_current_workspace",
                "browser_navigate", "browser_get_page", "browser_click", "browser_type",
                "browser_scroll", "browser_get_text", "browser_screenshot",
                "browser_extract_content", "browser_press_key", "browser_wait",
                "Skill", "render_typst_to_svg", "render_typst_to_pdf", "compile_typst_file"
            ];
            return Ok(serde_json::json!({
                "error": true,
                "error_kind": "tool_not_found",
                "message": format!(
                    "工具 '{}' 不存在或暂不支持。可用工具: {}",
                    tool_name,
                    supported_tools.join(", ")
                ),
                "tool": tool_name,
                "cause": format!("Supported tools: {}", supported_tools.join(", "))
            }).to_string());
        }
    };

    Ok(result_json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::actions;
    use crate::browser::actions::common::BrowserActionError;
    use crate::browser::actions::test_support::{
        load_page_state_fixture, CheckoutFlowServer, FixtureActionHarness, LiveActionHarness,
    };
    use crate::browser::actions::ElementReference;
    use crate::browser::dom::InteractiveElement;
    use anyhow::Result as AnyhowResult;
    use std::sync::Mutex as StdMutex;

    #[test]
    fn browser_target_from_args_accepts_navigation_id_aliases() {
        let args = serde_json::json!({
            "elementId": 7,
            "backendNodeId": 701,
            "navigationId": "nav-42"
        });

        let target = browser_target_from_args(&args, "browser_click").unwrap();

        assert_eq!(target, (Some(7), Some(701), Some("nav-42".to_string())));
    }

    #[test]
    fn parse_browser_wait_accepts_selector_aliases() {
        let args = serde_json::json!({
            "waitSelector": ".checkout-ready"
        });

        let call = parse_browser_chat_tool_call("browser_wait", &args)
            .unwrap()
            .unwrap();

        assert_eq!(
            call,
            BrowserChatToolCall::Wait {
                seconds: None,
                wait_selector: Some(".checkout-ready".to_string()),
            }
        );
    }

    #[test]
    fn serialize_page_state_for_chat_emits_pretty_json() {
        let page_state = sample_page_state();

        let rendered = serialize_page_state_for_chat(&page_state);

        assert!(rendered.starts_with("{\n"));
        assert!(rendered.contains("\"navigation_id\": \"nav-42\""));
        assert!(rendered.contains("\"backend_node_id\": 101"));
        assert!(rendered.contains("\"warnings\": [\n    \"cross_origin_iframe_partial\"\n  ]"));
    }

    #[tokio::test]
    async fn browser_get_page_returns_pretty_json_through_chat_dispatcher() {
        let runtime = FakeBrowserChatRuntime::default();

        let rendered = execute_browser_chat_tool_call(BrowserChatToolCall::GetPage, &runtime).await;

        assert!(rendered.contains("\"title\": \"Dashboard\""));
        assert!(rendered.contains("\"backend_node_id\": 101"));
    }

    #[tokio::test]
    async fn browser_click_formats_backend_node_target_labels() {
        let runtime = FakeBrowserChatRuntime::default();
        let call = parse_browser_chat_tool_call(
            "browser_click",
            &serde_json::json!({
                "backendNodeId": 701,
                "navigationId": "nav-42"
            }),
        )
        .unwrap()
        .unwrap();

        let rendered = execute_browser_chat_tool_call(call, &runtime).await;

        assert_eq!(
            rendered,
            "已点击backend_node_id 701，页面可能已更新，请使用 browser_get_page 查看新状态"
        );
        assert_eq!(
            runtime.last_click_target.lock().unwrap().clone(),
            Some(BrowserToolTarget {
                element_id: None,
                backend_node_id: Some(701),
                navigation_id: Some("nav-42".to_string()),
            })
        );
    }

    #[tokio::test]
    async fn browser_type_reports_targeted_failures_for_chat_tools() {
        let runtime = FakeBrowserChatRuntime {
            type_result: Err("browser.page_state_stale".to_string()),
            ..FakeBrowserChatRuntime::default()
        };
        let call = parse_browser_chat_tool_call(
            "browser_type",
            &serde_json::json!({
                "element_id": 7,
                "backend_node_id": 701,
                "text": "hello"
            }),
        )
        .unwrap()
        .unwrap();

        let rendered = execute_browser_chat_tool_call(call, &runtime).await;

        assert_eq!(
            rendered,
            "ERROR: 向元素 7 / backend_node_id 701输入失败: browser.page_state_stale"
        );
    }

    #[tokio::test]
    async fn browser_get_page_maps_not_connected_errors_to_user_guidance() {
        let runtime = FakeBrowserChatRuntime {
            page_state_result: Err("Browser not connected".to_string()),
            ..FakeBrowserChatRuntime::default()
        };

        let rendered = execute_browser_chat_tool_call(BrowserChatToolCall::GetPage, &runtime).await;

        assert_eq!(rendered, browser_not_connected_message());
    }

    #[tokio::test]
    async fn browser_navigate_uses_page_state_title_after_resync_warning() {
        let runtime = FakeBrowserChatRuntime {
            resync_result: Err("page replaced".to_string()),
            ..FakeBrowserChatRuntime::default()
        };

        let rendered = execute_browser_chat_tool_call(
            BrowserChatToolCall::Navigate {
                url: "https://example.com/checkout".to_string(),
                wait_selector: Some(".checkout-ready".to_string()),
            },
            &runtime,
        )
        .await;

        assert_eq!(
            rendered,
            "已导航到: https://example.com/checkout，页面标题: Dashboard"
        );
    }

    #[tokio::test]
    async fn browser_type_retries_with_fresh_iframe_fixture_through_action_context_harness() {
        let runtime = FixtureBrowserChatRuntime::new(
            Some(load_page_state_fixture("iframe-retry-cache")),
            vec![load_page_state_fixture("iframe-shadow")],
        )
        .await;
        let call = parse_browser_chat_tool_call(
            "browser_type",
            &serde_json::json!({
                "backendNodeId": 310,
                "navigationId": "loader-root-1",
                "text": "4242"
            }),
        )
        .unwrap()
        .unwrap();

        let rendered = execute_browser_chat_tool_call(call, &runtime).await;

        assert_eq!(rendered, "输入成功: backend_node_id 310，共 4 个字符");
        assert_eq!(runtime.capture_count().await, 1);
        assert_eq!(
            runtime
                .last_resolved_element()
                .as_ref()
                .map(|element| element.frame_id.as_str()),
            Some("frame-checkout")
        );
    }

    #[tokio::test]
    async fn browser_click_recovers_after_refreshing_navigation_id_from_browser_get_page() {
        let refreshed_page_state = load_page_state_fixture("navigation-refresh");
        let runtime = FixtureBrowserChatRuntime::new(
            Some(refreshed_page_state.clone()),
            vec![refreshed_page_state.clone(), refreshed_page_state.clone()],
        )
        .await;
        let stale_click = parse_browser_chat_tool_call(
            "browser_click",
            &serde_json::json!({
                "backendNodeId": 200,
                "navigationId": "loader-root-1"
            }),
        )
        .unwrap()
        .unwrap();

        let stale_rendered = execute_browser_chat_tool_call(stale_click, &runtime).await;

        assert!(stale_rendered.contains("browser.page_state_stale"));
        assert!(stale_rendered.contains("loader-root-2"));

        let page_state_json =
            execute_browser_chat_tool_call(BrowserChatToolCall::GetPage, &runtime).await;
        assert!(page_state_json.contains("\"navigation_id\": \"loader-root-2\""));
        assert!(page_state_json.contains("\"title\": \"Review Order\""));

        let fresh_click = parse_browser_chat_tool_call(
            "browser_click",
            &serde_json::json!({
                "backendNodeId": 200,
                "navigationId": "loader-root-2"
            }),
        )
        .unwrap()
        .unwrap();

        let fresh_rendered = execute_browser_chat_tool_call(fresh_click, &runtime).await;

        assert_eq!(
            fresh_rendered,
            "已点击backend_node_id 200，页面可能已更新，请使用 browser_get_page 查看新状态"
        );
        assert_eq!(runtime.capture_count().await, 2);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore = "requires a local Chrome/Chromium binary for Chromiumoxide Browser::launch"]
    async fn live_browser_chat_tools_render_shadow_success_messages() -> AnyhowResult<()> {
        let server = CheckoutFlowServer::start().await?;
        let harness = LiveActionHarness::launch().await?;

        let live_result = async {
            let runtime = LiveHarnessBrowserChatRuntime::new(&harness);
            let navigate_url = server.shadow_checkout_url();
            let navigate_rendered = execute_browser_chat_tool_call(
                BrowserChatToolCall::Navigate {
                    url: navigate_url.clone(),
                    wait_selector: Some("#page-ready.ready".to_string()),
                },
                &runtime,
            )
            .await;
            assert_eq!(
                navigate_rendered,
                format!("已导航到: {}，页面标题: Shadow Checkout Flow", navigate_url)
            );

            let page_state = actions::get_page_state(harness.ctx())
                .await
                .map_err(anyhow::Error::msg)?;
            let shadow_input = find_live_element(&page_state, "shadow chat input", |element| {
                element.frame_id != "root"
                    && element.is_editable
                    && element.selector_hint.as_deref() == Some("#shadow-card-number")
            })?;
            let shadow_button = find_live_element(&page_state, "shadow chat button", |element| {
                element.frame_id != "root"
                    && element.is_clickable
                    && element.tag_name.as_deref() == Some("button")
                    && element.selector_hint.as_deref() == Some("#shadow-confirm-payment")
            })?;

            let get_page_rendered =
                execute_browser_chat_tool_call(BrowserChatToolCall::GetPage, &runtime).await;
            assert!(get_page_rendered.contains("\"title\": \"Shadow Checkout Flow\""));
            assert!(get_page_rendered.contains("\"selector_hint\": \"#shadow-confirm-payment\""));

            let typed_value = "7777 8888 9999 0000".to_string();
            let type_rendered = execute_browser_chat_tool_call(
                parse_browser_chat_tool_call(
                    "browser_type",
                    &serde_json::json!({
                        "backendNodeId": shadow_input.backend_node_id,
                        "navigationId": page_state.navigation_id,
                        "text": typed_value,
                    }),
                )
                .unwrap()
                .unwrap(),
                &runtime,
            )
            .await;
            assert_eq!(
                type_rendered,
                format!(
                    "输入成功: backend_node_id {}，共 {} 个字符",
                    shadow_input.backend_node_id, 19
                )
            );

            let click_rendered = execute_browser_chat_tool_call(
                parse_browser_chat_tool_call(
                    "browser_click",
                    &serde_json::json!({
                        "backendNodeId": shadow_button.backend_node_id,
                        "navigationId": page_state.navigation_id,
                    }),
                )
                .unwrap()
                .unwrap(),
                &runtime,
            )
            .await;
            assert_eq!(
                click_rendered,
                format!(
                    "已点击backend_node_id {}，页面可能已更新，请使用 browser_get_page 查看新状态",
                    shadow_button.backend_node_id
                )
            );

            let wait_rendered = execute_browser_chat_tool_call(
                BrowserChatToolCall::Wait {
                    seconds: None,
                    wait_selector: Some("#payment-status.ready".to_string()),
                },
                &runtime,
            )
            .await;
            assert!(wait_rendered.starts_with("等待完成，目标选择器已出现（"));

            let status_text = read_selector_text_live(&harness, "#payment-status").await?;
            assert!(status_text.contains("confirmed:"));
            assert!(status_text.contains("7777"));

            Ok::<(), anyhow::Error>(())
        }
        .await;

        let harness_shutdown = harness.shutdown().await;
        let server_shutdown = server.shutdown().await;

        live_result?;
        harness_shutdown?;
        server_shutdown?;
        Ok(())
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore = "requires a local Chrome/Chromium binary for Chromiumoxide Browser::launch"]
    async fn live_browser_chat_tools_map_shadow_stale_navigation_errors() -> AnyhowResult<()> {
        let server = CheckoutFlowServer::start().await?;
        let harness = LiveActionHarness::launch().await?;

        let live_result = async {
            let runtime = LiveHarnessBrowserChatRuntime::new(&harness);
            let navigate_rendered = execute_browser_chat_tool_call(
                BrowserChatToolCall::Navigate {
                    url: server.shadow_checkout_url(),
                    wait_selector: Some("#page-ready.ready".to_string()),
                },
                &runtime,
            )
            .await;
            assert!(navigate_rendered.contains("Shadow Checkout Flow"));

            let stale_page_state = actions::get_page_state(harness.ctx())
                .await
                .map_err(anyhow::Error::msg)?;
            let stale_button =
                find_live_element(&stale_page_state, "stale shadow button", |element| {
                    element.frame_id != "root"
                        && element.is_clickable
                        && element.selector_hint.as_deref() == Some("#shadow-confirm-payment")
                })?;

            harness.page().reload().await.map_err(anyhow::Error::from)?;

            let reload_wait_rendered = execute_browser_chat_tool_call(
                BrowserChatToolCall::Wait {
                    seconds: None,
                    wait_selector: Some("#page-ready.ready".to_string()),
                },
                &runtime,
            )
            .await;
            assert!(reload_wait_rendered.starts_with("等待完成，目标选择器已出现（"));

            let refreshed_page_state = actions::get_page_state(harness.ctx())
                .await
                .map_err(anyhow::Error::msg)?;
            assert_ne!(
                refreshed_page_state.navigation_id,
                stale_page_state.navigation_id
            );

            let stale_click_rendered = execute_browser_chat_tool_call(
                parse_browser_chat_tool_call(
                    "browser_click",
                    &serde_json::json!({
                        "backendNodeId": stale_button.backend_node_id,
                        "navigationId": stale_page_state.navigation_id,
                    }),
                )
                .unwrap()
                .unwrap(),
                &runtime,
            )
            .await;
            assert!(stale_click_rendered.contains(&format!(
                "ERROR: 点击backend_node_id {}失败:",
                stale_button.backend_node_id
            )));
            assert!(stale_click_rendered.contains("browser.page_state_stale"));
            assert!(stale_click_rendered.contains(&refreshed_page_state.navigation_id));

            let get_page_rendered =
                execute_browser_chat_tool_call(BrowserChatToolCall::GetPage, &runtime).await;
            assert!(get_page_rendered.contains(&format!(
                "\"navigation_id\": \"{}\"",
                refreshed_page_state.navigation_id
            )));

            Ok::<(), anyhow::Error>(())
        }
        .await;

        let harness_shutdown = harness.shutdown().await;
        let server_shutdown = server.shutdown().await;

        live_result?;
        harness_shutdown?;
        server_shutdown?;
        Ok(())
    }

    fn find_live_element<F>(
        page_state: &PageState,
        label: &str,
        predicate: F,
    ) -> AnyhowResult<InteractiveElement>
    where
        F: Fn(&InteractiveElement) -> bool,
    {
        let element_debug = serde_json::to_string_pretty(&page_state.elements)
            .unwrap_or_else(|_| format!("{:?}", page_state.elements));

        page_state
            .elements
            .iter()
            .find(|element| predicate(element))
            .cloned()
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "expected {} in live page state; elements={}",
                    label,
                    element_debug
                )
            })
    }

    async fn read_selector_text_live(
        harness: &LiveActionHarness,
        selector: &str,
    ) -> AnyhowResult<String> {
        let script = format!(
            "(function() {{ const node = document.querySelector({selector:?}); return node ? node.textContent : ''; }})()",
        );
        harness
            .page()
            .evaluate(script)
            .await
            .map_err(anyhow::Error::from)?
            .into_value::<String>()
            .map_err(anyhow::Error::from)
    }

    fn sample_page_state() -> PageState {
        PageState {
            url: "https://example.com/dashboard".to_string(),
            title: "Dashboard".to_string(),
            navigation_id: "nav-42".to_string(),
            frame_count: 2,
            viewport: None,
            warnings: vec!["cross_origin_iframe_partial".to_string()],
            elements: vec![InteractiveElement {
                index: 1,
                backend_node_id: 101,
                frame_id: "root".to_string(),
                role: "button".to_string(),
                name: "Sync Now".to_string(),
                tag_name: Some("button".to_string()),
                bounds: None,
                is_visible: true,
                is_clickable: true,
                is_editable: false,
                selector_hint: Some("button[data-action=\"sync\"]".to_string()),
                text_hint: None,
                href: None,
                input_type: None,
            }],
            screenshot: None,
        }
    }

    struct FixtureBrowserChatRuntime {
        harness: FixtureActionHarness,
        last_resolved_element: StdMutex<Option<InteractiveElement>>,
    }

    impl FixtureBrowserChatRuntime {
        async fn new(
            cached_page_state: Option<PageState>,
            queued_page_states: Vec<PageState>,
        ) -> Self {
            Self {
                harness: FixtureActionHarness::new(cached_page_state, queued_page_states).await,
                last_resolved_element: StdMutex::new(None),
            }
        }

        async fn capture_count(&self) -> usize {
            self.harness.capture_count().await
        }

        fn last_resolved_element(&self) -> Option<InteractiveElement> {
            self.last_resolved_element.lock().unwrap().clone()
        }

        fn to_element_reference(target: &BrowserToolTarget) -> ElementReference {
            ElementReference {
                index: target.element_id,
                backend_node_id: target.backend_node_id,
                navigation_id: target.navigation_id.clone(),
            }
        }

        async fn resolve_target(
            &self,
            target: &BrowserToolTarget,
        ) -> Result<InteractiveElement, String> {
            let element = self
                .harness
                .resolve_element(Self::to_element_reference(target))
                .await
                .map_err(|error| error.to_string())?;
            *self.last_resolved_element.lock().unwrap() = Some(element.clone());
            Ok(element)
        }
    }

    struct LiveHarnessBrowserChatRuntime<'a> {
        harness: &'a LiveActionHarness,
    }

    impl<'a> LiveHarnessBrowserChatRuntime<'a> {
        fn new(harness: &'a LiveActionHarness) -> Self {
            Self { harness }
        }

        fn to_element_reference(target: &BrowserToolTarget) -> ElementReference {
            ElementReference {
                index: target.element_id,
                backend_node_id: target.backend_node_id,
                navigation_id: target.navigation_id.clone(),
            }
        }
    }

    struct FakeBrowserChatRuntime {
        navigate_result: Result<(), String>,
        resync_result: Result<(), String>,
        page_state_result: Result<PageState, String>,
        click_result: Result<String, String>,
        type_result: Result<String, String>,
        scroll_result: Result<String, String>,
        text_result: Result<String, String>,
        screenshot_result: Result<String, String>,
        extract_result: Result<String, String>,
        press_key_result: Result<String, String>,
        wait_result: Result<String, String>,
        last_click_target: StdMutex<Option<BrowserToolTarget>>,
    }

    impl Default for FakeBrowserChatRuntime {
        fn default() -> Self {
            Self {
                navigate_result: Ok(()),
                resync_result: Ok(()),
                page_state_result: Ok(sample_page_state()),
                click_result: Ok("clicked".to_string()),
                type_result: Ok("输入成功: backend_node_id 701，共 5 个字符".to_string()),
                scroll_result: Ok("scrolled".to_string()),
                text_result: Ok("Page content".to_string()),
                screenshot_result: Ok("base64-image".to_string()),
                extract_result: Ok("structured content".to_string()),
                press_key_result: Ok("pressed".to_string()),
                wait_result: Ok("等待完成，目标选择器已出现（250ms）".to_string()),
                last_click_target: StdMutex::new(None),
            }
        }
    }

    #[async_trait]
    impl BrowserChatRuntime for FakeBrowserChatRuntime {
        async fn navigate_and_wait(
            &self,
            _url: String,
            _wait_selector: Option<String>,
        ) -> Result<(), String> {
            self.navigate_result.clone()
        }

        async fn resync_page(&self) -> Result<(), String> {
            self.resync_result.clone()
        }

        async fn get_page_state(&self) -> Result<PageState, String> {
            self.page_state_result.clone()
        }

        async fn click(&self, target: &BrowserToolTarget) -> Result<String, String> {
            *self.last_click_target.lock().unwrap() = Some(target.clone());
            self.click_result.clone()
        }

        async fn type_text(
            &self,
            _target: &BrowserToolTarget,
            _text: String,
        ) -> Result<String, String> {
            self.type_result.clone()
        }

        async fn scroll(&self, _direction: String, _pixels: i64) -> Result<String, String> {
            self.scroll_result.clone()
        }

        async fn get_text(&self, _max_length: Option<u64>) -> Result<String, String> {
            self.text_result.clone()
        }

        async fn screenshot(&self) -> Result<String, String> {
            self.screenshot_result.clone()
        }

        async fn extract_content(&self) -> Result<String, String> {
            self.extract_result.clone()
        }

        async fn press_key(&self, _key: String) -> Result<String, String> {
            self.press_key_result.clone()
        }

        async fn wait(
            &self,
            _seconds: Option<u64>,
            _wait_selector: Option<String>,
        ) -> Result<String, String> {
            self.wait_result.clone()
        }

        async fn delay_after_click(&self) {}
    }

    #[async_trait]
    impl BrowserChatRuntime for FixtureBrowserChatRuntime {
        async fn navigate_and_wait(
            &self,
            _url: String,
            _wait_selector: Option<String>,
        ) -> Result<(), String> {
            Ok(())
        }

        async fn resync_page(&self) -> Result<(), String> {
            Ok(())
        }

        async fn get_page_state(&self) -> Result<PageState, String> {
            crate::browser::actions::get_page_state(self.harness.ctx())
                .await
                .map_err(|error| error.to_string())
        }

        async fn click(&self, target: &BrowserToolTarget) -> Result<String, String> {
            let element = self.resolve_target(target).await?;
            if !element.is_visible || !element.is_clickable {
                return Err(BrowserActionError::element_not_interactable(format!(
                    "{} is not a visible clickable element.",
                    Self::to_element_reference(target).description()
                ))
                .to_string());
            }

            Ok(format!(
                "点击成功: backend_node_id {}{}",
                element.backend_node_id,
                element
                    .tag_name
                    .as_ref()
                    .map(|tag| format!(" <{}>", tag))
                    .unwrap_or_default()
            ))
        }

        async fn type_text(
            &self,
            target: &BrowserToolTarget,
            text: String,
        ) -> Result<String, String> {
            let element = self.resolve_target(target).await?;
            if !element.is_visible || !element.is_editable {
                return Err(BrowserActionError::element_not_interactable(format!(
                    "{} is not an editable visible element.",
                    Self::to_element_reference(target).description()
                ))
                .to_string());
            }

            Ok(format!(
                "输入成功: backend_node_id {}，共 {} 个字符",
                element.backend_node_id,
                text.chars().count()
            ))
        }

        async fn scroll(&self, direction: String, pixels: i64) -> Result<String, String> {
            Ok(format!("滚动: {} {}px", direction, pixels))
        }

        async fn get_text(&self, _max_length: Option<u64>) -> Result<String, String> {
            Ok(String::new())
        }

        async fn screenshot(&self) -> Result<String, String> {
            Ok("fixture-screenshot".to_string())
        }

        async fn extract_content(&self) -> Result<String, String> {
            Ok("fixture-content".to_string())
        }

        async fn press_key(&self, key: String) -> Result<String, String> {
            Ok(format!("已按下键 '{}'", key))
        }

        async fn wait(
            &self,
            seconds: Option<u64>,
            wait_selector: Option<String>,
        ) -> Result<String, String> {
            if wait_selector.is_some() {
                Ok("等待完成，目标选择器已出现（0ms）".to_string())
            } else {
                Ok(format!("已等待 {} 秒", seconds.unwrap_or(2)))
            }
        }

        async fn delay_after_click(&self) {}
    }

    #[async_trait]
    impl BrowserChatRuntime for LiveHarnessBrowserChatRuntime<'_> {
        async fn navigate_and_wait(
            &self,
            url: String,
            wait_selector: Option<String>,
        ) -> Result<(), String> {
            actions::navigate(
                self.harness.ctx(),
                actions::NavigateInput {
                    url: Some(url),
                    wait_selector,
                    timeout_ms: None,
                },
            )
            .await
            .map(|_| ())
            .map_err(|error| error.to_string())
        }

        async fn resync_page(&self) -> Result<(), String> {
            Ok(())
        }

        async fn get_page_state(&self) -> Result<PageState, String> {
            actions::get_page_state(self.harness.ctx())
                .await
                .map_err(|error| error.to_string())
        }

        async fn click(&self, target: &BrowserToolTarget) -> Result<String, String> {
            let output = actions::click(
                self.harness.ctx(),
                actions::ClickInput {
                    target: Self::to_element_reference(target),
                },
            )
            .await
            .map_err(|error| error.to_string())?;

            Ok(format!(
                "点击成功: backend_node_id {}{}",
                output.backend_node_id,
                output
                    .tag_name
                    .as_ref()
                    .map(|tag| format!(" <{}>", tag))
                    .unwrap_or_default()
            ))
        }

        async fn type_text(
            &self,
            target: &BrowserToolTarget,
            text: String,
        ) -> Result<String, String> {
            let text_len = text.chars().count();
            let output = actions::type_text(
                self.harness.ctx(),
                actions::TypeTextInput {
                    target: Self::to_element_reference(target),
                    text,
                },
            )
            .await
            .map_err(|error| error.to_string())?;

            Ok(format!(
                "输入成功: backend_node_id {}，共 {} 个字符",
                output.backend_node_id, text_len
            ))
        }

        async fn scroll(&self, direction: String, pixels: i64) -> Result<String, String> {
            actions::scroll(
                self.harness.ctx(),
                actions::ScrollInput { direction, pixels },
            )
            .await
            .map(|_| "ok".to_string())
            .map_err(|error| error.to_string())
        }

        async fn get_text(&self, max_length: Option<u64>) -> Result<String, String> {
            actions::get_text_content(
                self.harness.ctx(),
                actions::GetTextContentInput {
                    max_length: max_length.unwrap_or(3_000) as usize,
                },
            )
            .await
            .map_err(|error| error.to_string())
        }

        async fn screenshot(&self) -> Result<String, String> {
            actions::screenshot(self.harness.ctx())
                .await
                .map(|screenshot| screenshot.value)
                .map_err(|error| error.to_string())
        }

        async fn extract_content(&self) -> Result<String, String> {
            actions::extract_content(self.harness.ctx(), actions::ExtractContentInput)
                .await
                .map_err(|error| error.to_string())
        }

        async fn press_key(&self, key: String) -> Result<String, String> {
            actions::press_key(self.harness.ctx(), actions::PressKeyInput { key })
                .await
                .map(|output| format!("已按下键 '{}'", output.key))
                .map_err(|error| error.to_string())
        }

        async fn wait(
            &self,
            seconds: Option<u64>,
            wait_selector: Option<String>,
        ) -> Result<String, String> {
            let output = actions::wait(
                self.harness.ctx(),
                actions::WaitInput {
                    seconds,
                    wait_selector,
                    timeout_ms: None,
                },
            )
            .await
            .map_err(|error| error.to_string())?;

            if output.selector_matched {
                Ok(format!(
                    "等待完成，目标选择器已出现（{}ms）",
                    output.waited_ms
                ))
            } else {
                Ok(format!("已等待 {} 秒", output.waited_ms / 1_000))
            }
        }

        async fn delay_after_click(&self) {}
    }
}
