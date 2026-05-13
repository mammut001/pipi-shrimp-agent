pub mod adapters;
pub mod error_mapping;
pub mod provider_adapter;
pub mod request_builder;
pub mod retry;
pub mod stream;
pub mod telemetry;
pub mod executor;
pub mod tool_catalog;

#[allow(unused_imports)]
pub use error_mapping::{map_http_status, sanitize_provider_message, ClaudeHttpError};
#[allow(unused_imports)]
pub use provider_adapter::{
    get_adapter, get_adapter_for_config, resolve_api_format, resolve_provider_config, ApiFormat,
    ProviderAdapter, ProviderCapabilities, ProviderId, ResolvedProviderConfig, StreamContext,
    StreamEvent,
};
#[allow(unused_imports)]
pub use request_builder::{
    build_anthropic_body, build_anthropic_headers, build_anthropic_url, build_openai_body,
    build_openai_headers, build_openai_url, detect_artifacts, estimate_messages_tokens,
    estimate_request_input_tokens, estimate_tokens, format_messages_for_anthropic,
    format_messages_for_openai,
};
#[allow(unused_imports)]
pub use retry::{run_with_retry, RetryPolicy, DEFAULT_RETRY_POLICY};
#[allow(unused_imports)]
pub use stream::{collect_sse_data_lines, parse_plain_response, parse_sse_data_line, split_think_content, stream_response, ThinkSegmentIter};
#[allow(unused_imports)]
pub use telemetry::{sanitize_endpoint, ClaudeHttpTelemetry, ClaudeHttpTelemetryOutcome};
#[allow(unused_imports)]
pub use executor::{
    build_http_client, empty_response, has_running_request, send_request_impl,
    send_streaming_request, stop_current_request, validate_messages,
};
#[allow(unused_imports)]
pub use tool_catalog::{convert_tools_to_openai_format, get_tools, merge_system_prompt};

#[cfg(test)]
#[path = "__tests__/integration_test.rs"]
mod integration_test;
