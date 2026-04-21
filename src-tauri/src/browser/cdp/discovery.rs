use super::{run_with_timeout, CdpConfig, CdpError};

pub async fn discover_browser_ws_url(config: &CdpConfig) -> Result<String, CdpError> {
    let version_url = format!(
        "http://127.0.0.1:{}/json/version",
        config.remote_debugging_port
    );

    let response = run_with_timeout("discover_browser_ws_url", config.timeout, reqwest::get(&version_url))
        .await?
        .map_err(|error| CdpError::Discovery(format!(
            "Unable to access Chrome debugging endpoint at {}: {}",
            version_url, error
        )))?;

    let json = run_with_timeout("discover_browser_ws_url.json", config.timeout, response.json::<serde_json::Value>())
        .await?
        .map_err(|error| CdpError::InvalidResponse(format!(
            "Unable to parse Chrome debugging metadata: {}",
            error
        )))?;

    extract_websocket_debugger_url(&json)
}

pub fn extract_websocket_debugger_url(json: &serde_json::Value) -> Result<String, CdpError> {
    json.get("webSocketDebuggerUrl")
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| {
            CdpError::InvalidResponse(
                "Missing or empty 'webSocketDebuggerUrl' in /json/version response".to_string(),
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_websocket_debugger_url() {
        let payload = serde_json::json!({
            "Browser": "Chrome/136.0",
            "webSocketDebuggerUrl": "ws://127.0.0.1:9222/devtools/browser/abc",
        });

        let url = extract_websocket_debugger_url(&payload).expect("should parse websocket url");
        assert_eq!(url, "ws://127.0.0.1:9222/devtools/browser/abc");
    }

    #[test]
    fn test_extract_websocket_debugger_url_rejects_missing_value() {
        let payload = serde_json::json!({ "Browser": "Chrome/136.0" });

        let error = extract_websocket_debugger_url(&payload).expect_err("should reject missing websocket url");
        assert_eq!(
            error,
            CdpError::InvalidResponse(
                "Missing or empty 'webSocketDebuggerUrl' in /json/version response".to_string(),
            )
        );
    }
}