#![allow(dead_code)]
/**
 * Provider Resolver
 *
 * Centralized provider capability resolution.
 * Replaces scattered string-based provider checks with explicit capability lookup.
 *
 * Design goals:
 * - Provider-agnostic request handling
 * - Explicit apiFormat (anthropic vs openai)
 * - Capability-based routing
 * - Consistent baseURL resolution
 */

use serde::{Deserialize, Serialize};

/// Provider identifier
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderId {
    Anthropic,
    OpenAI,
    MiniMax,
    Gemini,
    /// For custom providers that use OpenAI-compatible format
    Custom,
}

impl ProviderId {
    /// Detect provider from base URL or model name
    pub fn detect(base_url: Option<&str>, model: &str, api_key: &str) -> Self {
        // If api_key looks like Anthropic key, use Anthropic
        if api_key.starts_with("sk-ant-") {
            return ProviderId::Anthropic;
        }

        // Detect from base URL
        if let Some(url) = base_url {
            let url_lower = url.to_lowercase();
            if url_lower.contains("anthropic") {
                return ProviderId::Anthropic;
            }
            if url_lower.contains("minimax") || url_lower.contains("api.minimaxi") {
                return ProviderId::MiniMax;
            }
            if url_lower.contains("openai") || url_lower.contains("api.openai") {
                return ProviderId::OpenAI;
            }
            if url_lower.contains("gemini") {
                return ProviderId::Gemini;
            }
            // Any other URL is Custom (OpenAI-compatible)
            return ProviderId::Custom;
        }

        // Detect from model name
        let model_lower = model.to_lowercase();
        if model_lower.contains("claude") {
            return ProviderId::Anthropic;
        }
        if model_lower.contains("gpt") || model_lower.contains("o1") || model_lower.contains("o3") {
            return ProviderId::OpenAI;
        }
        if model_lower.contains("gemini") {
            return ProviderId::Gemini;
        }
        if model_lower.contains("minimax") || model_lower.contains("abab") {
            return ProviderId::MiniMax;
        }

        // Default to Anthropic (most common for this codebase)
        ProviderId::Anthropic
    }
}

/// API format for request serialization
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ApiFormat {
    Anthropic,
    OpenAI,
}

impl ApiFormat {
    /// Get the default API format for a provider
    pub fn for_provider(provider: ProviderId) -> Self {
        match provider {
            ProviderId::Anthropic => ApiFormat::Anthropic,
            ProviderId::OpenAI | ProviderId::MiniMax | ProviderId::Gemini | ProviderId::Custom => ApiFormat::OpenAI,
        }
    }
}

/// Provider capabilities
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderCapabilities {
    /// Model supports extended thinking/reasoning
    pub supports_thinking: bool,
    /// Model supports tool calls
    pub supports_tool_calls: bool,
    /// Provider supports streaming (SSE)
    pub supports_streaming: bool,
    /// Provider uses OpenAI Responses API (instead of Chat Completions)
    pub uses_responses_api: bool,
    /// Tool results must be ordered to match tool_calls
    pub requires_tool_ordering: bool,
    /// Maximum thinking budget (if supports_thinking)
    pub thinking_budget: Option<i32>,
}

impl Default for ProviderCapabilities {
    fn default() -> Self {
        Self {
            supports_thinking: false,
            supports_tool_calls: true,
            supports_streaming: true,
            uses_responses_api: false,
            requires_tool_ordering: false,
            thinking_budget: None,
        }
    }
}

/// Resolved provider configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedProviderConfig {
    /// Resolved provider ID
    pub provider_id: ProviderId,
    /// API format to use
    pub api_format: ApiFormat,
    /// Full base URL for the endpoint
    pub base_url: String,
    /// API key (resolved)
    pub api_key: String,
    /// Model name
    pub model: String,
    /// Provider capabilities
    pub capabilities: ProviderCapabilities,
}

impl ResolvedProviderConfig {
    /// Resolve provider configuration from raw parameters
    pub fn resolve(
        model: &str,
        api_key: &str,
        base_url: Option<&str>,
        provider_hint: Option<ProviderId>,
    ) -> Self {
        // Detect or use hinted provider
        let provider_id = provider_hint
            .unwrap_or_else(|| ProviderId::detect(base_url, model, api_key));

        // Determine API format
        let api_format = ApiFormat::for_provider(provider_id);

        // Resolve base URL based on provider
        let base_url = Self::resolve_base_url(provider_id, base_url);

        // Resolve capabilities
        let capabilities = Self::resolve_capabilities(provider_id, model);

        Self {
            provider_id,
            api_format,
            base_url,
            api_key: api_key.to_string(),
            model: model.to_string(),
            capabilities,
        }
    }

    /// Resolve base URL for the provider
    fn resolve_base_url(provider_id: ProviderId, provided_url: Option<&str>) -> String {
        if let Some(url) = provided_url {
            return url.trim_end_matches('/').to_string();
        }

        match provider_id {
            ProviderId::Anthropic => "https://api.anthropic.com".to_string(),
            ProviderId::OpenAI => "https://api.openai.com".to_string(),
            ProviderId::MiniMax => "https://api.minimaxi.com/v1".to_string(),
            ProviderId::Gemini => "https://generativelanguage.googleapis.com".to_string(),
            ProviderId::Custom => "https://api.openai.com/v1".to_string(),
        }
    }

    /// Resolve capabilities based on provider and model
    fn resolve_capabilities(provider_id: ProviderId, model: &str) -> ProviderCapabilities {
        let model_lower = model.to_lowercase();

        match provider_id {
            ProviderId::Anthropic => {
                // Anthropic models: check for thinking support
                let supports_thinking = model_lower.contains("claude-3-7")
                    || model_lower.contains("claude-opus-4")
                    || model_lower.contains("claude-sonnet-4")
                    || model_lower.contains("claude-haiku-4");

                ProviderCapabilities {
                    supports_thinking,
                    supports_tool_calls: true,
                    supports_streaming: true,
                    uses_responses_api: false,
                    requires_tool_ordering: false,
                    thinking_budget: if supports_thinking { Some(5000) } else { None },
                }
            }
            ProviderId::OpenAI => {
                // OpenAI models: tool calls supported on most models
                let supports_tool_calls = !model_lower.contains("o1-preview")
                    && !model_lower.contains("o1-mini");

                ProviderCapabilities {
                    supports_thinking: false, // OpenAI reasoning is separate
                    supports_tool_calls,
                    supports_streaming: true,
                    uses_responses_api: false,
                    requires_tool_ordering: false,
                    thinking_budget: None,
                }
            }
            ProviderId::MiniMax => {
                // MiniMax: typically OpenAI-compatible
                ProviderCapabilities {
                    supports_thinking: model_lower.contains("reasoning"),
                    supports_tool_calls: true,
                    supports_streaming: true,
                    uses_responses_api: false,
                    requires_tool_ordering: false,
                    thinking_budget: None,
                }
            }
            ProviderId::Gemini => {
                // Gemini: different API structure
                ProviderCapabilities {
                    supports_thinking: false,
                    supports_tool_calls: true,
                    supports_streaming: true,
                    uses_responses_api: true, // Gemini uses different API
                    requires_tool_ordering: false,
                    thinking_budget: None,
                }
            }
            ProviderId::Custom => {
                // Custom provider: assume OpenAI-compatible
                ProviderCapabilities {
                    supports_thinking: model_lower.contains("reasoning"),
                    supports_tool_calls: true,
                    supports_streaming: true,
                    uses_responses_api: false,
                    requires_tool_ordering: false,
                    thinking_budget: None,
                }
            }
        }
    }

    /// Get the endpoint path for the resolved format
    pub fn endpoint_path(&self) -> &'static str {
        match self.api_format {
            ApiFormat::Anthropic => "/v1/messages",
            ApiFormat::OpenAI => "/chat/completions",
        }
    }
}

/// Check if a model supports extended thinking
pub fn supports_thinking(model: &str) -> bool {
    let model_lower = model.to_lowercase();
    model_lower.contains("claude-3-7")
        || model_lower.contains("claude-opus-4")
        || model_lower.contains("claude-sonnet-4")
        || model_lower.contains("claude-haiku-4")
}

/// Get default thinking budget for models that support it
pub fn thinking_budget(model: &str) -> Option<i32> {
    if supports_thinking(model) {
        Some(5000)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_anthropic_key() {
        let provider = ProviderId::detect(None, "claude-3-5-sonnet", "sk-ant-api03...");
        assert_eq!(provider, ProviderId::Anthropic);
    }

    #[test]
    fn test_detect_anthropic_url() {
        let provider = ProviderId::detect(Some("https://api.anthropic.com"), "gpt-4", "sk-...");
        assert_eq!(provider, ProviderId::Anthropic);
    }

    #[test]
    fn test_detect_minimax_url() {
        let provider = ProviderId::detect(Some("https://api.minimaxi.com/v1"), "abab6", "...");
        assert_eq!(provider, ProviderId::MiniMax);
    }

    #[test]
    fn test_detect_custom_url() {
        let provider = ProviderId::detect(Some("https://custom.ai/v1"), "custom-model", "sk-...");
        assert_eq!(provider, ProviderId::Custom);
    }

    #[test]
    fn test_resolve_anthropic_default() {
        let config = ResolvedProviderConfig::resolve(
            "claude-3-5-sonnet-20241022",
            "sk-ant-...",
            None,
            None,
        );

        assert_eq!(config.provider_id, ProviderId::Anthropic);
        assert_eq!(config.api_format, ApiFormat::Anthropic);
        assert!(config.capabilities.supports_tool_calls);
        assert!(!config.capabilities.supports_thinking);
    }

    #[test]
    fn test_resolve_anthropic_thinking_model() {
        let config = ResolvedProviderConfig::resolve(
            "claude-3-7-sonnet-20250219",
            "sk-ant-...",
            None,
            None,
        );

        assert_eq!(config.provider_id, ProviderId::Anthropic);
        assert!(config.capabilities.supports_thinking);
        assert_eq!(config.capabilities.thinking_budget, Some(5000));
    }

    #[test]
    fn test_resolve_openai() {
        let config = ResolvedProviderConfig::resolve(
            "gpt-4o",
            "sk-...",
            None,
            None,
        );

        assert_eq!(config.provider_id, ProviderId::OpenAI);
        assert_eq!(config.api_format, ApiFormat::OpenAI);
        assert!(config.capabilities.supports_tool_calls);
    }

    #[test]
    fn test_resolve_custom_provider() {
        let config = ResolvedProviderConfig::resolve(
            "custom-model",
            "sk-...",
            Some("https://custom.ai/v1"),
            None,
        );

        assert_eq!(config.provider_id, ProviderId::Custom);
        assert_eq!(config.api_format, ApiFormat::OpenAI);
        assert_eq!(config.base_url, "https://custom.ai/v1");
    }

    #[test]
    fn test_supports_thinking() {
        assert!(super::supports_thinking("claude-3-7-sonnet-20250219"));
        assert!(super::supports_thinking("claude-opus-4-5-20250501"));
        assert!(!super::supports_thinking("claude-3-5-sonnet-20241022"));
        assert!(!super::supports_thinking("gpt-4o"));
    }
}