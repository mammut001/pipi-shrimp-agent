use super::*;

#[test]
fn merges_system_prompt_and_browser_guide() {
    let merged = merge_system_prompt(Some("User prompt"), true);
    assert!(merged.contains("User prompt"));
    assert!(merged.contains("Browser Tools"));
}

#[test]
fn exposes_browser_tools_only_when_enabled() {
    // The tool catalog no longer advertises `save_plan_doc` to the
    // model: plan-document persistence is an app-side post-turn
    // action (see `PLAN_MODE_SYSTEM_PROMPT` in
    // `src/services/planMode.ts`) so the model never calls a tool
    // the Rust registry does not implement.
    assert_eq!(get_tools(false).len(), 26);
    assert_eq!(get_tools(true).len(), 36);
}

#[test]
fn exposes_test_barrier_tool_in_model_catalog() {
    let tools = get_tools(false);
    let barrier = tools
        .iter()
        .find(|t| t.get("name").and_then(|v| v.as_str()) == Some("test_barrier_tool"))
        .expect("test_barrier_tool must be in the model-facing catalog for Manual D / live soak");
    assert!(
        barrier["description"]
            .as_str()
            .unwrap_or("")
            .to_lowercase()
            .contains("harness"),
        "description should mark this as a harness tool"
    );
    let required = barrier["input_schema"]["required"]
        .as_array()
        .expect("required array");
    assert!(
        required.iter().any(|v| v.as_str() == Some("barrier_id")),
        "barrier_id must be required"
    );
    let props = barrier["input_schema"]["properties"]
        .as_object()
        .expect("properties object");
    assert!(
            !props.contains_key("executionId") && !props.contains_key("execution_id"),
            "LLM catalog must not expose runtime-owned executionId/execution_id (model could invent them)"
        );
}

#[test]
fn filters_tools_by_allowed_names() {
    let filtered = filter_tools_by_allowed_names(
        &get_tools(false),
        Some(&["execute_command".to_string(), "read_file".to_string()]),
    );

    assert_eq!(filtered.len(), 2);
    assert_eq!(filtered[0]["name"], "read_file");
    assert_eq!(filtered[1]["name"], "execute_command");
}

#[test]
fn applies_allowed_tool_filter_to_openai_body() {
    let mut body = serde_json::json!({
        "tools": convert_tools_to_openai_format(&get_tools(false), true),
    });

    apply_allowed_tools_to_body(
        &mut body,
        Some(&["execute_command".to_string(), "read_file".to_string()]),
    );

    let tools = body["tools"].as_array().expect("filtered tools array");
    assert_eq!(tools.len(), 2);
    assert_eq!(tools[0]["function"]["name"], "read_file");
    assert_eq!(tools[1]["function"]["name"], "execute_command");
}

#[test]
fn converts_tools_to_openai_function_shape() {
    let converted = convert_tools_to_openai_format(&get_tools(false), true);
    assert_eq!(converted[0]["type"], "function");
    assert!(converted[0]["function"]["parameters"].is_object());
}

// Option A — `save_plan_doc` is intentionally NOT a model-visible
// tool. Plan-document persistence is an app-side post-turn action
// in `chatActions.sendMessage` (see `PLAN_MODE_SYSTEM_PROMPT` and
// `shouldSavePlanDoc` in `src/services/planMode.ts`), and the Rust
// tool registry has no `save_plan_doc` handler. The catalog must
// never advertise the tool in any configuration — neither with
// nor without browser tools enabled.
#[test]
fn model_facing_catalog_does_not_expose_save_plan_doc() {
    for allow_browser in [false, true] {
        let tools = get_tools(allow_browser);
        for tool in &tools {
            let name = tool
                .get("name")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            assert_ne!(
                name, "save_plan_doc",
                "save_plan_doc must not be advertised in the model-facing tool catalog \
                     (allow_browser_tools = {allow_browser}); plan-doc persistence is an \
                     app-side post-turn action, not a model-callable tool."
            );
        }
    }
}

// Filtering by an allowedTools list that mentions save_plan_doc
// must produce an empty result — the catalog has nothing to match,
// so the model never sees a tool name it cannot execute.
#[test]
fn filter_by_save_plan_doc_yields_empty_catalog() {
    let filtered =
        filter_tools_by_allowed_names(&get_tools(false), Some(&["save_plan_doc".to_string()]));
    assert!(
        filtered.is_empty(),
        "Filtering by the unknown save_plan_doc name must produce an empty tool list; \
             the model must never see a tool it cannot execute."
    );
}

#[test]
fn strict_openai_tool_schemas_avoid_one_of() {
    let tools = get_tools(false);
    for tool in &tools {
        let schema = tool
            .get("input_schema")
            .expect("tool input_schema")
            .to_string();
        assert!(
            !schema.contains("\"oneOf\"") && !schema.contains("\"anyOf\""),
            "tool {:?} schema must not use oneOf/anyOf for OpenAI strict mode",
            tool.get("name")
        );
    }
}
