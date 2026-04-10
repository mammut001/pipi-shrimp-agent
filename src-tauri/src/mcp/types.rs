use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// =============================================================================
// Transport configuration
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "transport", rename_all = "snake_case")]
pub enum ServerConfig {
    Stdio {
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        env: HashMap<String, String>,
        #[serde(default)]
        cwd: Option<String>,
    },
    Http {
        url: String,
        #[serde(default)]
        headers: HashMap<String, String>,
        #[serde(default)]
        auth: Option<AuthConfig>,
    },
    Sse {
        url: String,
        #[serde(default)]
        headers: HashMap<String, String>,
        #[serde(default)]
        auth: Option<AuthConfig>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AuthConfig {
    Bearer { token: String },
    ApiKey { key: String },
}

// =============================================================================
// Server definition (persisted config)
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MCPServer {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    pub config: ServerConfig,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    /// Tool whitelist — empty means allow all
    #[serde(default)]
    pub tools: Vec<String>,
}

fn default_enabled() -> bool {
    true
}

// =============================================================================
// Runtime state
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ServerStatus {
    Disconnected,
    Connecting,
    Connected,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerRuntime {
    pub id: String,
    pub name: String,
    pub display_name: String,
    pub status: ServerStatus,
    pub tool_count: usize,
    pub resource_count: usize,
    #[serde(default)]
    pub error_message: Option<String>,
    #[serde(default)]
    pub connected_at: Option<u64>,
}

// =============================================================================
// MCP Protocol types
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MCPTool {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default = "default_schema")]
    pub input_schema: serde_json::Value,
}

fn default_schema() -> serde_json::Value {
    serde_json::json!({})
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MCPResource {
    pub uri: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub mime_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentBlock {
    Text { text: String },
    Image { data: String, mime_type: String },
    Resource { uri: String, text: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    pub content: Vec<ContentBlock>,
    #[serde(default)]
    pub is_error: bool,
}

// =============================================================================
// Error type
// =============================================================================

#[derive(Debug, thiserror::Error)]
pub enum MCPError {
    #[error("Connection failed: {0}")]
    ConnectionFailed(String),

    #[error("Transport error: {0}")]
    TransportError(String),

    #[error("Protocol error: {0}")]
    ProtocolError(String),

    #[error("Tool not found: {0}")]
    ToolNotFound(String),

    #[error("Tool execution failed: {0}")]
    ToolExecutionFailed(String),

    #[error("Timeout")]
    Timeout,

    #[error("Server not found: {0}")]
    ServerNotFound(String),

    #[error("Config error: {0}")]
    ConfigError(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

impl From<MCPError> for String {
    fn from(e: MCPError) -> Self {
        e.to_string()
    }
}

// =============================================================================
// Preset server templates
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresetTemplate {
    pub id: String,
    pub name: String,
    pub display_name: String,
    pub description: String,
    pub icon: String,
    pub config: ServerConfig,
}

pub fn get_preset_templates() -> Vec<PresetTemplate> {
    vec![
        PresetTemplate {
            id: "excalidraw".into(),
            name: "excalidraw".into(),
            display_name: "Excalidraw".into(),
            description: "Whiteboard collaboration tool (set EXCALIDRAW_API_KEY env var)".into(),
            icon: "📊".into(),
            config: ServerConfig::Stdio {
                command: "npx".into(),
                args: vec!["-y".into(), "@excalidraw/mcp-server".into()],
                env: HashMap::from([("EXCALIDRAW_API_KEY".into(), "".into())]),
                cwd: None,
            },
        },
        PresetTemplate {
            id: "filesystem".into(),
            name: "filesystem".into(),
            display_name: "Filesystem".into(),
            description: "Local filesystem access (stdio transport)".into(),
            icon: "📂".into(),
            config: ServerConfig::Stdio {
                command: "npx".into(),
                args: vec![
                    "-y".into(),
                    "@modelcontextprotocol/server-filesystem".into(),
                ],
                env: HashMap::new(),
                cwd: None,
            },
        },
    ]
}
