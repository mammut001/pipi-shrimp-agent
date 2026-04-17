/// Provider registry — mirrors the TypeScript registry but for Rust.
///
/// Each entry describes a provider's endpoint style, default base URL,
/// and fallback model list. `fetch_available_models` routes through
/// the adapters in `adapters.rs` using this information.

#[derive(Debug, Clone, PartialEq)]
pub enum EndpointStyle {
    OpenAI,
    Anthropic,
}

#[derive(Debug, Clone)]
pub struct ProviderEntry {
    /// Provider identifier (matches TypeScript ProviderName)
    pub id: &'static str,
    /// Which API endpoint style to use when fetching models
    pub endpoint_style: EndpointStyle,
    /// Default base URL; empty string means caller must supply one
    pub default_base_url: &'static str,
    /// Static fallback models returned when the fetch endpoint is unavailable
    pub fallback_models: &'static [&'static str],
}

pub const PROVIDERS: &[ProviderEntry] = &[
    ProviderEntry {
        id: "anthropic",
        endpoint_style: EndpointStyle::Anthropic,
        default_base_url: "https://api.anthropic.com/v1",
        fallback_models: &[
            "claude-sonnet-4-5",
            "claude-sonnet-4-latest",
            "claude-3-5-sonnet-latest",
            "claude-3-5-haiku-latest",
            "claude-3-5-sonnet-20241022",
            "claude-3-5-haiku-20241022",
            "claude-3-opus-20240229",
            "claude-3-haiku-20240307",
        ],
    },
    ProviderEntry {
        id: "anthropic-compatible",
        endpoint_style: EndpointStyle::Anthropic,
        default_base_url: "",  // must be supplied by user
        fallback_models: &[],
    },
    ProviderEntry {
        id: "openai",
        endpoint_style: EndpointStyle::OpenAI,
        default_base_url: "https://api.openai.com/v1",
        fallback_models: &[
            "gpt-4.1",
            "gpt-4.1-mini",
            "gpt-4o",
            "gpt-4o-mini",
            "o3",
            "o4-mini",
        ],
    },
    ProviderEntry {
        id: "openai-compatible",
        endpoint_style: EndpointStyle::OpenAI,
        default_base_url: "",  // must be supplied by user
        fallback_models: &[],
    },
    ProviderEntry {
        id: "deepseek",
        endpoint_style: EndpointStyle::OpenAI,
        default_base_url: "https://api.deepseek.com/v1",
        fallback_models: &["deepseek-chat", "deepseek-reasoner"],
    },
    ProviderEntry {
        id: "minimax",
        endpoint_style: EndpointStyle::OpenAI,
        default_base_url: "https://api.minimaxi.com/v1",
        fallback_models: &[
            "MiniMax-M2.5",
            "MiniMax-M2.5-highspeed",
            "MiniMax-M2.1",
            "MiniMax-M2.1-highspeed",
            "MiniMax-M2",
        ],
    },
    // Legacy alias — treated identically to openai-compatible
    ProviderEntry {
        id: "custom",
        endpoint_style: EndpointStyle::OpenAI,
        default_base_url: "",
        fallback_models: &[],
    },
];

/// Look up a provider entry by ID.
pub fn find_provider(id: &str) -> Option<&'static ProviderEntry> {
    PROVIDERS.iter().find(|p| p.id == id)
}
