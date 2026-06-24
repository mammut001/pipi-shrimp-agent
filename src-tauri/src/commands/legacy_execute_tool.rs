use crate::tools::{ToolCallRequest, ToolExecutionSource};
use crate::utils::{AppError, AppResult};

/// User-visible error when callers invoke the deprecated Tauri command for
/// registry-backed tools (R2-01).
pub const LEGACY_EXECUTE_TOOL_DISABLED_MSG: &str =
    "Legacy execute_tool is disabled. Use execute_single_tool or execute_tool_batch.";

/// Tools that still require chat-scoped state (browser controller, font DB)
/// and are intentionally not registered in `ToolRegistry`.
pub fn is_legacy_chat_only_tool(name: &str) -> bool {
    matches!(
        name,
        "Skill"
            | "render_typst_to_svg"
            | "render_typst_to_pdf"
            | "compile_typst_file"
            | "get_current_workspace"
            | "browser_navigate"
            | "browser_get_page"
            | "browser_click"
            | "browser_type"
            | "browser_scroll"
            | "browser_get_text"
            | "browser_screenshot"
            | "browser_extract_content"
            | "browser_press_key"
            | "browser_wait"
    )
}

pub fn build_legacy_tool_request(
    tool_name: String,
    arguments: String,
    work_dir: Option<String>,
    tool_call_id: Option<String>,
    approval_token: Option<String>,
    source: Option<ToolExecutionSource>,
    execution_mode: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
    base_url: Option<String>,
    provider: Option<String>,
    api_format: Option<String>,
    provider_capabilities: Option<crate::claude::provider::ProviderCapabilities>,
) -> ToolCallRequest {
    ToolCallRequest {
        id: tool_call_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
        name: tool_name,
        arguments,
        work_dir,
        source: source.unwrap_or_default(),
        allowed_tools: None,
        api_key,
        model,
        base_url,
        provider,
        api_format,
        provider_capabilities,
        approval_token,
        execution_mode,
    }
}

pub fn reject_legacy_execute_tool(
    tool_name: &str,
    registry_contains_tool: bool,
) -> AppResult<()> {
    if registry_contains_tool {
        return Err(AppError::SecurityError(
            LEGACY_EXECUTE_TOOL_DISABLED_MSG.to_string(),
        ));
    }
    if !is_legacy_chat_only_tool(tool_name) {
        return Err(AppError::SecurityError(format!(
            "Unknown tool '{}'. {}",
            tool_name, LEGACY_EXECUTE_TOOL_DISABLED_MSG
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_execute_tool_rejects_registered_tools() {
        let error = reject_legacy_execute_tool("execute_command", true)
            .expect_err("registry tools must be rejected");
        assert!(error.to_string().contains(LEGACY_EXECUTE_TOOL_DISABLED_MSG));
    }

    #[test]
    fn legacy_execute_tool_rejects_unknown_tools() {
        let error = reject_legacy_execute_tool("totally_unknown_tool", false)
            .expect_err("unknown tools must be rejected");
        assert!(error.to_string().contains("totally_unknown_tool"));
        assert!(error.to_string().contains(LEGACY_EXECUTE_TOOL_DISABLED_MSG));
    }

    #[test]
    fn legacy_execute_tool_allows_browser_and_typst_whitelist() {
        reject_legacy_execute_tool("browser_click", false).expect("browser tools stay on legacy path");
        reject_legacy_execute_tool("compile_typst_file", false).expect("typst tools stay on legacy path");
        reject_legacy_execute_tool("Skill", false).expect("Skill stays on legacy path");
    }

    #[test]
    fn registered_tools_are_not_legacy_chat_only() {
        assert!(!is_legacy_chat_only_tool("write_file"));
        assert!(!is_legacy_chat_only_tool("execute_command"));
        assert!(!is_legacy_chat_only_tool("glob_search"));
    }

    #[test]
    fn legacy_execute_tool_cannot_run_shell_directly() {
        let error = reject_legacy_execute_tool("execute_command", true)
            .expect_err("shell tools must not run through legacy execute_tool");
        assert!(error.to_string().contains(LEGACY_EXECUTE_TOOL_DISABLED_MSG));
    }

    #[test]
    fn legacy_execute_tool_cannot_run_write_file_directly() {
        let error = reject_legacy_execute_tool("write_file", true)
            .expect_err("write_file must not run through legacy execute_tool");
        assert!(error.to_string().contains(LEGACY_EXECUTE_TOOL_DISABLED_MSG));
    }
}