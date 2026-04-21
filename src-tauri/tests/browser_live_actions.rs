use std::time::Duration;

use anyhow::{Context, Result};
use tokio::time::timeout;

use pipi_shrimp_agent::browser::actions::{
    click, get_page_state, navigate, type_text, wait, ClickInput, ElementReference,
    NavigateInput, TypeTextInput, WaitInput,
};
use pipi_shrimp_agent::browser::dom::{InteractiveElement, PageState};
use pipi_shrimp_agent::browser::actions::test_support::{CheckoutFlowServer, LiveActionHarness};

fn action_result<T>(result: pipi_shrimp_agent::browser::actions::ActionResult<T>) -> Result<T> {
    result.map_err(|error| anyhow::anyhow!(error.to_string()))
}

fn find_live_element<F>(
    page_state: &PageState,
    label: &str,
    predicate: F,
) -> Result<InteractiveElement>
where
    F: Fn(&InteractiveElement) -> bool,
{
    let element_debug = serde_json::to_string_pretty(&page_state.elements)
        .unwrap_or_else(|_| format!("{:?}", page_state.elements));

    page_state
        .elements
        .iter()
        .find(|element| predicate(element))
        .cloned()
        .with_context(|| format!("expected {} in live page state; elements={}", label, element_debug))
}

async fn run_checkout_flow(
    harness: &LiveActionHarness,
    checkout_url: String,
    expected_title: &str,
    input_selector_hint: &str,
    button_selector_hint: &str,
    typed_value: &str,
) -> Result<String> {
    let navigate_output = action_result(navigate(
        harness.ctx(),
        NavigateInput {
            url: Some(checkout_url),
            wait_selector: Some("#page-ready.ready".to_string()),
            timeout_ms: Some(5_000),
        },
    )
    .await)?;

    assert!(navigate_output.waited_for_selector);
    assert_eq!(navigate_output.title.as_deref(), Some(expected_title));

    let page_state = action_result(get_page_state(harness.ctx()).await)?;
    assert!(page_state.frame_count >= 2);

    complete_checkout_flow_from_page_state(
        harness,
        &page_state,
        input_selector_hint,
        button_selector_hint,
        typed_value,
    )
    .await
}

async fn complete_checkout_flow_from_page_state(
    harness: &LiveActionHarness,
    page_state: &PageState,
    input_selector_hint: &str,
    button_selector_hint: &str,
    typed_value: &str,
) -> Result<String> {

    let navigation_id = page_state.navigation_id.clone();
    let iframe_input = find_live_element(&page_state, "iframe input element", |element| {
        element.frame_id != "root"
            && element.is_editable
            && element.selector_hint.as_deref() == Some(input_selector_hint)
    })?;
    let iframe_button = find_live_element(&page_state, "iframe confirmation button", |element| {
        element.frame_id != "root"
            && element.is_clickable
            && element.tag_name.as_deref() == Some("button")
            && element.selector_hint.as_deref() == Some(button_selector_hint)
    })?;

    let type_output = action_result(type_text(
        harness.ctx(),
        TypeTextInput {
            target: ElementReference {
                index: Some(iframe_input.index as u64),
                backend_node_id: Some(iframe_input.backend_node_id),
                navigation_id: Some(navigation_id.clone()),
            },
            text: typed_value.to_string(),
        },
    )
    .await)?;
    assert_eq!(type_output.backend_node_id, iframe_input.backend_node_id);

    let click_output = action_result(click(
        harness.ctx(),
        ClickInput {
            target: ElementReference {
                index: Some(iframe_button.index as u64),
                backend_node_id: Some(iframe_button.backend_node_id),
                navigation_id: Some(navigation_id),
            },
        },
    )
    .await)?;
    assert_eq!(click_output.backend_node_id, iframe_button.backend_node_id);

    let wait_output = action_result(wait(
        harness.ctx(),
        WaitInput {
            seconds: None,
            wait_selector: Some("#payment-status.ready".to_string()),
            timeout_ms: Some(5_000),
        },
    )
    .await)?;
    assert!(wait_output.selector_matched);

    harness
        .page()
        .evaluate(
            "(function() { const node = document.querySelector('#payment-status'); return node ? node.textContent : ''; })()",
        )
        .await
        .context("failed to read live payment status")?
        .into_value::<String>()
        .context("failed to decode live payment status value")
}

async fn read_selector_text(harness: &LiveActionHarness, selector: &str) -> Result<String> {
    let script = format!(
        "(function() {{ const node = document.querySelector({selector:?}); return node ? node.textContent : ''; }})()",
    );
    harness
        .page()
        .evaluate(script)
        .await
        .context("failed to read selector text from live page")?
        .into_value::<String>()
        .context("failed to decode selector text value")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires a local Chrome/Chromium binary for Chromiumoxide Browser::launch"]
async fn live_browser_handles_navigate_wait_and_iframe_click_type_happy_path() -> Result<()> {
    let server = CheckoutFlowServer::start().await?;
    let harness = LiveActionHarness::launch().await?;

    let flow_result = run_checkout_flow(
        &harness,
        server.checkout_url(),
        "Checkout Flow",
        "#card-number",
        "#confirm-payment",
        "4242 4242 4242 4242",
    )
    .await;
    let harness_shutdown = harness.shutdown().await;
    let server_shutdown = server.shutdown().await;

    let status_text = flow_result?;
    harness_shutdown?;
    server_shutdown?;
    assert!(status_text.contains("confirmed:"));
    assert!(status_text.contains("4242"));
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires a local Chrome/Chromium binary for Chromiumoxide Browser::launch"]
async fn live_browser_handles_iframe_shadow_dom_click_type_happy_path() -> Result<()> {
    let server = CheckoutFlowServer::start().await?;
    let harness = LiveActionHarness::launch().await?;

    let flow_result = run_checkout_flow(
        &harness,
        server.shadow_checkout_url(),
        "Shadow Checkout Flow",
        "#shadow-card-number",
        "#shadow-confirm-payment",
        "5555 6666 7777 8888",
    )
    .await;
    let harness_shutdown = harness.shutdown().await;
    let server_shutdown = server.shutdown().await;

    let status_text = flow_result?;
    harness_shutdown?;
    server_shutdown?;
    assert!(status_text.contains("confirmed:"));
    assert!(status_text.contains("5555"));
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires a local Chrome/Chromium binary for Chromiumoxide Browser::launch"]
async fn live_browser_recovers_shadow_dom_targets_after_navigation_refresh() -> Result<()> {
    let server = CheckoutFlowServer::start().await?;
    let harness = LiveActionHarness::launch().await?;

    let recovery_result = async {
        let navigate_output = action_result(navigate(
            harness.ctx(),
            NavigateInput {
                url: Some(server.shadow_checkout_url()),
                wait_selector: Some("#page-ready.ready".to_string()),
                timeout_ms: Some(5_000),
            },
        )
        .await)?;

        assert!(navigate_output.waited_for_selector);
        assert_eq!(navigate_output.title.as_deref(), Some("Shadow Checkout Flow"));

        let initial_page_state = action_result(get_page_state(harness.ctx()).await)?;
        let initial_navigation_id = initial_page_state.navigation_id.clone();
        let initial_shadow_button = find_live_element(
            &initial_page_state,
            "shadow confirmation button before refresh",
            |element| {
                element.frame_id != "root"
                    && element.is_clickable
                    && element.tag_name.as_deref() == Some("button")
                    && element.selector_hint.as_deref() == Some("#shadow-confirm-payment")
            },
        )?;

        harness
            .page()
            .reload()
            .await
            .context("failed to reload shadow checkout page")?;

        let reload_wait = action_result(wait(
            harness.ctx(),
            WaitInput {
                seconds: None,
                wait_selector: Some("#page-ready.ready".to_string()),
                timeout_ms: Some(5_000),
            },
        )
        .await)?;
        assert!(reload_wait.selector_matched);

        let refreshed_page_state = action_result(get_page_state(harness.ctx()).await)?;
        assert_ne!(refreshed_page_state.navigation_id, initial_navigation_id);

        let stale_error = click(
            harness.ctx(),
            ClickInput {
                target: ElementReference {
                    index: Some(initial_shadow_button.index as u64),
                    backend_node_id: Some(initial_shadow_button.backend_node_id),
                    navigation_id: Some(initial_navigation_id),
                },
            },
        )
        .await
        .expect_err("old shadow target should become stale after refresh");

        assert_eq!(stale_error.code, "browser.page_state_stale");
        assert!(stale_error.recoverable);
        assert!(stale_error
            .message
            .contains(&refreshed_page_state.navigation_id));

        let status_text = complete_checkout_flow_from_page_state(
            &harness,
            &refreshed_page_state,
            "#shadow-card-number",
            "#shadow-confirm-payment",
            "1234 5678 9000 0000",
        )
        .await?;

        Ok::<String, anyhow::Error>(status_text)
    }
    .await;

    let harness_shutdown = harness.shutdown().await;
    let server_shutdown = server.shutdown().await;

    let status_text = recovery_result?;
    harness_shutdown?;
    server_shutdown?;
    assert!(status_text.contains("confirmed:"));
    assert!(status_text.contains("1234"));
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires a local Chrome/Chromium binary for Chromiumoxide Browser::launch"]
async fn live_browser_preserves_root_actions_when_cross_frame_partial_warning_exists() -> Result<()> {
    let server = CheckoutFlowServer::start().await?;
    let harness = LiveActionHarness::launch_site_isolated().await?;

    let flow_result = async {
        let navigate_output = action_result(navigate(
            harness.ctx(),
            NavigateInput {
                url: Some(server.partial_warning_checkout_url()),
                wait_selector: Some("#frame-ready.ready".to_string()),
                timeout_ms: Some(5_000),
            },
        )
        .await)?;

        assert!(navigate_output.waited_for_selector);
        assert_eq!(navigate_output.title.as_deref(), Some("Partial Warning Checkout"));

        let page_state = action_result(get_page_state(harness.ctx()).await)?;
        assert!(page_state
            .warnings
            .contains(&"cross_origin_iframe_partial".to_string()));
        assert!(!page_state
            .warnings
            .contains(&"closed_shadow_root_partial".to_string()));

        let root_button = find_live_element(&page_state, "root warning action button", |element| {
            element.is_clickable
                && element.selector_hint.as_deref() == Some("#warning-root-action")
        })?;

        let click_output = action_result(click(
            harness.ctx(),
            ClickInput {
                target: ElementReference {
                    index: Some(root_button.index as u64),
                    backend_node_id: Some(root_button.backend_node_id),
                    navigation_id: Some(page_state.navigation_id.clone()),
                },
            },
        )
        .await)?;
        assert_eq!(click_output.backend_node_id, root_button.backend_node_id);

        let wait_output = action_result(wait(
            harness.ctx(),
            WaitInput {
                seconds: None,
                wait_selector: Some("#warning-status.ready".to_string()),
                timeout_ms: Some(5_000),
            },
        )
        .await)?;
        assert!(wait_output.selector_matched);

        read_selector_text(&harness, "#warning-status").await
    }
    .await;

    let harness_shutdown = harness.shutdown().await;
    let server_shutdown = server.shutdown().await;

    let status_text = flow_result?;
    harness_shutdown?;
    server_shutdown?;
    assert_eq!(status_text, "support-opened");
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires a local Chrome/Chromium binary for Chromiumoxide Browser::launch"]
async fn live_browser_invalidates_snapshot_cache_from_direct_cdp_navigation_events() -> Result<()> {
    let server = CheckoutFlowServer::start().await?;
    let harness = LiveActionHarness::launch().await?;

    let invalidation_result = async {
        harness.start_background_workers().await;

        let navigate_output = action_result(navigate(
            harness.ctx(),
            NavigateInput {
                url: Some(server.dom_rewrite_url()),
                wait_selector: Some("#page-ready.ready".to_string()),
                timeout_ms: Some(5_000),
            },
        )
        .await)?;
        assert!(navigate_output.waited_for_selector);

        let manager = harness.manager();
        {
            let mut manager_guard = manager.lock().await;
            let seeded_page_state = manager_guard
                .capture_page_state()
                .await
                .context("failed to capture page state to seed snapshot cache")?;
            assert_eq!(
                manager_guard
                    .cached_page_state()
                    .as_ref()
                    .map(|page_state| page_state.navigation_id.as_str()),
                Some(seeded_page_state.navigation_id.as_str())
            );
        }

        harness
            .page()
            .goto(server.shadow_checkout_url().as_str())
            .await
            .context("failed to navigate live page directly")?;
        harness
            .page()
            .wait_for_navigation()
            .await
            .context("failed waiting for direct live navigation")?;

        timeout(Duration::from_secs(5), async {
            loop {
                let cache_invalidated = {
                    let manager_guard = manager.lock().await;
                    manager_guard.cached_page_state().is_none()
                };

                if cache_invalidated {
                    break;
                }

                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        })
        .await
        .context("timed out waiting for CDP runtime events to invalidate cached page state")?;

        let observability = manager.lock().await.observability_snapshot();
        assert_eq!(observability.snapshot_cache.invalidation_count, 1);
        assert_eq!(observability.snapshot_cache.active_key, None);
        assert!(observability.snapshot_cache.entries.iter().any(|entry| {
            entry
                .invalidation_reason
                .as_deref()
                .map(|reason| reason.starts_with("cdp_"))
                .unwrap_or(false)
        }));

        Ok::<(), anyhow::Error>(())
    }
    .await;

    let harness_shutdown = harness.shutdown().await;
    let server_shutdown = server.shutdown().await;

    invalidation_result?;
    harness_shutdown?;
    server_shutdown?;
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires a local Chrome/Chromium binary for Chromiumoxide Browser::launch"]
async fn live_browser_invalidates_snapshot_cache_from_dom_document_updated_events() -> Result<()> {
    let server = CheckoutFlowServer::start().await?;
    let harness = LiveActionHarness::launch().await?;

    let invalidation_result = async {
        harness.start_background_workers().await;

        let navigate_output = action_result(navigate(
            harness.ctx(),
            NavigateInput {
                url: Some(server.checkout_url()),
                wait_selector: Some("#page-ready.ready".to_string()),
                timeout_ms: Some(5_000),
            },
        )
        .await)?;
        assert!(navigate_output.waited_for_selector);

        let manager = harness.manager();
        {
            let mut manager_guard = manager.lock().await;
            let seeded_page_state = manager_guard
                .capture_page_state()
                .await
                .context("failed to capture page state before DOM rewrite")?;
            assert_eq!(
                manager_guard
                    .cached_page_state()
                    .as_ref()
                    .map(|page_state| page_state.navigation_id.as_str()),
                Some(seeded_page_state.navigation_id.as_str())
            );
        }

        let rewrite_status = harness
            .page()
            .evaluate(
                r#"(function() {
                                        document.open();
                                        document.write(`<!doctype html>
                                            <html>
                                                <head>
                                                    <meta charset="utf-8" />
                                                    <title>Rewritten Checkout Flow</title>
                                                </head>
                                                <body>
                                                    <div id="page-ready" class="ready">rewritten</div>
                                                    <div id="payment-status">rewritten-no-navigation</div>
                                                    <button id="rewritten-action">Continue</button>
                                                </body>
                                            </html>`);
                                        document.close();
                    return document.querySelector('#payment-status')?.textContent || '';
                })()"#,
            )
            .await
            .context("failed to rewrite live page document")?
            .into_value::<String>()
            .context("failed to decode rewritten DOM marker")?;
        assert_eq!(rewrite_status, "rewritten-no-navigation");

        timeout(Duration::from_secs(5), async {
            loop {
                let cache_invalidated = {
                    let manager_guard = manager.lock().await;
                    manager_guard.cached_page_state().is_none()
                };

                if cache_invalidated {
                    break;
                }

                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        })
        .await
        .context("timed out waiting for DOM.documentUpdated to invalidate cached page state")?;

        let observability = manager.lock().await.observability_snapshot();
        let invalidation_reasons: Vec<_> = observability
            .snapshot_cache
            .entries
            .iter()
            .map(|entry| entry.invalidation_reason.clone())
            .collect();
        assert_eq!(observability.snapshot_cache.invalidation_count, 1);
        assert_eq!(observability.snapshot_cache.active_key, None);
        assert!(
            observability.snapshot_cache.entries.iter().any(|entry| {
                entry.invalidation_reason.as_deref() == Some("cdp_dom_document_updated")
            }),
            "expected cdp_dom_document_updated invalidation, got {:?}",
            invalidation_reasons
        );

        Ok::<(), anyhow::Error>(())
    }
    .await;

    let harness_shutdown = harness.shutdown().await;
    let server_shutdown = server.shutdown().await;

    invalidation_result?;
    harness_shutdown?;
    server_shutdown?;
    Ok(())
}