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
pub async fn mcp_disconnect_all(
    state: tauri::State<'_, MCPState>,
) -> Result<(), String> {
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

#[tauri::command]
pub async fn mcp_call_tool(
    server_id: String,
    tool_name: String,
    args: serde_json::Value,
    state: tauri::State<'_, MCPState>,
) -> Result<ToolResult, String> {
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
