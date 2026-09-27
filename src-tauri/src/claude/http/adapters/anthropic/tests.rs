use super::*;

fn tool_call_events(chunks: &[&str]) -> Vec<StreamEvent> {
    let adapter = AnthropicAdapter::new();
    let mut ctx = StreamContext::new(0, None, None);
    let mut events = Vec::new();
    for chunk in chunks {
        events.extend(adapter.parse_stream_chunk(chunk, &mut ctx).unwrap());
    }
    events
        .into_iter()
        .filter(|event| matches!(event, StreamEvent::ToolCall { .. }))
        .collect()
}

fn only_arguments(events: &[StreamEvent]) -> serde_json::Value {
    assert_eq!(events.len(), 1, "expected one tool call, got {:?}", events);
    match &events[0] {
        StreamEvent::ToolCall { arguments, .. } => serde_json::from_str(arguments).unwrap(),
        other => panic!("unexpected event {:?}", other),
    }
}

#[test]
fn streamed_tool_arguments_do_not_keep_the_empty_input_placeholder() {
    let events = tool_call_events(&[
        r#"{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"read_file","input":{}}}"#,
        r#"{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":""}}"#,
        r#"{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"path\": \"Carg"}}"#,
        r#"{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"o.toml\"}"}}"#,
        r#"{"type":"content_block_stop","index":1}"#,
    ]);

    assert_eq!(only_arguments(&events), serde_json::json!({ "path": "Cargo.toml" }));
}

#[test]
fn streamed_tool_without_arguments_finalizes_as_empty_object() {
    let events = tool_call_events(&[
        r#"{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_2","name":"list_sessions","input":{}}}"#,
        r#"{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":""}}"#,
        r#"{"type":"content_block_stop","index":0}"#,
    ]);

    assert_eq!(only_arguments(&events), serde_json::json!({}));
}

#[test]
fn non_empty_start_input_is_kept_when_no_deltas_follow() {
    let events = tool_call_events(&[
        r#"{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_3","name":"read_file","input":{"path":"a.txt"}}}"#,
        r#"{"type":"content_block_stop","index":0}"#,
    ]);

    assert_eq!(only_arguments(&events), serde_json::json!({ "path": "a.txt" }));
}
