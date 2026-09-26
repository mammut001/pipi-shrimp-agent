use super::*;

fn make_request(name: &str) -> ToolCallRequest {
    ToolCallRequest {
        id: "tool-1".to_string(),
        name: name.to_string(),
        arguments: "{}".to_string(),
        work_dir: Some("/tmp/project".to_string()),
        source: ToolExecutionSource::HeadlessAgent,
        allowed_tools: None,
        api_key: None,
        model: None,
        base_url: None,
        provider: None,
        api_format: None,
        provider_capabilities: None,
        approval_token: None,
        execution_mode: None,
    }
}

#[test]
fn disallowed_tool_is_rejected() {
    let mut request = make_request("read_file");
    request.allowed_tools = Some(vec!["write_file".to_string()]);

    let error = enforce_request_policy(
        &request,
        &serde_json::json!({ "path": "README.md" }),
        Some("session-1"),
    )
    .expect_err("expected allowlist rejection");

    assert!(error.to_string().contains("not allowed"));
}

#[test]
fn headless_network_command_is_rejected() {
    let request = make_request("execute_command");

    let error = enforce_request_policy(
        &request,
        &serde_json::json!({ "command": "curl https://example.com", "cwd": "/tmp/project" }),
        Some("session-1"),
    )
    .expect_err("expected network command rejection");

    assert!(error.to_string().contains("not allowed"));
}

#[test]
fn ssh_exec_preview_requires_confirmation() {
    let mut request = make_request("ssh_exec");
    request.source = ToolExecutionSource::AssistantToolCall;
    request.arguments = serde_json::json!({
        "command": "pytest -q",
        "remoteWorkDir": "/srv/project"
    })
    .to_string();

    let preview = preview_request_policy(
        &request,
        &serde_json::json!({ "command": "pytest -q", "remoteWorkDir": "/srv/project" }),
        Some("session-1"),
    )
    .expect("preview should succeed");

    assert_eq!(preview.decision, "awaiting_confirmation");
    assert!(preview.approval_token.is_some());
}

#[test]
fn autoresearch_phase_bypass_allows_ssh_exec_without_confirmation() {
    let mut request = make_request("ssh_exec");
    request.source = ToolExecutionSource::AutoresearchPhase;
    request.execution_mode = Some("bypass".to_string());
    request.arguments = serde_json::json!({
        "command": "python3 run_experiment.py",
        "remoteWorkDir": "/srv/project"
    })
    .to_string();

    let preview = preview_request_policy(
        &request,
        &serde_json::json!({
            "command": "python3 run_experiment.py",
            "remoteWorkDir": "/srv/project"
        }),
        Some("session-1"),
    )
    .expect("preview should succeed");

    assert_eq!(preview.decision, "allowed");
    assert!(preview.approval_token.is_none());
}

#[test]
fn approval_token_allows_exact_resume_once() {
    let mut request = make_request("execute_command");
    request.source = ToolExecutionSource::AssistantToolCall;
    request.arguments = serde_json::json!({
        "command": "curl https://example.com",
        "cwd": "/tmp/project"
    })
    .to_string();

    let args = serde_json::json!({
        "command": "curl https://example.com",
        "cwd": "/tmp/project"
    });

    let preview =
        preview_request_policy(&request, &args, Some("session-1")).expect("preview should succeed");
    assert_eq!(preview.decision, "awaiting_confirmation");

    let error = enforce_request_policy(&request, &args, Some("session-1"))
        .expect_err("missing approval token should be rejected");
    assert!(error.to_string().contains("approval"));

    request.approval_token = preview.approval_token.clone();
    enforce_request_policy(&request, &args, Some("session-1"))
        .expect("matching approval token should allow execution");

    let replay_error = enforce_request_policy(&request, &args, Some("session-1"))
        .expect_err("approval token should be single-use");
    assert!(replay_error.to_string().contains("approval"));
}

#[test]
fn approval_token_ignores_execution_id_fingerprint_drift() {
    let mut request = make_request("execute_command");
    request.source = ToolExecutionSource::AssistantToolCall;
    request.work_dir = Some("/tmp/project".to_string());
    let preview_args = serde_json::json!({
        "command": "sleep 20 && echo DONE",
        "executionId": "preview-exec-1"
    });
    request.arguments = preview_args.to_string();
    let preview =
        preview_request_policy(&request, &preview_args, Some("session-1")).expect("preview");
    let token = preview.approval_token.clone().expect("token");

    let execute_args = serde_json::json!({
        "executionId": "execute-exec-2",
        "command": "sleep 20 && echo DONE"
    });
    request.arguments = execute_args.to_string();
    request.approval_token = Some(token);
    enforce_request_policy(&request, &execute_args, Some("session-1"))
        .expect("executionId drift must not invalidate approval token");
}

#[test]
fn approval_substitution_rejects_command_change() {
    // Preview sleep 20 → token → execute with same token/session/id/name
    // but a substituted command must fail (semantic args binding).
    let mut request = make_request("execute_command");
    request.source = ToolExecutionSource::AssistantToolCall;
    request.work_dir = Some("/tmp/project".to_string());
    let preview_args = serde_json::json!({
        "command": "sleep 20"
    });
    request.arguments = preview_args.to_string();
    let preview =
        preview_request_policy(&request, &preview_args, Some("session-1")).expect("preview");
    let token = preview.approval_token.clone().expect("token");

    // Keep a long-running command so policy still RequireConfirmation and
    // the consume fingerprint path runs (benign non-LR commands Allow).
    let execute_args = serde_json::json!({
        "command": "sleep 999"
    });
    request.arguments = execute_args.to_string();
    request.approval_token = Some(token);
    let error = enforce_request_policy(&request, &execute_args, Some("session-1"))
        .expect_err("command substitution must fail");
    let message = error.to_string();
    assert!(
        message.contains("identity mismatch") && message.contains("arguments"),
        "unexpected error: {message}"
    );
}

#[test]
fn approval_work_dir_substitution_rejects() {
    // Same token but different effective work_dir must fail.
    let mut request = make_request("execute_command");
    request.source = ToolExecutionSource::AssistantToolCall;
    request.work_dir = Some("/tmp/project".to_string());
    let preview_args = serde_json::json!({
        "command": "sleep 20"
    });
    request.arguments = preview_args.to_string();
    let preview =
        preview_request_policy(&request, &preview_args, Some("session-1")).expect("preview");
    let token = preview.approval_token.clone().expect("token");

    request.work_dir = Some("/tmp/other".to_string());
    let execute_args = serde_json::json!({
        "command": "sleep 20"
    });
    request.arguments = execute_args.to_string();
    request.approval_token = Some(token);
    let error = enforce_request_policy(&request, &execute_args, Some("session-1"))
        .expect_err("work_dir substitution must fail");
    let message = error.to_string();
    assert!(
        message.contains("identity mismatch")
            && (message.contains("work_dir") || message.contains("arguments")),
        "unexpected error: {message}"
    );
}

#[test]
fn approval_allows_execution_id_and_key_order_drift() {
    // Canonicalization ignores executionId/execution_id and JSON key order.
    let mut request = make_request("execute_command");
    request.source = ToolExecutionSource::AssistantToolCall;
    request.work_dir = Some("/tmp/project".to_string());
    let preview_args = serde_json::json!({
        "command": "sleep 20",
        "executionId": "preview-exec-1",
        "cwd": "/tmp/project"
    });
    request.arguments = preview_args.to_string();
    let preview =
        preview_request_policy(&request, &preview_args, Some("session-1")).expect("preview");
    let token = preview.approval_token.clone().expect("token");

    let execute_args = serde_json::json!({
        "execution_id": "execute-exec-2",
        "cwd": "/tmp/project",
        "command": "sleep 20"
    });
    request.arguments = execute_args.to_string();
    request.approval_token = Some(token);
    enforce_request_policy(&request, &execute_args, Some("session-1"))
        .expect("executionId/key-order drift must still allow");
}

#[test]
fn approval_token_rejects_wrong_session_id() {
    let mut request = make_request("execute_command");
    request.source = ToolExecutionSource::AssistantToolCall;
    let args = serde_json::json!({
        "command": "sleep 20",
        "cwd": "/tmp/project"
    });
    request.arguments = args.to_string();
    let preview = preview_request_policy(&request, &args, Some("session-1")).expect("preview");
    request.approval_token = preview.approval_token.clone();

    let error = enforce_request_policy(&request, &args, Some("session-other"))
        .expect_err("wrong session_id must fail");
    let message = error.to_string();
    assert!(
        message.contains("identity mismatch") && message.contains("session_id"),
        "unexpected error: {message}"
    );
    assert!(
        message.contains("stored_session_prefix=session-")
            && message.contains("expected_session_prefix=session-"),
        "mismatch should include safe session prefixes: {message}"
    );
    assert!(
        !message.contains("missing session_id"),
        "wrong UUID must not use the missing-session wording: {message}"
    );

    // Identity mismatch must not consume the one-shot token.
    enforce_request_policy(&request, &args, Some("session-1"))
        .expect("matching session should still consume after wrong-session reject");
}

#[test]
fn approval_token_rejects_missing_session_on_execute_distinctly() {
    let mut request = make_request("execute_command");
    request.source = ToolExecutionSource::AssistantToolCall;
    let args = serde_json::json!({
        "command": "sleep 20",
        "cwd": "/tmp/project"
    });
    request.arguments = args.to_string();
    let preview = preview_request_policy(&request, &args, Some("session-1")).expect("preview");
    request.approval_token = preview.approval_token.clone();

    let error = enforce_request_policy(&request, &args, None)
        .expect_err("execute without session_id must fail");
    let message = error.to_string();
    assert!(
        message.contains("execute path missing session_id"),
        "unexpected error: {message}"
    );
    assert!(
        !message.contains("identity mismatch"),
        "missing session must not look like a UUID mismatch: {message}"
    );

    // Token must remain consumable with the original preview session.
    enforce_request_policy(&request, &args, Some("session-1"))
        .expect("matching session should still consume after missing-session reject");
}

#[test]
fn approval_token_matching_session_allows_long_running_command() {
    let mut request = make_request("execute_command");
    request.source = ToolExecutionSource::AssistantToolCall;
    let args = serde_json::json!({
        "command": "sleep 20",
        "cwd": "/tmp/project"
    });
    request.arguments = args.to_string();
    let preview =
        preview_request_policy(&request, &args, Some("chat-session-abc")).expect("preview");
    assert_eq!(preview.decision, "awaiting_confirmation");
    request.approval_token = preview.approval_token;

    enforce_request_policy(&request, &args, Some("chat-session-abc"))
        .expect("matching chat session_id must allow after Allow");
}

#[test]
fn approval_token_rejects_wrong_tool_call_id() {
    let mut request = make_request("execute_command");
    request.source = ToolExecutionSource::AssistantToolCall;
    let args = serde_json::json!({
        "command": "sleep 20",
        "cwd": "/tmp/project"
    });
    request.arguments = args.to_string();
    let preview = preview_request_policy(&request, &args, Some("session-1")).expect("preview");
    request.approval_token = preview.approval_token.clone();
    request.id = "tool-other".to_string();

    let error = enforce_request_policy(&request, &args, Some("session-1"))
        .expect_err("wrong tool_call_id must fail");
    let message = error.to_string();
    assert!(
        message.contains("identity mismatch") && message.contains("tool_call_id"),
        "unexpected error: {message}"
    );
}

#[test]
fn approval_token_unknown_token_error_is_distinct_from_mismatch() {
    let mut request = make_request("execute_command");
    request.source = ToolExecutionSource::AssistantToolCall;
    let args = serde_json::json!({
        "command": "sleep 20",
        "cwd": "/tmp/project"
    });
    request.arguments = args.to_string();
    request.approval_token = Some("00000000-0000-0000-0000-000000000000".to_string());

    let error = enforce_request_policy(&request, &args, Some("session-1"))
        .expect_err("unknown token must fail");
    let message = error.to_string();
    assert!(
        message.contains("unknown, expired, or was already used"),
        "unexpected error: {message}"
    );
    assert!(
        !message.contains("did not match this session/tool/arguments"),
        "misleading present-but-mismatch wording must not appear: {message}"
    );
}

#[test]
fn bypass_autoresearch_execute_command_allows_normal_command_without_confirmation() {
    // Bypass mode shortcut: a benign AutoResearch command
    // like `wc -l` must preview as `allowed` so the frontend can
    // skip the permission modal entirely. The frontend still runs
    // the hard safety hooks (dangerousCommandCheck /
    // pathValidationCheck) before this preview fires.
    let mut request = make_request("execute_command");
    request.source = ToolExecutionSource::AutoresearchPhase;
    request.execution_mode = Some("bypass".to_string());
    request.arguments = serde_json::json!({
        "command": "wc -l src/services/autoresearch/loopEngine.ts",
        "cwd": "/tmp/project"
    })
    .to_string();

    let preview = preview_request_policy(
        &request,
        &serde_json::json!({
            "command": "wc -l src/services/autoresearch/loopEngine.ts",
            "cwd": "/tmp/project"
        }),
        Some("session-1"),
    )
    .expect("preview should succeed");

    assert_eq!(preview.decision, "allowed");
    assert!(preview.approval_token.is_none());

    // And enforce must also pass without a token.
    enforce_request_policy(
        &request,
        &serde_json::json!({
            "command": "wc -l src/services/autoresearch/loopEngine.ts",
            "cwd": "/tmp/project"
        }),
        Some("session-1"),
    )
    .expect("bypass execution should not require approval token");
}

#[test]
fn test_bypass_curl_rejected() {
    // R2-08: AutoresearchPhase + bypass must still reject network cmds.
    let mut request = make_request("execute_command");
    request.source = ToolExecutionSource::AutoresearchPhase;
    request.execution_mode = Some("bypass".to_string());
    let curl_args = serde_json::json!({
        "command": "curl https://example.com",
        "cwd": "/tmp/project"
    });
    request.arguments = curl_args.to_string();

    let preview = preview_request_policy(&request, &curl_args, Some("session-1"))
        .expect("preview should succeed");
    assert_eq!(
        preview.decision, "rejected",
        "bypass must not allow AutoresearchPhase network commands"
    );
    assert!(preview.approval_token.is_none());

    let error = enforce_request_policy(&request, &curl_args, Some("session-1"))
        .expect_err("bypass+curl under AutoresearchPhase must be rejected");
    assert!(
        error
            .to_string()
            .contains("AutoResearch phases cannot run network or package-install commands"),
        "unexpected error: {error}"
    );

    // Benign local command still allowed under AutoresearchPhase + bypass.
    let benign_args = serde_json::json!({
        "command": "wc -l file",
        "cwd": "/tmp/project"
    });
    request.arguments = benign_args.to_string();
    let benign_preview = preview_request_policy(&request, &benign_args, Some("session-1"))
        .expect("preview should succeed");
    assert_eq!(benign_preview.decision, "allowed");
    enforce_request_policy(&request, &benign_args, Some("session-1"))
        .expect("benign AutoresearchPhase bypass command should still be allowed");
}

#[test]
fn bypass_does_not_relax_non_assistant_sources() {
    // Bypass must only affect agent/assistant sources — user/terminal sources
    // keep their existing strict policy.
    let mut request = make_request("execute_command");
    request.source = ToolExecutionSource::UserRequestedCommand;
    request.execution_mode = Some("bypass".to_string());
    request.arguments = serde_json::json!({
        "command": "pwd",
        "cwd": "/tmp/project"
    })
    .to_string();

    let preview = preview_request_policy(
        &request,
        &serde_json::json!({
            "command": "pwd",
            "cwd": "/tmp/project"
        }),
        Some("session-1"),
    )
    .expect("preview should succeed");

    assert_eq!(
        preview.decision, "allowed",
        "User requested pwd command inside workdir is allowed"
    );
}

#[test]
fn bypass_allows_headless_and_workflow_agents() {
    for source in [
        ToolExecutionSource::HeadlessAgent,
        ToolExecutionSource::WorkflowAgent,
    ] {
        let mut request = make_request("execute_command");
        request.source = source;
        request.execution_mode = Some("bypass".to_string());
        request.arguments = serde_json::json!({
            "command": "python3 script.py",
            "cwd": "/tmp/project"
        })
        .to_string();

        let preview = preview_request_policy(
            &request,
            &serde_json::json!({
                "command": "python3 script.py",
                "cwd": "/tmp/project"
            }),
            Some("session-1"),
        )
        .expect("preview should succeed");

        assert_eq!(
            preview.decision, "allowed",
            "Bypass relaxes HeadlessAgent and WorkflowAgent for safe commands"
        );
    }
}

#[test]
fn bypass_assistant_browser_mutation_allows_without_confirmation() {
    let mut request = make_request("browser_navigate");
    request.source = ToolExecutionSource::AssistantToolCall;
    request.execution_mode = Some("bypass".to_string());
    request.arguments = serde_json::json!({
        "url": "https://example.com"
    })
    .to_string();

    let preview = preview_request_policy(
        &request,
        &serde_json::json!({ "url": "https://example.com" }),
        Some("session-1"),
    )
    .expect("preview should succeed");

    assert_eq!(preview.decision, "allowed");
    assert!(preview.approval_token.is_none());

    enforce_request_policy(
        &request,
        &serde_json::json!({ "url": "https://example.com" }),
        Some("session-1"),
    )
    .expect("bypass execution should not require approval token");
}

#[test]
fn agent_assistant_browser_mutation_allows_without_confirmation() {
    let mut request = make_request("browser_navigate");
    request.source = ToolExecutionSource::AssistantToolCall;
    request.execution_mode = Some("agent".to_string());
    request.arguments = serde_json::json!({
        "url": "https://example.com"
    })
    .to_string();

    let preview = preview_request_policy(
        &request,
        &serde_json::json!({ "url": "https://example.com" }),
        Some("session-1"),
    )
    .expect("preview should succeed");

    assert_eq!(preview.decision, "allowed");
    assert!(preview.approval_token.is_none());

    enforce_request_policy(
        &request,
        &serde_json::json!({ "url": "https://example.com" }),
        Some("session-1"),
    )
    .expect("agent execution should not require approval token");
}

#[test]
fn standard_assistant_browser_mutation_still_requires_confirmation() {
    let mut request = make_request("browser_navigate");
    request.source = ToolExecutionSource::AssistantToolCall;
    request.execution_mode = Some("ask".to_string());
    request.arguments = serde_json::json!({
        "url": "https://example.com"
    })
    .to_string();

    let preview = preview_request_policy(
        &request,
        &serde_json::json!({ "url": "https://example.com" }),
        Some("session-1"),
    )
    .expect("preview should succeed");

    assert_eq!(preview.decision, "awaiting_confirmation");
    assert!(preview.approval_token.is_some());
}

#[test]
fn bypass_assistant_cdp_execute_script_allows_without_confirmation() {
    let script = "console.log('hello')";
    let mut request = make_request("cdp_execute_script");
    request.source = ToolExecutionSource::AssistantToolCall;
    request.execution_mode = Some("bypass".to_string());
    request.arguments = serde_json::json!({
        "script": script
    })
    .to_string();

    let preview = preview_request_policy(
        &request,
        &serde_json::json!({ "script": script }),
        Some("session-1"),
    )
    .expect("preview should succeed");

    assert_eq!(preview.decision, "allowed");
    assert!(preview.approval_token.is_none());

    enforce_cdp_execute_script_policy(
        "tool-1",
        script,
        ToolExecutionSource::AssistantToolCall,
        Some("session-1"),
        None,
        Some("bypass"),
        None,
    )
    .expect("bypass execution should not require approval token");
}

#[test]
fn cdp_execute_script_requires_policy_for_assistant_source() {
    let error = enforce_cdp_execute_script_policy(
        "tool-1",
        "document.body.innerHTML = 'owned'",
        ToolExecutionSource::AssistantToolCall,
        None,
        None,
        None,
        None,
    )
    .expect_err("assistant arbitrary script without session should be rejected");

    assert!(error.to_string().contains("session_id is required"));
    assert!(!error.to_string().contains("owned"));
}

#[test]
fn cdp_execute_script_consumes_matching_approval_token() {
    let script = "window.alert('probe')";
    let args = serde_json::json!({ "script": script });
    let mut request = make_request("cdp_execute_script");
    request.source = ToolExecutionSource::AssistantToolCall;
    request.arguments = args.to_string();

    let preview =
        preview_request_policy(&request, &args, Some("session-a")).expect("preview should succeed");
    assert_eq!(preview.decision, "awaiting_confirmation");
    let token = preview
        .approval_token
        .expect("preview should issue approval token");

    let denied = enforce_cdp_execute_script_policy(
        "tool-1",
        script,
        ToolExecutionSource::AssistantToolCall,
        Some("session-a"),
        None,
        None,
        request.work_dir.as_deref(),
    )
    .expect_err("missing token should be rejected");
    assert!(denied.to_string().contains("approval"));
    assert!(!denied.to_string().contains(script));

    let wrong_session = enforce_cdp_execute_script_policy(
        "tool-1",
        script,
        ToolExecutionSource::AssistantToolCall,
        Some("session-b"),
        Some(&token),
        None,
        request.work_dir.as_deref(),
    )
    .expect_err("token bound to another session should be rejected");
    assert!(wrong_session.to_string().contains("approval"));

    enforce_cdp_execute_script_policy(
        "tool-1",
        script,
        ToolExecutionSource::AssistantToolCall,
        Some("session-a"),
        Some(&token),
        None,
        request.work_dir.as_deref(),
    )
    .expect("matching token should allow execution");

    let replay = enforce_cdp_execute_script_policy(
        "tool-1",
        script,
        ToolExecutionSource::AssistantToolCall,
        Some("session-a"),
        Some(&token),
        None,
        request.work_dir.as_deref(),
    )
    .expect_err("approval token must be single-use");
    assert!(replay.to_string().contains("approval"));
}

#[test]
fn cdp_execute_script_denies_unknown_source() {
    let error = enforce_cdp_execute_script_policy(
        "tool-1",
        "window.alert('x')",
        ToolExecutionSource::Unknown,
        Some("session-1"),
        None,
        None,
        None,
    )
    .expect_err("unknown source should be denied");

    assert!(error.to_string().contains("denied by policy"));
}

#[test]
fn cdp_execute_script_allows_trusted_internal_overlay_for_headless_agent() {
    enforce_cdp_execute_script_policy(
        "tool-1",
        "(function(){ if(document.getElementById('__ppa_overlay__'))return; })();",
        ToolExecutionSource::HeadlessAgent,
        None,
        None,
        None,
        None,
    )
    .expect("trusted overlay script should be allowed for headless agent");
}

#[test]
fn cdp_execute_script_manual_user_arbitrary_requires_approval() {
    let error = enforce_cdp_execute_script_policy(
        "tool-1",
        "window.alert('manual')",
        ToolExecutionSource::UserRequestedCommand,
        Some("session-1"),
        None,
        None,
        None,
    )
    .expect_err("manual user arbitrary script without approval should be rejected");

    assert!(error.to_string().contains("approval"));
    assert!(!error.to_string().contains("manual"));
}

#[test]
fn cdp_execute_script_denies_secret_leak_in_error_message() {
    let secret_script = "const token = 'super-secret-token'; token;";
    let error = enforce_cdp_execute_script_policy(
        "tool-1",
        secret_script,
        ToolExecutionSource::Unknown,
        Some("session-1"),
        None,
        None,
        None,
    )
    .expect_err("unknown arbitrary script should be denied");

    let message = error.to_string();
    assert!(message.contains("denied by policy"));
    assert!(!message.contains("super-secret-token"));
}

#[test]
fn ssh_upload_rejects_remote_path_escape() {
    let mut request = make_request("ssh_upload_file");
    request.source = ToolExecutionSource::AssistantToolCall;
    request.arguments = serde_json::json!({
        "remoteWorkDir": "/srv/project",
        "remotePath": "../etc/passwd",
        "content": "owned"
    })
    .to_string();

    let error = preview_request_policy(
        &request,
        &serde_json::json!({
            "remoteWorkDir": "/srv/project",
            "remotePath": "../etc/passwd",
            "content": "owned"
        }),
        Some("session-1"),
    )
    .expect_err("remote path escape should be rejected");

    assert!(error.to_string().contains("outside remote root"));
}

#[test]
fn test_barrier_tool_allows_without_long_running_confirmation() {
    let mut request = make_request("test_barrier_tool");
    request.source = ToolExecutionSource::AssistantToolCall;
    // No work_dir required — barrier has no path binding.
    request.work_dir = None;
    request.arguments = serde_json::json!({
        "barrier_id": "manual-d-a",
        "executionId": "exec-a"
    })
    .to_string();

    let preview = preview_request_policy(
        &request,
        &serde_json::json!({
            "barrier_id": "manual-d-a",
            "executionId": "exec-a"
        }),
        Some("session-barrier"),
    )
    .expect("preview should succeed");

    assert_eq!(
        preview.decision, "allowed",
        "test_barrier_tool must not require long-running confirmation: {:?}",
        preview.reason
    );
    assert!(preview.approval_token.is_none());
}

#[test]
fn test_barrier_tool_does_not_require_work_dir() {
    let mut request = make_request("test_barrier_tool");
    request.source = ToolExecutionSource::AssistantToolCall;
    request.work_dir = None;
    let args = serde_json::json!({ "barrier_id": "no-workdir" });
    request.arguments = args.to_string();

    enforce_request_policy(&request, &args, Some("session-barrier"))
        .expect("test_barrier_tool must not require work_dir");
}
