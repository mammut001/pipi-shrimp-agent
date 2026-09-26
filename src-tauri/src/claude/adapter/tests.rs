use super::*;

#[test]
fn test_anthropic_adapter_provider_id() {
    let adapter = AnthropicAdapter::new();
    assert_eq!(adapter.provider_id(), ProviderId::Anthropic);
    assert_eq!(adapter.api_format(), ApiFormat::Anthropic);
}

#[test]
fn test_openai_adapter_provider_id() {
    let adapter = OpenAIAdapter::openai();
    assert_eq!(adapter.provider_id(), ProviderId::OpenAI);
    assert_eq!(adapter.api_format(), ApiFormat::OpenAI);
}

#[test]
fn test_minimax_adapter_provider_id() {
    let adapter = OpenAIAdapter::minimax();
    assert_eq!(adapter.provider_id(), ProviderId::MiniMax);
    assert_eq!(adapter.api_format(), ApiFormat::OpenAI);
}

#[test]
fn test_get_adapter() {
    let adapter = get_adapter(ProviderId::Anthropic);
    assert_eq!(adapter.provider_id(), ProviderId::Anthropic);

    let adapter = get_adapter(ProviderId::MiniMax);
    assert_eq!(adapter.provider_id(), ProviderId::MiniMax);
}
