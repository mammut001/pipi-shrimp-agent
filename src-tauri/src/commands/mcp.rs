use crate::mcp::client::SharedMCPManager;
use crate::mcp::config_store::SharedConfigStore;
use crate::mcp::types::*;

/// Tauri state wrapper that holds both the MCP client manager and config store
pub struct MCPState {
    pub manager: SharedMCPManager,
    pub config_store: SharedConfigStore,
}

// ---------- Connection commands ----------

#[tauri::command]
pub async fn mcp_connect_server(
    server_id: String,
    state: tauri::State<'_, MCPState>,
) -> Result<ServerRuntime, String> {
    let server = {
        let store = state.config_store.lock().await;
        store.get(&server_id).map_err(|e| e.to_string())?
    };
    let mut mgr = state.manager.lock().await;
    mgr.connect(server).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mcp_disconnect_server(
    server_id: String,
    state: tauri::State<'_, MCPState>,
) -> Result<(), String> {
    let mut mgr = state.manager.lock().await;
    mgr.disconnect(&server_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mcp_disconnect_all(state: tauri::State<'_, MCPState>) -> Result<(), String> {
    let mut mgr = state.manager.lock().await;
    mgr.disconnect_all().await.map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(dead_code)]
pub async fn mcp_reconnect_server(
    server_id: String,
    state: tauri::State<'_, MCPState>,
) -> Result<ServerRuntime, String> {
    let mut mgr = state.manager.lock().await;
    mgr.reconnect(&server_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mcp_get_server_runtimes(
    state: tauri::State<'_, MCPState>,
) -> Result<Vec<ServerRuntime>, String> {
    let mgr = state.manager.lock().await;
    Ok(mgr.get_runtimes())
}

// ---------- Tool commands ----------

#[tauri::command]
pub async fn mcp_list_tools(
    server_id: String,
    state: tauri::State<'_, MCPState>,
) -> Result<Vec<MCPTool>, String> {
    let mgr = state.manager.lock().await;
    mgr.list_tools(&server_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mcp_list_all_tools(
    state: tauri::State<'_, MCPState>,
) -> Result<Vec<(String, Vec<MCPTool>)>, String> {
    let mgr = state.manager.lock().await;
    Ok(mgr.list_all_tools())
}

/// Sanitize a segment for use in an `mcp__server__tool` agent tool name.
fn sanitize_mcp_name_segment(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

/// Resolve the policy fingerprint name for an MCP call.
/// Prefer the full agent tool name from the frontend when provided so it
/// matches `preview_tool_policy`; otherwise synthesize from server + tool.
fn resolve_mcp_policy_tool_name(
    mcp_tool_name: Option<&str>,
    server_id: &str,
    tool_name: &str,
) -> String {
    if let Some(name) = mcp_tool_name.map(str::trim).filter(|v| !v.is_empty()) {
        return name.to_string();
    }
    format!(
        "mcp__{}__{}",
        sanitize_mcp_name_segment(server_id),
        sanitize_mcp_name_segment(tool_name)
    )
}

/// Enforce execution_policy for an MCP tool call (R2-12).
///
/// Separated so unit tests can exercise the gate without a live MCP manager.
pub(crate) fn enforce_mcp_call_policy(
    policy_tool_name: &str,
    args: &serde_json::Value,
    source: crate::tools::ToolExecutionSource,
    session_id: Option<&str>,
    approval_token: Option<String>,
    execution_mode: Option<String>,
    tool_call_id: Option<&str>,
) -> Result<(), String> {
    let id = tool_call_id
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("mcp-{}", policy_tool_name));
    let req = crate::tools::ToolCallRequest {
        id,
        name: policy_tool_name.to_string(),
        arguments: args.to_string(),
        work_dir: None,
        source,
        allowed_tools: None,
        api_key: None,
        model: None,
        base_url: None,
        provider: None,
        api_format: None,
        provider_capabilities: None,
        approval_token,
        execution_mode,
    };
    crate::tools::execution_policy::enforce_request_policy(&req, args, session_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mcp_call_tool(
    server_id: String,
    tool_name: String,
    args: serde_json::Value,
    #[allow(non_snake_case)] sessionId: Option<String>,
    #[allow(non_snake_case)] approvalToken: Option<String>,
    source: Option<crate::tools::ToolExecutionSource>,
    #[allow(non_snake_case)] executionMode: Option<String>,
    #[allow(non_snake_case)] mcpToolName: Option<String>,
    #[allow(non_snake_case)] toolCallId: Option<String>,
    state: tauri::State<'_, MCPState>,
) -> Result<ToolResult, String> {
    let source_value = source.unwrap_or_default();
    let policy_tool_name =
        resolve_mcp_policy_tool_name(mcpToolName.as_deref(), &server_id, &tool_name);

    enforce_mcp_call_policy(
        &policy_tool_name,
        &args,
        source_value,
        sessionId.as_deref(),
        approvalToken,
        executionMode,
        toolCallId.as_deref(),
    )?;

    let mut mgr = state.manager.lock().await;
    mgr.call_tool(&server_id, &tool_name, args)
        .await
        .map_err(|e| e.to_string())
}

// ---------- Resource commands ----------

#[tauri::command]
pub async fn mcp_list_resources(
    server_id: String,
    state: tauri::State<'_, MCPState>,
) -> Result<Vec<MCPResource>, String> {
    let mgr = state.manager.lock().await;
    mgr.list_resources(&server_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mcp_read_resource(
    server_id: String,
    uri: String,
    state: tauri::State<'_, MCPState>,
) -> Result<String, String> {
    let mut mgr = state.manager.lock().await;
    mgr.read_resource(&server_id, &uri)
        .await
        .map_err(|e| e.to_string())
}

// ---------- Config commands ----------

#[tauri::command]
pub async fn mcp_get_configured_servers(
    state: tauri::State<'_, MCPState>,
) -> Result<Vec<MCPServer>, String> {
    let store = state.config_store.lock().await;
    store.load().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mcp_add_server(
    server: MCPServer,
    state: tauri::State<'_, MCPState>,
) -> Result<MCPServer, String> {
    let store = state.config_store.lock().await;
    store.add(server).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mcp_update_server(
    server: MCPServer,
    state: tauri::State<'_, MCPState>,
) -> Result<MCPServer, String> {
    let store = state.config_store.lock().await;
    store.update(server).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mcp_remove_server(
    server_id: String,
    state: tauri::State<'_, MCPState>,
) -> Result<(), String> {
    // Disconnect first if connected
    {
        let mut mgr = state.manager.lock().await;
        let _ = mgr.disconnect(&server_id).await;
    }
    let store = state.config_store.lock().await;
    store.remove(&server_id).map_err(|e| e.to_string())
}

// ---------- Preset commands ----------

#[tauri::command]
pub async fn mcp_get_preset_templates() -> Result<Vec<PresetTemplate>, String> {
    Ok(get_preset_templates())
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::execution_policy::{
        is_destructive_mcp_tool, preview_request_policy,
    };
    use crate::tools::{ToolCallRequest, ToolExecutionSource};

    fn mcp_request(name: &str, source: ToolExecutionSource) -> ToolCallRequest {
        ToolCallRequest {
            id: "tool-1".to_string(),
            name: name.to_string(),
            arguments: "{}".to_string(),
            work_dir: None,
            source,
            allowed_tools: None,
            api_key: None,
            model: None,
            base_url: None,
            provider: None,
            api_format: None,
            provider_capabilities: None,
            approval_token: None,
            execution_mode: None,
        }
    }

    #[test]
    fn test_destructive_heuristic() {
        assert!(is_destructive_mcp_tool("mcp__server__delete_file"));
        assert!(is_destructive_mcp_tool("remove_item"));
        assert!(is_destructive_mcp_tool("write_note"));
        assert!(is_destructive_mcp_tool("create_issue"));
        assert!(is_destructive_mcp_tool("send_message"));
        assert!(is_destructive_mcp_tool("execute_action"));
        assert!(is_destructive_mcp_tool("run_script"));
        assert!(is_destructive_mcp_tool("drop_table"));
        assert!(!is_destructive_mcp_tool("mcp__server__fetch_data"));
        assert!(!is_destructive_mcp_tool("list_files"));
        assert!(!is_destructive_mcp_tool("read_resource"));
        assert!(!is_destructive_mcp_tool("get_status"));
    }

    #[test]
    fn test_destructive_requires_approval() {
        let err = enforce_mcp_call_policy(
            "mcp__server__delete_file",
            &serde_json::json!({ "path": "/tmp/x" }),
            ToolExecutionSource::AssistantToolCall,
            Some("session-1"),
            None,
            None,
            Some("tool-1"),
        )
        .expect_err("destructive MCP without token must fail");
        assert!(
            err.to_lowercase().contains("approval")
                || err.to_lowercase().contains("confirmation")
                || err.to_lowercase().contains("destructive"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn test_destructive_with_approval_token_allows() {
        let mut request = mcp_request(
            "mcp__server__delete_file",
            ToolExecutionSource::AssistantToolCall,
        );
        let args = serde_json::json!({ "path": "/tmp/x" });
        request.arguments = args.to_string();

        let preview = preview_request_policy(&request, &args, Some("session-1"))
            .expect("preview should succeed");
        assert_eq!(preview.decision, "awaiting_confirmation");
        let token = preview
            .approval_token
            .clone()
            .expect("destructive MCP should mint an approval token");

        enforce_mcp_call_policy(
            "mcp__server__delete_file",
            &args,
            ToolExecutionSource::AssistantToolCall,
            Some("session-1"),
            Some(token),
            None,
            Some("tool-1"),
        )
        .expect("approved destructive MCP call should allow");
    }

    #[test]
    fn test_non_destructive_allows_without_token() {
        enforce_mcp_call_policy(
            "mcp__server__fetch_data",
            &serde_json::json!({ "query": "x" }),
            ToolExecutionSource::AssistantToolCall,
            Some("session-1"),
            None,
            None,
            Some("tool-1"),
        )
        .expect("non-destructive MCP should allow without token");

        enforce_mcp_call_policy(
            "mcp__server__list_files",
            &serde_json::json!({}),
            ToolExecutionSource::UserRequestedCommand,
            None,
            None,
            None,
            None,
        )
        .expect("user-requested non-destructive MCP should allow");
    }

    #[test]
    fn test_unknown_source_rejects() {
        let err = enforce_mcp_call_policy(
            "mcp__server__fetch_data",
            &serde_json::json!({}),
            ToolExecutionSource::Unknown,
            Some("session-1"),
            None,
            None,
            Some("tool-1"),
        )
        .expect_err("Unknown source must reject MCP tools");
        assert!(
            err.to_lowercase().contains("unknown"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn test_resolve_prefers_full_mcp_tool_name() {
        assert_eq!(
            resolve_mcp_policy_tool_name(
                Some("mcp__my_server__delete_file"),
                "server-uuid",
                "delete_file",
            ),
            "mcp__my_server__delete_file"
        );
        assert_eq!(
            resolve_mcp_policy_tool_name(None, "server-uuid", "fetch_data"),
            "mcp__server-uuid__fetch_data"
        );
    }
}
