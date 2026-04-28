pub mod http;
pub mod stdio;

use crate::mcp::protocol::{JsonRpcNotification, JsonRpcRequest, JsonRpcResponse};
use crate::mcp::types::MCPError;
use async_trait::async_trait;

/// Abstract transport for MCP communication
#[async_trait]
pub trait Transport: Send + Sync {
    /// Connect/initialize the transport
    async fn connect(&mut self) -> Result<(), MCPError>;

    /// Send a JSON-RPC request and wait for a response
    async fn send_request(&mut self, request: &JsonRpcRequest)
        -> Result<JsonRpcResponse, MCPError>;

    /// Send a one-way notification (no response expected)
    async fn send_notification(
        &mut self,
        notification: &JsonRpcNotification,
    ) -> Result<(), MCPError>;

    /// Close the transport connection
    async fn close(&mut self) -> Result<(), MCPError>;
}
