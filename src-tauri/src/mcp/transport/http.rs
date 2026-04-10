use async_trait::async_trait;
use std::collections::HashMap;
use tracing::warn;

use crate::mcp::protocol::{JsonRpcRequest, JsonRpcNotification, JsonRpcResponse};
use crate::mcp::types::MCPError;
use super::Transport;

/// HTTP transport — sends JSON-RPC requests over HTTP POST.
///
/// Used for both plain HTTP servers and as a fallback for SSE servers.
/// For SSE servers, this implements the client→server leg via HTTP POST.
/// Server→client events (via EventSource) are not yet supported.
///
/// NOTE: Many MCP servers (including GitHub's) use SSE for server-initiated
/// notifications (e.g., tools/list_changed). This transport will not
/// receive those events. For full SSE support, a separate EventSource
/// reader would need to be implemented.
pub struct HttpTransport {
    url: String,
    headers: HashMap<String, String>,
    client: reqwest::Client,
}

impl HttpTransport {
    pub fn new(url: String, headers: HashMap<String, String>) -> Self {
        Self {
            url,
            headers,
            client: reqwest::Client::new(),
        }
    }

    pub fn with_bearer_auth(mut self, token: String) -> Self {
        self.headers
            .insert("Authorization".into(), format!("Bearer {}", token));
        self
    }

    pub fn with_api_key(mut self, key: String) -> Self {
        self.headers.insert("X-API-Key".into(), key);
        self
    }
}

#[async_trait]
impl Transport for HttpTransport {
    async fn connect(&mut self) -> Result<(), MCPError> {
        // HTTP is stateless — nothing to connect
        Ok(())
    }

    async fn send_request(&mut self, request: &JsonRpcRequest) -> Result<JsonRpcResponse, MCPError> {
        let mut req = self.client.post(&self.url);

        for (k, v) in &self.headers {
            req = req.header(k.as_str(), v.as_str());
        }

        req = req
            .header("Content-Type", "application/json")
            .json(request);

        let response = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            req.send(),
        )
        .await
        .map_err(|_| MCPError::Timeout)?
        .map_err(|e| MCPError::TransportError(format!("HTTP request failed: {}", e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(MCPError::TransportError(format!(
                "HTTP {} — {}",
                status, body
            )));
        }

        let text = response
            .text()
            .await
            .map_err(|e| MCPError::TransportError(format!("Failed to read response body: {}", e)))?;

        let rpc_response: JsonRpcResponse = serde_json::from_str(&text)?;
        Ok(rpc_response)
    }

    async fn send_notification(&mut self, notification: &JsonRpcNotification) -> Result<(), MCPError> {
        let mut req = self.client.post(&self.url);

        for (k, v) in &self.headers {
            req = req.header(k.as_str(), v.as_str());
        }

        req = req
            .header("Content-Type", "application/json")
            .json(notification);

        let _ = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            req.send(),
        )
        .await
        .map_err(|_| MCPError::Timeout)?
        .map_err(|e| {
            warn!(error = %e, "HTTP notification failed");
            MCPError::TransportError(format!("HTTP notification failed: {}", e))
        })?;

        Ok(())
    }

    async fn close(&mut self) -> Result<(), MCPError> {
        // HTTP is stateless — nothing to close
        Ok(())
    }
}
