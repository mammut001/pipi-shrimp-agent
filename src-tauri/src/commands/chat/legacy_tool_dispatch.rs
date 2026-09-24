use super::resolve_typst_path;
use crate::browser::dom::PageState;
use crate::commands::legacy_execute_tool::{
    build_legacy_tool_request, is_legacy_chat_only_tool, reject_legacy_execute_tool,
    LEGACY_EXECUTE_TOOL_DISABLED_MSG,
};
use crate::commands::tools::ToolRegistryState;
use crate::commands::web::{self, BrowserController};
use crate::services::chat::browser_tool_service::{
    execute_browser_chat_tool_call, parse_browser_chat_tool_call, BrowserChatRuntime,
    BrowserToolTarget,
};
use crate::tools::ToolExecutionSource;
use crate::utils::{AppError, AppResult};
use async_trait::async_trait;
use std::sync::Arc;
use tokio::sync::Mutex;

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

pub(super) async fn execute_tool_impl(
    tool_name: String,
    arguments: String,
    work_dir: Option<String>,
    browser_state: tauri::State<'_, Arc<Mutex<BrowserController>>>,
    font_state: tauri::State<'_, crate::FontDbState>,
    state: tauri::State<'_, ToolRegistryState>,
    #[allow(non_snake_case)] toolCallId: Option<String>,
    #[allow(non_snake_case)] sessionId: Option<String>,
    #[allow(non_snake_case)] approvalToken: Option<String>,
    source: Option<ToolExecutionSource>,
    #[allow(non_snake_case)] executionMode: Option<String>,
    #[allow(non_snake_case)] apiKey: Option<String>,
    model: Option<String>,
    #[allow(non_snake_case)] baseUrl: Option<String>,
    provider: Option<String>,
    #[allow(non_snake_case)] apiFormat: Option<String>,
    #[allow(non_snake_case)] providerCapabilities: Option<
        crate::claude::provider::ProviderCapabilities,
    >,
) -> AppResult<String> {
    let args: serde_json::Value = serde_json::from_str(&arguments)
        .map_err(|e| AppError::InternalError(format!("Invalid tool arguments: {}", e)))?;

    let registry_contains_tool = {
        let registry = state.0.lock().await;
        registry.is_registered(&tool_name)
    };
    reject_legacy_execute_tool(&tool_name, registry_contains_tool)?;

    debug_assert!(is_legacy_chat_only_tool(&tool_name));

    let request = build_legacy_tool_request(
        tool_name.clone(),
        arguments,
        work_dir.clone(),
        toolCallId,
        approvalToken,
        source,
        executionMode,
        apiKey,
        model,
        baseUrl,
        provider,
        apiFormat,
        providerCapabilities,
    );
    crate::tools::execution_policy::enforce_request_policy(
        &request,
        &args,
        sessionId.as_deref(),
    )
    .map_err(|e| AppError::SecurityError(e.to_string()))?;

    if let Some(browser_call) = parse_browser_chat_tool_call(&tool_name, &args)? {
        let runtime = LiveBrowserChatRuntime { browser_state };
        return Ok(execute_browser_chat_tool_call(browser_call, &runtime).await);
    }

    let result_json = match tool_name.as_str() {
        "get_current_workspace" => {
            serde_json::json!({
                "error": false,
                "message": "get_current_workspace is handled by the frontend. The workspace path is injected into the system prompt automatically."
            })
            .to_string()
        }
        "Skill" => {
            let skill_name = args.get("skill")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'skill' argument for Skill".to_string()))?;
            let skill_args = args.get("args")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            match crate::commands::skill::execute_skill(skill_name.to_string(), skill_args, work_dir.clone()).await {
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
            let resolved_path = resolve_typst_path(file_path, work_dir.as_deref())?;
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
            if let Some(parent) = resolved_path.parent() {
                if !parent.as_os_str().is_empty() {
                    std::fs::create_dir_all(parent).map_err(|e| {
                        AppError::InternalError(format!("Failed to create parent directory: {}", e))
                    })?;
                }
            }
            std::fs::write(&resolved_path, pdf_bytes)
                .map_err(|e| AppError::InternalError(format!("Failed to write PDF: {}", e)))?;
            let resolved_str = resolved_path.to_string_lossy().to_string();
            serde_json::json!({ "file_path": resolved_str, "message": format!("PDF saved to {}", resolved_str) }).to_string()
        }

        "compile_typst_file" => {
            let typ_path = args.get("file_path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'file_path' argument for compile_typst_file".to_string()))?;
            let output_dir = args.get("output_dir")
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::InternalError("Missing 'output_dir' argument for compile_typst_file".to_string()))?;

            let typ_path_buf = resolve_typst_path(typ_path, work_dir.as_deref())?;
            let output_dir_buf = resolve_typst_path(output_dir, work_dir.as_deref())?;
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

        _ => {
            return Err(AppError::SecurityError(format!(
                "Tool '{}' is not supported by legacy execute_tool. {}",
                tool_name, LEGACY_EXECUTE_TOOL_DISABLED_MSG
            )));
        }
    };

    Ok(result_json)
}
