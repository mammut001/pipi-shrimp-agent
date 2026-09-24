use super::*;
use crate::browser::actions;
use crate::browser::actions::test_support::{CheckoutFlowServer, LiveActionHarness};
use crate::browser::dom::{InteractiveElement, PageState};
use anyhow::Result;

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
        .ok_or_else(|| {
            anyhow::anyhow!(
                "expected {} in live page state; elements={}",
                label,
                element_debug
            )
        })
}

async fn read_payment_status_text(harness: &LiveActionHarness) -> Result<String> {
    harness
        .page()
        .evaluate(
            "(function() { const node = document.querySelector('#payment-status'); return node ? node.textContent : ''; })()",
        )
        .await
        .map_err(anyhow::Error::from)?
        .into_value::<String>()
        .map_err(anyhow::Error::from)
}

async fn read_selector_text(harness: &LiveActionHarness, selector: &str) -> Result<String> {
    let script = format!(
        "(function() {{ const node = document.querySelector({selector:?}); return node ? node.textContent : ''; }})()",
    );
    harness
        .page()
        .evaluate(script)
        .await
        .map_err(anyhow::Error::from)?
        .into_value::<String>()
        .map_err(anyhow::Error::from)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires a local Chrome/Chromium binary for Chromiumoxide Browser::launch"]
async fn navigate_and_wait_and_browser_wait_wrappers_support_selector_flows() -> Result<()> {
    let server = CheckoutFlowServer::start().await?;
    let harness = LiveActionHarness::launch().await?;

    let wrapper_result = async {
        let navigate_message = navigate_and_wait_with_ctx(
            harness.ctx(),
            server.checkout_url(),
            Some("#page-ready.ready".to_string()),
        )
        .await
        .map_err(anyhow::Error::msg)?;
        assert_eq!(navigate_message, "页面加载并渲染完全");

        let wait_message =
            browser_wait_with_ctx(harness.ctx(), None, Some("#late-ready.ready".to_string()))
                .await
                .map_err(anyhow::Error::msg)?;
        assert!(wait_message.starts_with("等待完成，目标选择器已出现（"));
        assert!(wait_message.ends_with("ms）"));

        Ok::<(), anyhow::Error>(())
    }
    .await;

    let harness_shutdown = harness.shutdown().await;
    let server_shutdown = server.shutdown().await;

    wrapper_result?;
    harness_shutdown?;
    server_shutdown?;
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires a local Chrome/Chromium binary for Chromiumoxide Browser::launch"]
async fn browser_click_and_browser_type_wrappers_support_shadow_dom_targets() -> Result<()> {
    let server = CheckoutFlowServer::start().await?;
    let harness = LiveActionHarness::launch().await?;

    let wrapper_result = async {
        let navigate_message = navigate_and_wait_with_ctx(
            harness.ctx(),
            server.shadow_checkout_url(),
            Some("#page-ready.ready".to_string()),
        )
        .await
        .map_err(anyhow::Error::msg)?;
        assert_eq!(navigate_message, "页面加载并渲染完全");

        let page_state = actions::get_page_state(harness.ctx())
            .await
            .map_err(anyhow::Error::msg)?;
        let navigation_id = page_state.navigation_id.clone();
        let shadow_input = find_live_element(&page_state, "shadow iframe input", |element| {
            element.frame_id != "root"
                && element.is_editable
                && element.selector_hint.as_deref() == Some("#shadow-card-number")
        })?;
        let shadow_button =
            find_live_element(&page_state, "shadow iframe button", |element| {
                element.frame_id != "root"
                    && element.is_clickable
                    && element.tag_name.as_deref() == Some("button")
                    && element.selector_hint.as_deref() == Some("#shadow-confirm-payment")
            })?;

        let typed_value = "1010 2020 3030 4040".to_string();
        let type_message = browser_type_with_ctx(
            harness.ctx(),
            Some(shadow_input.index as u64),
            Some(shadow_input.backend_node_id),
            Some(navigation_id.clone()),
            typed_value.clone(),
        )
        .await
        .map_err(anyhow::Error::msg)?;
        assert_eq!(
            type_message,
            format!(
                "输入成功: backend_node_id {}，共 {} 个字符",
                shadow_input.backend_node_id,
                typed_value.chars().count()
            )
        );

        let click_message = browser_click_with_ctx(
            harness.ctx(),
            Some(shadow_button.index as u64),
            Some(shadow_button.backend_node_id),
            Some(navigation_id),
        )
        .await
        .map_err(anyhow::Error::msg)?;
        assert_eq!(
            click_message,
            format!(
                "点击成功: backend_node_id {} <BUTTON>",
                shadow_button.backend_node_id
            )
        );

        let wait_message = browser_wait_with_ctx(
            harness.ctx(),
            None,
            Some("#payment-status.ready".to_string()),
        )
        .await
        .map_err(anyhow::Error::msg)?;
        assert!(wait_message.starts_with("等待完成，目标选择器已出现（"));

        let status_text = read_payment_status_text(&harness).await?;
        assert!(status_text.contains("confirmed:"));
        assert!(status_text.contains("1010"));

        Ok::<(), anyhow::Error>(())
    }
    .await;

    let harness_shutdown = harness.shutdown().await;
    let server_shutdown = server.shutdown().await;

    wrapper_result?;
    harness_shutdown?;
    server_shutdown?;
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires a local Chrome/Chromium binary for Chromiumoxide Browser::launch"]
async fn browser_wrappers_preserve_root_actions_when_cross_frame_partial_warning_exists(
) -> Result<()> {
    let server = CheckoutFlowServer::start().await?;
    let harness = LiveActionHarness::launch_site_isolated().await?;

    let wrapper_result = async {
        let navigate_message = navigate_and_wait_with_ctx(
            harness.ctx(),
            server.partial_warning_checkout_url(),
            Some("#frame-ready.ready".to_string()),
        )
        .await
        .map_err(anyhow::Error::msg)?;
        assert_eq!(navigate_message, "页面加载并渲染完全");

        let page_state = actions::get_page_state(harness.ctx())
            .await
            .map_err(anyhow::Error::msg)?;
        assert!(page_state
            .warnings
            .contains(&"cross_origin_iframe_partial".to_string()));
        assert!(!page_state
            .warnings
            .contains(&"closed_shadow_root_partial".to_string()));

        let root_button =
            find_live_element(&page_state, "partial warning root button", |element| {
                element.is_clickable
                    && element.selector_hint.as_deref() == Some("#warning-root-action")
            })?;

        let click_message = browser_click_with_ctx(
            harness.ctx(),
            Some(root_button.index as u64),
            Some(root_button.backend_node_id),
            Some(page_state.navigation_id.clone()),
        )
        .await
        .map_err(anyhow::Error::msg)?;
        assert_eq!(
            click_message,
            format!(
                "点击成功: backend_node_id {} <BUTTON>",
                root_button.backend_node_id
            )
        );

        let wait_message = browser_wait_with_ctx(
            harness.ctx(),
            None,
            Some("#warning-status.ready".to_string()),
        )
        .await
        .map_err(anyhow::Error::msg)?;
        assert!(wait_message.starts_with("等待完成，目标选择器已出现（"));

        let status_text = read_selector_text(&harness, "#warning-status").await?;
        assert_eq!(status_text, "support-opened");

        Ok::<(), anyhow::Error>(())
    }
    .await;

    let harness_shutdown = harness.shutdown().await;
    let server_shutdown = server.shutdown().await;

    wrapper_result?;
    harness_shutdown?;
    server_shutdown?;
    Ok(())
}

#[test]
fn test_linux_chrome_debug_args_includes_sandbox_and_debug_flags() {
    let profile = "/home/user/.config/pipi-shrimp/chrome-debug-profile";
    let args = super::cdp::linux_chrome_debug_args(profile);
    assert!(args.contains(&"--remote-debugging-port=9222".to_string()));
    assert!(args.contains(&"--remote-debugging-address=127.0.0.1".to_string()));
    assert!(args.contains(&format!("--user-data-dir={}", profile)));
    assert!(args.contains(&"--no-first-run".to_string()));
    assert!(args.contains(&"--no-default-browser-check".to_string()));
    assert!(args.contains(&"--no-sandbox".to_string()));
    assert!(args.contains(&"--disable-dev-shm-usage".to_string()));
    assert!(args.contains(&"--enable-unsafe-swiftshader".to_string()));
    assert_eq!(args.last().map(|s| s.as_str()), Some("about:blank"));
}
