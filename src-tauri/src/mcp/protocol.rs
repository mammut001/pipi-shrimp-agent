use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};

// =============================================================================
// JSON-RPC 2.0 protocol
// =============================================================================

static REQUEST_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

pub fn next_request_id() -> u64 {
    REQUEST_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
}

#[derive(Debug, Serialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: &'static str,
    pub id: u64,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

impl JsonRpcRequest {
    pub fn new(method: impl Into<String>, params: Option<Value>) -> Self {
        Self {
            jsonrpc: "2.0",
            id: next_request_id(),
            method: method.into(),
            params,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct JsonRpcNotification {
    pub jsonrpc: &'static str,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

impl JsonRpcNotification {
    pub fn new(method: impl Into<String>, params: Option<Value>) -> Self {
        Self {
            jsonrpc: "2.0",
            method: method.into(),
            params,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct JsonRpcResponse {
    #[allow(dead_code)]
    pub jsonrpc: String,
    #[allow(dead_code)]
    pub id: Option<u64>,
    pub result: Option<Value>,
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
    #[serde(default)]
    pub data: Option<Value>,
}

impl std::fmt::Display for JsonRpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "JSON-RPC error {}: {}", self.code, self.message)
    }
}

// =============================================================================
// MCP-specific protocol messages
// =============================================================================

#[derive(Debug, Serialize)]
pub struct InitializeParams {
    pub protocol_version: String,
    pub capabilities: ClientCapabilities,
    pub client_info: ClientInfo,
}

#[derive(Debug, Serialize)]
pub struct ClientCapabilities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub roots: Option<RootCapability>,
}

#[derive(Debug, Serialize)]
pub struct RootCapability {
    pub list_changed: bool,
}

#[derive(Debug, Serialize)]
pub struct ClientInfo {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Deserialize)]
pub struct InitializeResult {
    #[allow(dead_code)]
    pub protocol_version: String,
    #[serde(default)]
    #[allow(dead_code)]
    pub capabilities: ServerCapabilities,
    #[serde(default)]
    #[allow(dead_code)]
    pub server_info: Option<ServerInfo>,
}

#[derive(Debug, Default, Deserialize)]
pub struct ServerCapabilities {
    #[serde(default)]
    #[allow(dead_code)]
    pub tools: Option<Value>,
    #[serde(default)]
    #[allow(dead_code)]
    pub resources: Option<Value>,
    #[serde(default)]
    #[allow(dead_code)]
    pub prompts: Option<Value>,
}

#[derive(Debug, Deserialize)]
pub struct ServerInfo {
    #[allow(dead_code)]
    pub name: String,
    #[serde(default)]
    #[allow(dead_code)]
    pub version: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ToolsListResult {
    pub tools: Vec<super::types::MCPTool>,
}

#[derive(Debug, Deserialize)]
pub struct ResourcesListResult {
    pub resources: Vec<super::types::MCPResource>,
}

#[derive(Debug, Serialize)]
pub struct CallToolParams {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub arguments: Option<Value>,
}

#[derive(Debug, Deserialize)]
pub struct CallToolResult {
    pub content: Vec<super::types::ContentBlock>,
    #[serde(default)]
    pub is_error: bool,
}

#[derive(Debug, Serialize)]
pub struct ReadResourceParams {
    pub uri: String,
}
