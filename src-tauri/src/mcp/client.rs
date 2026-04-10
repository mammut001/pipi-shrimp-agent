use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use tracing::{error, warn, info, debug};

use crate::mcp::protocol::*;
use crate::mcp::transport::stdio::StdioTransport;
use crate::mcp::transport::http::HttpTransport;
use crate::mcp::transport::Transport;
use crate::mcp::types::*;

/// Reconnection configuration
const MAX_RECONNECT_ATTEMPTS: u32 = 3;
const INITIAL_RETRY_DELAY_MS: u64 = 1000;
const MAX_RETRY_DELAY_MS: u64 = 30000;

/// A single MCP client connection to one server
struct MCPConnection {
    server: MCPServer,
    transport: Box<dyn Transport>,
    status: ServerStatus,
    tools: Vec<MCPTool>,
    resources: Vec<MCPResource>,
    connected_at: Option<u64>,
    error_message: Option<String>,
    /// Number of reconnection attempts made
    reconnect_attempts: u32,
}

impl MCPConnection {
    fn runtime(&self) -> ServerRuntime {
        ServerRuntime {
            id: self.server.id.clone(),
            name: self.server.name.clone(),
            display_name: self.server.display_name.clone().unwrap_or_else(|| self.server.name.clone()),
            status: self.status.clone(),
            tool_count: self.tools.len(),
            resource_count: self.resources.len(),
            error_message: self.error_message.clone(),
            connected_at: self.connected_at,
        }
    }

    /// Build transport from server config
    fn build_transport(config: &ServerConfig) -> Result<Box<dyn Transport>, MCPError> {
        match config {
            ServerConfig::Stdio { command, args, env, cwd } => {
                let t = StdioTransport::new(
                    command.clone(),
                    args.clone(),
                    env.clone(),
                    cwd.clone(),
                );
                Ok(Box::new(t))
            }
            ServerConfig::Http { url, headers, auth } => {
                let mut t = HttpTransport::new(url.clone(), headers.clone());
                if let Some(auth) = auth {
                    t = match auth {
                        AuthConfig::Bearer { token } => t.with_bearer_auth(token.clone()),
                        AuthConfig::ApiKey { key } => t.with_api_key(key.clone()),
                    };
                }
                Ok(Box::new(t))
            }
            ServerConfig::Sse { url, headers, auth } => {
                let mut t = HttpTransport::new(url.clone(), headers.clone());
                if let Some(auth) = auth {
                    t = match auth {
                        AuthConfig::Bearer { token } => t.with_bearer_auth(token.clone()),
                        AuthConfig::ApiKey { key } => t.with_api_key(key.clone()),
                    };
                }
                Ok(Box::new(t))
            }
        }
    }

    /// Initialize the MCP protocol with a transport
    async fn initialize(transport: &mut dyn Transport) -> Result<InitializeResult, MCPError> {
        let init_request = JsonRpcRequest::new(
            "initialize",
            Some(serde_json::to_value(InitializeParams {
                protocol_version: "2024-11-05".into(),
                capabilities: ClientCapabilities {
                    roots: Some(RootCapability { list_changed: false }),
                },
                client_info: ClientInfo {
                    name: "pipi-shrimp-agent".into(),
                    version: env!("CARGO_PKG_VERSION").into(),
                },
            })?),
        );

        let init_response = transport.send_request(&init_request).await?;

        if let Some(err) = init_response.error {
            return Err(MCPError::ProtocolError(err.to_string()));
        }

        let result: InitializeResult = if let Some(result) = init_response.result {
            serde_json::from_value(result)?
        } else {
            return Err(MCPError::ProtocolError("Empty initialize response".into()));
        };

        // Send initialized notification
        let initialized_notification = JsonRpcNotification::new("notifications/initialized", None);
        transport.send_notification(&initialized_notification).await?;

        Ok(result)
    }

    /// Fetch tools from the server
    async fn fetch_tools(transport: &mut dyn Transport) -> (Vec<MCPTool>, Option<String>) {
        let tools_request = JsonRpcRequest::new("tools/list", None);
        match transport.send_request(&tools_request).await {
            Ok(resp) => {
                if let Some(result) = resp.result {
                    if let Ok(tools_result) = serde_json::from_value::<ToolsListResult>(result) {
                        return (tools_result.tools, None);
                    }
                }
                (Vec::new(), Some("Failed to parse tools response".into()))
            }
            Err(e) => (Vec::new(), Some(format!("Failed to list tools: {}", e))),
        }
    }

    /// Fetch resources from the server (may not be supported by all servers)
    async fn fetch_resources(transport: &mut dyn Transport) -> Vec<MCPResource> {
        let resources_request = JsonRpcRequest::new("resources/list", None);
        match transport.send_request(&resources_request).await {
            Ok(resp) => {
                if let Some(result) = resp.result {
                    if let Ok(resources_result) = serde_json::from_value::<ResourcesListResult>(result) {
                        return resources_result.resources;
                    }
                }
            }
            Err(e) => {
                debug!(error = %e, "Server does not support resources or listing failed");
            }
        }
        Vec::new()
    }
}

/// Manages all MCP server connections
pub struct MCPClientManager {
    connections: HashMap<String, MCPConnection>,
}

impl MCPClientManager {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
        }
    }

    /// Connect to a server by its configuration
    pub async fn connect(&mut self, server: MCPServer) -> Result<ServerRuntime, MCPError> {
        let server_id = server.id.clone();

        // Disconnect existing connection if any
        if self.connections.contains_key(&server_id) {
            self.disconnect(&server_id).await?;
        }

        // Build and connect transport
        let mut transport = MCPConnection::build_transport(&server.config)?;
        transport.connect().await.map_err(|e| {
            error!(server_id = %server_id, error = %e, "Failed to connect to MCP server");
            e
        })?;

        // Initialize MCP protocol
        MCPConnection::initialize(&mut *transport).await?;

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        // Fetch tools
        let (tools, tools_error) = MCPConnection::fetch_tools(&mut *transport).await;

        // Fetch resources
        let resources = MCPConnection::fetch_resources(&mut *transport).await;

        let conn = MCPConnection {
            server,
            transport,
            status: ServerStatus::Connected,
            tools,
            resources,
            connected_at: Some(now),
            error_message: tools_error,
            reconnect_attempts: 0,
        };

        if conn.error_message.is_some() {
            warn!(server_id = %server_id, error = %conn.error_message.as_ref().unwrap(), "Connected but failed to list tools");
        }

        let runtime = conn.runtime();
        self.connections.insert(server_id, conn);
        Ok(runtime)
    }

    /// Reconnect to a server with exponential backoff
    pub async fn reconnect(&mut self, server_id: &str) -> Result<ServerRuntime, MCPError> {
        let server = {
            let conn = self.connections.get(server_id)
                .ok_or_else(|| MCPError::ServerNotFound(server_id.into()))?;
            conn.server.clone()
        };

        let mut conn = self.connections.remove(server_id)
            .ok_or_else(|| MCPError::ServerNotFound(server_id.into()))?;

        let mut attempt = conn.reconnect_attempts;
        let mut delay_ms = INITIAL_RETRY_DELAY_MS;

        loop {
            info!(server_id = %server_id, attempt = attempt + 1, "Attempting to reconnect to MCP server");

            // Build new transport
            match MCPConnection::build_transport(&server.config) {
                Ok(mut transport) => {
                    match transport.connect().await {
                        Ok(()) => {
                            match MCPConnection::initialize(&mut *transport).await {
                                Ok(_) => {
                                    let (tools, tools_error) = MCPConnection::fetch_tools(&mut *transport).await;
                                    let resources = MCPConnection::fetch_resources(&mut *transport).await;

                                    let now = std::time::SystemTime::now()
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .unwrap_or_default()
                                        .as_secs();

                                    conn = MCPConnection {
                                        server,
                                        transport,
                                        status: ServerStatus::Connected,
                                        tools,
                                        resources,
                                        connected_at: Some(now),
                                        error_message: tools_error,
                                        reconnect_attempts: 0,
                                    };

                                    let runtime = conn.runtime();
                                    self.connections.insert(server_id.to_string(), conn);
                                    info!(server_id = %server_id, "Successfully reconnected to MCP server");
                                    return Ok(runtime);
                                }
                                Err(e) => {
                                    warn!(server_id = %server_id, error = %e, "Reinitialize failed, will retry");
                                    let _ = transport.close().await;
                                }
                            }
                        }
                        Err(e) => {
                            warn!(server_id = %server_id, error = %e, "Transport connection failed, will retry");
                        }
                    }
                }
                Err(e) => {
                    error!(server_id = %server_id, error = %e, "Failed to build transport");
                    return Err(e);
                }
            }

            attempt += 1;
            if attempt >= MAX_RECONNECT_ATTEMPTS {
                conn.status = ServerStatus::Error;
                conn.error_message = Some(format!("Max reconnection attempts ({}) exhausted", MAX_RECONNECT_ATTEMPTS));
                error!(server_id = %server_id, attempts = attempt, "Max reconnection attempts exhausted");
                self.connections.insert(server_id.to_string(), conn);
                return Err(MCPError::ConnectionFailed(format!(
                    "Failed to reconnect after {} attempts: last error",
                    MAX_RECONNECT_ATTEMPTS
                )));
            }

            // Exponential backoff with jitter
            let delay = Duration::from_millis(delay_ms);
            tokio::time::sleep(delay).await;
            delay_ms = (delay_ms * 2).min(MAX_RETRY_DELAY_MS);
        }
    }

    /// Disconnect a server
    pub async fn disconnect(&mut self, server_id: &str) -> Result<(), MCPError> {
        if let Some(mut conn) = self.connections.remove(server_id) {
            conn.transport.close().await?;
        }
        Ok(())
    }

    /// Disconnect all servers
    pub async fn disconnect_all(&mut self) -> Result<(), MCPError> {
        let ids: Vec<String> = self.connections.keys().cloned().collect();
        for id in ids {
            self.disconnect(&id).await?;
        }
        Ok(())
    }

    /// Get runtime info for all connections
    pub fn get_runtimes(&self) -> Vec<ServerRuntime> {
        self.connections.values().map(|c| c.runtime()).collect()
    }

    /// Get runtime info for a specific connection
    #[allow(dead_code)]
    pub fn get_runtime(&self, server_id: &str) -> Option<ServerRuntime> {
        self.connections.get(server_id).map(|c| c.runtime())
    }

    /// List tools for a specific server
    pub fn list_tools(&self, server_id: &str) -> Result<Vec<MCPTool>, MCPError> {
        let conn = self.connections.get(server_id).ok_or_else(|| {
            MCPError::ServerNotFound(server_id.into())
        })?;
        Ok(conn.tools.clone())
    }

    /// List all tools across all connected servers
    pub fn list_all_tools(&self) -> Vec<(String, Vec<MCPTool>)> {
        self.connections
            .iter()
            .filter(|(_, c)| c.status == ServerStatus::Connected)
            .map(|(id, c)| (id.clone(), c.tools.clone()))
            .collect()
    }

    /// List resources for a specific server
    pub fn list_resources(&self, server_id: &str) -> Result<Vec<MCPResource>, MCPError> {
        let conn = self.connections.get(server_id).ok_or_else(|| {
            MCPError::ServerNotFound(server_id.into())
        })?;
        Ok(conn.resources.clone())
    }

    /// Call a tool on a specific server
    pub async fn call_tool(
        &mut self,
        server_id: &str,
        tool_name: &str,
        args: serde_json::Value,
    ) -> Result<ToolResult, MCPError> {
        let conn = self.connections.get_mut(server_id).ok_or_else(|| {
            MCPError::ServerNotFound(server_id.into())
        })?;

        if conn.status != ServerStatus::Connected {
            return Err(MCPError::ConnectionFailed(format!(
                "Server '{}' is not connected",
                server_id
            )));
        }

        let request = JsonRpcRequest::new(
            "tools/call",
            Some(serde_json::to_value(CallToolParams {
                name: tool_name.into(),
                arguments: if args.is_null() { None } else { Some(args.clone()) },
            })?),
        );

        let response = match conn.transport.send_request(&request).await {
            Ok(r) => r,
            Err(e) => {
                warn!(server_id = %server_id, error = %e, "Tool call failed, attempting reconnection");
                // Mark as disconnected and attempt reconnect
                conn.status = ServerStatus::Error;
                let _ = conn;

                // Try to reconnect
                match self.reconnect(server_id).await {
                    Ok(_) => {
                        // Retry the tool call
                        let conn = self.connections.get_mut(server_id).ok_or_else(|| {
                            MCPError::ServerNotFound(server_id.into())
                        })?;
                        let request = JsonRpcRequest::new(
                            "tools/call",
                            Some(serde_json::to_value(CallToolParams {
                                name: tool_name.into(),
                                arguments: if args.is_null() { None } else { Some(args.clone()) },
                            })?),
                        );
                        conn.transport.send_request(&request).await?
                    }
                    Err(_) => return Err(e),
                }
            }
        };

        if let Some(err) = response.error {
            return Err(MCPError::ToolExecutionFailed(err.to_string()));
        }

        let result: CallToolResult = if let Some(result) = response.result {
            serde_json::from_value(result)?
        } else {
            return Err(MCPError::ProtocolError("Empty tool call response".into()));
        };

        Ok(ToolResult {
            content: result.content,
            is_error: result.is_error,
        })
    }

    /// Read a resource from a specific server
    pub async fn read_resource(
        &mut self,
        server_id: &str,
        uri: &str,
    ) -> Result<String, MCPError> {
        let conn = self.connections.get_mut(server_id).ok_or_else(|| {
            MCPError::ServerNotFound(server_id.into())
        })?;

        let request = JsonRpcRequest::new(
            "resources/read",
            Some(serde_json::to_value(ReadResourceParams {
                uri: uri.into(),
            })?),
        );

        let response = conn.transport.send_request(&request).await?;

        if let Some(err) = response.error {
            return Err(MCPError::ToolExecutionFailed(err.to_string()));
        }

        if let Some(result) = response.result {
            // Extract text content from the resource
            if let Some(contents) = result.get("contents").and_then(|c| c.as_array()) {
                let texts: Vec<String> = contents
                    .iter()
                    .filter_map(|c| c.get("text").and_then(|t| t.as_str()))
                    .map(String::from)
                    .collect();
                return Ok(texts.join("\n"));
            }
        }

        Ok(String::new())
    }
}

/// Thread-safe wrapper for MCPClientManager
pub type SharedMCPManager = Arc<Mutex<MCPClientManager>>;

pub fn new_shared_manager() -> SharedMCPManager {
    Arc::new(Mutex::new(MCPClientManager::new()))
}
