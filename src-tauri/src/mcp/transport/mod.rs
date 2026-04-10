pub mod stdio;
pub mod http;

use async_trait::async_trait;
use crate::mcp::protocol::{JsonRpcRequest, JsonRpcNotification, JsonRpcResponse};
use crate::mcp::types::MCPError;

/// Abstract transport for MCP communication
#[async_trait]
pub trait Transport: Send + Sync {
    /// Connect/initialize the transport
    async fn connect(&mut self) -> Result<(), MCPError>;

    /// Send a JSON-RPC request and wait for a response
    async fn send_request(&mut self, request: &JsonRpcRequest) -> Result<JsonRpcResponse, MCPError>;

    /// Send a one-way notification (no response expected)
    async fn send_notification(&mut self, notification: &JsonRpcNotification) -> Result<(), MCPError>;

    /// Close the transport connection
    async fn close(&mut self) -> Result<(), MCPError>;
}
