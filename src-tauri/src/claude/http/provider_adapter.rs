pub use super::super::provider::{
    ApiFormat, ProviderCapabilities, ProviderId, ResolvedProviderConfig,
};
pub use super::adapters::{
    get_adapter, get_adapter_for_config, ProviderAdapter, StreamContext, StreamEvent,
};

fn parse_api_format_hint(hint: Option<&str>) -> Option<ApiFormat> {
    match hint {
        Some("anthropic") => Some(ApiFormat::Anthropic),
        Some("openai") => Some(ApiFormat::OpenAI),
        _ => None,
    }
}

fn parse_provider_hint(hint: Option<&str>) -> Option<ProviderId> {
    match hint {
        Some("anthropic") => Some(ProviderId::Anthropic),
        Some("openai") => Some(ProviderId::OpenAI),
        Some("minimax") => Some(ProviderId::MiniMax),
        Some("deepseek") => Some(ProviderId::DeepSeek),
        Some("gemini") => Some(ProviderId::Gemini),
        _ => None,
    }
}

pub fn resolve_api_format(
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
    provider_hint: Option<&str>,
    api_format_hint: Option<&str>,
) -> ApiFormat {
    if let Some(api_format) = parse_api_format_hint(api_format_hint) {
        return api_format;
    }

    if let Some(provider_id) = parse_provider_hint(provider_hint) {
        return ApiFormat::for_provider(provider_id);
    }

    if let Some(provider_id) = parse_provider_hint(api_format_hint) {
        return ApiFormat::for_provider(provider_id);
    }

    ResolvedProviderConfig::resolve(model, api_key, base_url, None).api_format
}

pub fn resolve_provider_config(
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
    provider_hint: Option<&str>,
    api_format_hint: Option<&str>,
    capability_hint: Option<ProviderCapabilities>,
) -> ResolvedProviderConfig {
    let resolved_provider_hint =
        parse_provider_hint(provider_hint).or_else(|| parse_provider_hint(api_format_hint));
    let resolved_api_format_hint = parse_api_format_hint(api_format_hint);

    ResolvedProviderConfig::resolve_with_hints(
        model,
        api_key,
        base_url,
        resolved_provider_hint,
        resolved_api_format_hint,
        capability_hint,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_hint_overrides_auto_detection() {
        assert_eq!(
            resolve_api_format(
                "sk-ant-test",
                "claude-3-7-sonnet",
                Some("https://api.openai.com"),
                Some("anthropic"),
                Some("openai"),
            ),
            ApiFormat::OpenAI,
        );
    }

    #[test]
    fn resolves_provider_config_from_hint() {
        let config = resolve_provider_config(
            "token",
            "custom-model",
            Some("https://example.com/v1"),
            Some("deepseek"),
            Some("openai"),
            None,
        );
        assert_eq!(config.provider_id, ProviderId::DeepSeek);
        assert_eq!(config.api_format, ApiFormat::OpenAI);
    }
}
