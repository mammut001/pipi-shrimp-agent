use super::*;
use crate::browser::actions;
use crate::browser::actions::common::BrowserActionError;
use crate::browser::actions::test_support::{
    load_page_state_fixture, CheckoutFlowServer, FixtureActionHarness, LiveActionHarness,
};
use crate::browser::actions::ElementReference;
use crate::browser::dom::InteractiveElement;
use anyhow::Result as AnyhowResult;
use std::sync::Mutex as StdMutex;


#[test]
fn typst_path_sandbox() {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be monotonic enough for tests")
        .as_nanos();
    let work = std::env::temp_dir().join(format!("pipi-shrimp-typst-work-{}", unique));
    let outside = std::env::temp_dir().join(format!("pipi-shrimp-typst-outside-{}", unique));
    fs::create_dir_all(&work).expect("work dir");
    fs::create_dir_all(&outside).expect("outside dir");

    let work_s = work.to_string_lossy().to_string();
    let outside_pdf = outside.join("escape.pdf");
    let outside_out = outside.join("outdir");

    let err = resolve_typst_path(
        outside_pdf.to_string_lossy().as_ref(),
        Some(work_s.as_str()),
    )
    .expect_err("typst PDF destination outside work_dir must be rejected");
    let err_s = err.to_string();
    assert!(
        err_s.contains("outside the bound work directory") || err_s.contains("Access denied"),
        "unexpected error: {err_s}"
    );

    let err2 = resolve_typst_path(
        outside_out.to_string_lossy().as_ref(),
        Some(work_s.as_str()),
    )
    .expect_err("typst output_dir outside work_dir must be rejected");
    let err2_s = err2.to_string();
    assert!(
        err2_s.contains("outside the bound work directory") || err2_s.contains("Access denied"),
        "unexpected error: {err2_s}"
    );

    // In-scope relative path should resolve under work_dir.
    let ok = resolve_typst_path("nested/out.pdf", Some(work_s.as_str()))
        .expect("in-scope typst path should resolve");
    assert!(ok.starts_with(&work));

    fs::remove_dir_all(&work).ok();
    fs::remove_dir_all(&outside).ok();
}

#[test]
fn browser_target_from_args_accepts_navigation_id_aliases() {
    let args = serde_json::json!({
        "elementId": 7,
        "backendNodeId": 701,
        "navigationId": "nav-42"
    });

    let target = browser_target_from_args(&args, "browser_click").unwrap();

    assert_eq!(target, (Some(7), Some(701), Some("nav-42".to_string())));
}

#[test]
fn parse_browser_wait_accepts_selector_aliases() {
    let args = serde_json::json!({
        "waitSelector": ".checkout-ready"
    });

    let call = parse_browser_chat_tool_call("browser_wait", &args)
        .unwrap()
        .unwrap();

    assert_eq!(
        call,
        BrowserChatToolCall::Wait {
            seconds: None,
            wait_selector: Some(".checkout-ready".to_string()),
        }
    );
}

#[test]
fn serialize_page_state_for_chat_emits_pretty_json() {
    let page_state = sample_page_state();

    let rendered = serialize_page_state_for_chat(&page_state);

    assert!(rendered.starts_with("{\n"));
    assert!(rendered.contains("\"navigation_id\": \"nav-42\""));
    assert!(rendered.contains("\"backend_node_id\": 101"));
    assert!(rendered.contains("\"warnings\": [\n    \"cross_origin_iframe_partial\"\n  ]"));
}

#[tokio::test]
async fn browser_get_page_returns_pretty_json_through_chat_dispatcher() {
    let runtime = FakeBrowserChatRuntime::default();

    let rendered = execute_browser_chat_tool_call(BrowserChatToolCall::GetPage, &runtime).await;

    assert!(rendered.contains("\"title\": \"Dashboard\""));
    assert!(rendered.contains("\"backend_node_id\": 101"));
}

#[tokio::test]
async fn browser_click_formats_backend_node_target_labels() {
    let runtime = FakeBrowserChatRuntime::default();
    let call = parse_browser_chat_tool_call(
        "browser_click",
        &serde_json::json!({
            "backendNodeId": 701,
            "navigationId": "nav-42"
        }),
    )
    .unwrap()
    .unwrap();

    let rendered = execute_browser_chat_tool_call(call, &runtime).await;

    assert_eq!(
        rendered,
        "已点击backend_node_id 701，页面可能已更新，请使用 browser_get_page 查看新状态"
    );
    assert_eq!(
        runtime.last_click_target.lock().unwrap().clone(),
        Some(BrowserToolTarget {
            element_id: None,
            backend_node_id: Some(701),
            navigation_id: Some("nav-42".to_string()),
        })
    );
}

#[tokio::test]
async fn browser_type_reports_targeted_failures_for_chat_tools() {
    let runtime = FakeBrowserChatRuntime {
        type_result: Err("browser.page_state_stale".to_string()),
        ..FakeBrowserChatRuntime::default()
    };
    let call = parse_browser_chat_tool_call(
        "browser_type",
        &serde_json::json!({
            "element_id": 7,
            "backend_node_id": 701,
            "text": "hello"
        }),
    )
    .unwrap()
    .unwrap();

    let rendered = execute_browser_chat_tool_call(call, &runtime).await;

    assert_eq!(
        rendered,
        "ERROR: 向元素 7 / backend_node_id 701输入失败: browser.page_state_stale"
    );
}

#[tokio::test]
async fn browser_get_page_maps_not_connected_errors_to_user_guidance() {
    let runtime = FakeBrowserChatRuntime {
        page_state_result: Err("Browser not connected".to_string()),
        ..FakeBrowserChatRuntime::default()
    };

    let rendered = execute_browser_chat_tool_call(BrowserChatToolCall::GetPage, &runtime).await;

    assert_eq!(rendered, browser_not_connected_message());
}

#[tokio::test]
async fn browser_navigate_uses_page_state_title_after_resync_warning() {
    let runtime = FakeBrowserChatRuntime {
        resync_result: Err("page replaced".to_string()),
        ..FakeBrowserChatRuntime::default()
    };

    let rendered = execute_browser_chat_tool_call(
        BrowserChatToolCall::Navigate {
            url: "https://example.com/checkout".to_string(),
            wait_selector: Some(".checkout-ready".to_string()),
        },
        &runtime,
    )
    .await;

    assert_eq!(
        rendered,
        "已导航到: https://example.com/checkout，页面标题: Dashboard"
    );
}

#[tokio::test]
async fn browser_type_retries_with_fresh_iframe_fixture_through_action_context_harness() {
    let runtime = FixtureBrowserChatRuntime::new(
        Some(load_page_state_fixture("iframe-retry-cache")),
        vec![load_page_state_fixture("iframe-shadow")],
    )
    .await;
    let call = parse_browser_chat_tool_call(
        "browser_type",
        &serde_json::json!({
            "backendNodeId": 310,
            "navigationId": "loader-root-1",
            "text": "4242"
        }),
    )
    .unwrap()
    .unwrap();

    let rendered = execute_browser_chat_tool_call(call, &runtime).await;

    assert_eq!(rendered, "输入成功: backend_node_id 310，共 4 个字符");
    assert_eq!(runtime.capture_count().await, 1);
    assert_eq!(
        runtime
            .last_resolved_element()
            .as_ref()
            .map(|element| element.frame_id.as_str()),
        Some("frame-checkout")
    );
}

#[tokio::test]
async fn browser_click_recovers_after_refreshing_navigation_id_from_browser_get_page() {
    let refreshed_page_state = load_page_state_fixture("navigation-refresh");
    let runtime = FixtureBrowserChatRuntime::new(
        Some(refreshed_page_state.clone()),
        vec![refreshed_page_state.clone(), refreshed_page_state.clone()],
    )
    .await;
    let stale_click = parse_browser_chat_tool_call(
        "browser_click",
        &serde_json::json!({
            "backendNodeId": 200,
            "navigationId": "loader-root-1"
        }),
    )
    .unwrap()
    .unwrap();

    let stale_rendered = execute_browser_chat_tool_call(stale_click, &runtime).await;

    assert!(stale_rendered.contains("browser.page_state_stale"));
    assert!(stale_rendered.contains("loader-root-2"));

    let page_state_json =
        execute_browser_chat_tool_call(BrowserChatToolCall::GetPage, &runtime).await;
    assert!(page_state_json.contains("\"navigation_id\": \"loader-root-2\""));
    assert!(page_state_json.contains("\"title\": \"Review Order\""));

    let fresh_click = parse_browser_chat_tool_call(
        "browser_click",
        &serde_json::json!({
            "backendNodeId": 200,
            "navigationId": "loader-root-2"
        }),
    )
    .unwrap()
    .unwrap();

    let fresh_rendered = execute_browser_chat_tool_call(fresh_click, &runtime).await;

    assert_eq!(
        fresh_rendered,
        "已点击backend_node_id 200，页面可能已更新，请使用 browser_get_page 查看新状态"
    );
    assert_eq!(runtime.capture_count().await, 2);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires a local Chrome/Chromium binary for Chromiumoxide Browser::launch"]
async fn live_browser_chat_tools_render_shadow_success_messages() -> AnyhowResult<()> {
    let server = CheckoutFlowServer::start().await?;
    let harness = LiveActionHarness::launch().await?;

    let live_result = async {
        let runtime = LiveHarnessBrowserChatRuntime::new(&harness);
        let navigate_url = server.shadow_checkout_url();
        let navigate_rendered = execute_browser_chat_tool_call(
            BrowserChatToolCall::Navigate {
                url: navigate_url.clone(),
                wait_selector: Some("#page-ready.ready".to_string()),
            },
            &runtime,
        )
        .await;
        assert_eq!(
            navigate_rendered,
            format!("已导航到: {}，页面标题: Shadow Checkout Flow", navigate_url)
        );

        let page_state = actions::get_page_state(harness.ctx())
            .await
            .map_err(anyhow::Error::msg)?;
        let shadow_input = find_live_element(&page_state, "shadow chat input", |element| {
            element.frame_id != "root"
                && element.is_editable
                && element.selector_hint.as_deref() == Some("#shadow-card-number")
        })?;
        let shadow_button = find_live_element(&page_state, "shadow chat button", |element| {
            element.frame_id != "root"
                && element.is_clickable
                && element.tag_name.as_deref() == Some("button")
                && element.selector_hint.as_deref() == Some("#shadow-confirm-payment")
        })?;

        let get_page_rendered =
            execute_browser_chat_tool_call(BrowserChatToolCall::GetPage, &runtime).await;
        assert!(get_page_rendered.contains("\"title\": \"Shadow Checkout Flow\""));
        assert!(get_page_rendered.contains("\"selector_hint\": \"#shadow-confirm-payment\""));

        let typed_value = "7777 8888 9999 0000".to_string();
        let type_rendered = execute_browser_chat_tool_call(
            parse_browser_chat_tool_call(
                "browser_type",
                &serde_json::json!({
                    "backendNodeId": shadow_input.backend_node_id,
                    "navigationId": page_state.navigation_id,
                    "text": typed_value,
                }),
            )
            .unwrap()
            .unwrap(),
            &runtime,
        )
        .await;
        assert_eq!(
            type_rendered,
            format!(
                "输入成功: backend_node_id {}，共 {} 个字符",
                shadow_input.backend_node_id, 19
            )
        );

        let click_rendered = execute_browser_chat_tool_call(
            parse_browser_chat_tool_call(
                "browser_click",
                &serde_json::json!({
                    "backendNodeId": shadow_button.backend_node_id,
                    "navigationId": page_state.navigation_id,
                }),
            )
            .unwrap()
            .unwrap(),
            &runtime,
        )
        .await;
        assert_eq!(
            click_rendered,
            format!(
                "已点击backend_node_id {}，页面可能已更新，请使用 browser_get_page 查看新状态",
                shadow_button.backend_node_id
            )
        );

        let wait_rendered = execute_browser_chat_tool_call(
            BrowserChatToolCall::Wait {
                seconds: None,
                wait_selector: Some("#payment-status.ready".to_string()),
            },
            &runtime,
        )
        .await;
        assert!(wait_rendered.starts_with("等待完成，目标选择器已出现（"));

        let status_text = read_selector_text_live(&harness, "#payment-status").await?;
        assert!(status_text.contains("confirmed:"));
        assert!(status_text.contains("7777"));

        Ok::<(), anyhow::Error>(())
    }
    .await;

    let harness_shutdown = harness.shutdown().await;
    let server_shutdown = server.shutdown().await;

    live_result?;
    harness_shutdown?;
    server_shutdown?;
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires a local Chrome/Chromium binary for Chromiumoxide Browser::launch"]
async fn live_browser_chat_tools_map_shadow_stale_navigation_errors() -> AnyhowResult<()> {
    let server = CheckoutFlowServer::start().await?;
    let harness = LiveActionHarness::launch().await?;

    let live_result = async {
        let runtime = LiveHarnessBrowserChatRuntime::new(&harness);
        let navigate_rendered = execute_browser_chat_tool_call(
            BrowserChatToolCall::Navigate {
                url: server.shadow_checkout_url(),
                wait_selector: Some("#page-ready.ready".to_string()),
            },
            &runtime,
        )
        .await;
        assert!(navigate_rendered.contains("Shadow Checkout Flow"));

        let stale_page_state = actions::get_page_state(harness.ctx())
            .await
            .map_err(anyhow::Error::msg)?;
        let stale_button =
            find_live_element(&stale_page_state, "stale shadow button", |element| {
                element.frame_id != "root"
                    && element.is_clickable
                    && element.selector_hint.as_deref() == Some("#shadow-confirm-payment")
            })?;

        harness.page().reload().await.map_err(anyhow::Error::from)?;

        let reload_wait_rendered = execute_browser_chat_tool_call(
            BrowserChatToolCall::Wait {
                seconds: None,
                wait_selector: Some("#page-ready.ready".to_string()),
            },
            &runtime,
        )
        .await;
        assert!(reload_wait_rendered.starts_with("等待完成，目标选择器已出现（"));

        let refreshed_page_state = actions::get_page_state(harness.ctx())
            .await
            .map_err(anyhow::Error::msg)?;
        assert_ne!(
            refreshed_page_state.navigation_id,
            stale_page_state.navigation_id
        );

        let stale_click_rendered = execute_browser_chat_tool_call(
            parse_browser_chat_tool_call(
                "browser_click",
                &serde_json::json!({
                    "backendNodeId": stale_button.backend_node_id,
                    "navigationId": stale_page_state.navigation_id,
                }),
            )
            .unwrap()
            .unwrap(),
            &runtime,
        )
        .await;
        assert!(stale_click_rendered.contains(&format!(
            "ERROR: 点击backend_node_id {}失败:",
            stale_button.backend_node_id
        )));
        assert!(stale_click_rendered.contains("browser.page_state_stale"));
        assert!(stale_click_rendered.contains(&refreshed_page_state.navigation_id));

        let get_page_rendered =
            execute_browser_chat_tool_call(BrowserChatToolCall::GetPage, &runtime).await;
        assert!(get_page_rendered.contains(&format!(
            "\"navigation_id\": \"{}\"",
            refreshed_page_state.navigation_id
        )));

        Ok::<(), anyhow::Error>(())
    }
    .await;

    let harness_shutdown = harness.shutdown().await;
    let server_shutdown = server.shutdown().await;

    live_result?;
    harness_shutdown?;
    server_shutdown?;
    Ok(())
}

use super::test_support::*;

#[test]
fn legacy_browser_dispatch_and_batch_share_confirmation_policy() {
    let args = serde_json::json!({ "x": 1, "y": 1 });
    let mut request = build_legacy_tool_request(
        "browser_click".to_string(),
        args.to_string(),
        None,
        Some("policy-parity-browser-click".to_string()),
        None,
        Some(ToolExecutionSource::AssistantToolCall),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    );

    reject_legacy_execute_tool(&request.name, false)
        .expect("browser clicks remain on the legacy chat path");
    let preview = crate::tools::execution_policy::preview_request_policy(
        &request,
        &args,
        Some("policy-parity-session"),
    )
    .expect("batch policy preview should succeed");
    assert_eq!(preview.decision, "awaiting_confirmation");

    let without_approval = crate::tools::execution_policy::enforce_request_policy(
        &request,
        &args,
        Some("policy-parity-session"),
    )
    .expect_err("legacy dispatch must not bypass the shared confirmation gate");
    assert!(without_approval.to_string().contains("approval"));

    request.approval_token = preview.approval_token;
    crate::tools::execution_policy::enforce_request_policy(
        &request,
        &args,
        Some("policy-parity-session"),
    )
    .expect("the exact preview approval should authorize batch execution");
}
