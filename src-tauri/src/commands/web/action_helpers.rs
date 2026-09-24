//! Shared browser action helpers for `commands::web` (AG-10 mechanical extract).
//!
//! Moved verbatim from `web.rs`; used by the command wrappers in `web.rs`,
//! `web/cdp.rs` and the `web/tests.rs` live-action harness tests.
use super::BrowserController;
use crate::browser::actions::{
    self, ActionContext, ClickInput, ElementReference, NavigateInput, TypeTextInput, WaitInput,
};
use crate::browser::session::BrowserSessionManager;
use std::sync::Arc;
use tokio::sync::Mutex;

pub(super) async fn clone_manager_handle(
    state: &tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> Arc<Mutex<BrowserSessionManager>> {
    state.lock().await.manager.clone()
}

pub(super) async fn action_context(
    state: &tauri::State<'_, Arc<Mutex<BrowserController>>>,
) -> ActionContext {
    ActionContext::new(clone_manager_handle(state).await)
}

pub(super) fn action_result<T>(result: actions::ActionResult<T>) -> Result<T, String> {
    result.map_err(|error| error.to_string())
}

pub(super) async fn navigate_and_wait_with_ctx(
    ctx: &ActionContext,
    url: String,
    wait_selector: Option<String>,
) -> Result<String, String> {
    action_result(
        actions::navigate(
            ctx,
            NavigateInput {
                url: Some(url),
                wait_selector,
                timeout_ms: None,
            },
        )
        .await,
    )?;

    Ok("页面加载并渲染完全".to_string())
}

pub(super) async fn browser_wait_with_ctx(
    ctx: &ActionContext,
    seconds: Option<u64>,
    wait_selector: Option<String>,
) -> Result<String, String> {
    let output = action_result(
        actions::wait(
            ctx,
            WaitInput {
                seconds,
                wait_selector,
                timeout_ms: None,
            },
        )
        .await,
    )?;

    if output.selector_matched {
        Ok(format!(
            "等待完成，目标选择器已出现（{}ms）",
            output.waited_ms
        ))
    } else {
        Ok(format!("已等待 {} 秒", output.waited_ms / 1_000))
    }
}

pub(super) async fn browser_click_with_ctx(
    ctx: &ActionContext,
    element_id: Option<u64>,
    backend_node_id: Option<i64>,
    navigation_id: Option<String>,
) -> Result<String, String> {
    let output = action_result(
        actions::click(
            ctx,
            ClickInput {
                target: ElementReference {
                    index: element_id,
                    backend_node_id,
                    navigation_id,
                },
            },
        )
        .await,
    )?;

    Ok(format!(
        "点击成功: backend_node_id {}{}",
        output.backend_node_id,
        output
            .tag_name
            .as_ref()
            .map(|tag| format!(" <{}>", tag))
            .unwrap_or_default()
    ))
}

pub(super) async fn browser_type_with_ctx(
    ctx: &ActionContext,
    element_id: Option<u64>,
    backend_node_id: Option<i64>,
    navigation_id: Option<String>,
    text: String,
) -> Result<String, String> {
    let output = action_result(
        actions::type_text(
            ctx,
            TypeTextInput {
                target: ElementReference {
                    index: element_id,
                    backend_node_id,
                    navigation_id,
                },
                text,
            },
        )
        .await,
    )?;

    Ok(format!(
        "输入成功: backend_node_id {}，共 {} 个字符",
        output.backend_node_id, output.text_len
    ))
}
