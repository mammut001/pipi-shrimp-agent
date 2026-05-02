pub use super::super::adapter::{
    get_adapter, get_adapter_for_config, AnthropicAdapter, OpenAIAdapter, ProviderAdapter,
    StreamContext, StreamEvent,
};
pub use super::super::provider::{ApiFormat, ProviderCapabilities, ProviderId, ResolvedProviderConfig};

pub fn resolve_api_format(
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
    hint: Option<&str>,
) -> ApiFormat {
    if let Some(hint) = hint {
        match hint {
            "anthropic" => return ApiFormat::Anthropic,
            "openai" => return ApiFormat::OpenAI,
            _ => {}
        }
    }

    ResolvedProviderConfig::resolve(model, api_key, base_url, None).api_format
}

pub fn resolve_provider_config(
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
    hint: Option<&str>,
) -> ResolvedProviderConfig {
    let provider_hint = match hint {
        Some("anthropic") => Some(ProviderId::Anthropic),
        Some("openai") => Some(ProviderId::OpenAI),
        Some("minimax") => Some(ProviderId::MiniMax),
        Some("deepseek") => Some(ProviderId::DeepSeek),
        Some("gemini") => Some(ProviderId::Gemini),
        _ => None,
    };

    ResolvedProviderConfig::resolve(model, api_key, base_url, provider_hint)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_hint_overrides_auto_detection() {
        assert_eq!(
            resolve_api_format("sk-ant-test", "claude-3-7-sonnet", Some("https://api.openai.com"), Some("openai")),
            ApiFormat::OpenAI,
        );
    }

    #[test]
    fn resolves_provider_config_from_hint() {
        let config = resolve_provider_config("token", "custom-model", Some("https://example.com/v1"), Some("deepseek"));
        assert_eq!(config.provider_id, ProviderId::DeepSeek);
        assert_eq!(config.api_format, ApiFormat::OpenAI);
    }
}
