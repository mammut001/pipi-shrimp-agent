use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::common::{ActionContext, ActionResult, ActionTimeoutPolicy, BrowserAction, BrowserActionError};
use super::wait::wait_for_selector;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct NavigateInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wait_selector: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NavigateOutput {
    pub current_url: Option<String>,
    pub title: Option<String>,
    pub waited_for_selector: bool,
}

pub struct NavigateAction;

#[async_trait]
impl BrowserAction for NavigateAction {
    type Input = NavigateInput;
    type Output = NavigateOutput;

    async fn execute(&self, ctx: &ActionContext, input: Self::Input) -> ActionResult<Self::Output> {
        let page = ctx.page().await?;
        let url = input
            .url
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);

        if let Some(url) = url.as_ref() {
            page.goto(url)
                .await
                .map_err(|error| BrowserActionError::navigation_failed(error.to_string()))?;
            page.wait_for_navigation()
                .await
                .map_err(|error| BrowserActionError::navigation_failed(error.to_string()))?;
        }

        let waited_for_selector = if let Some(selector) = input
            .wait_selector
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
        {
            wait_for_selector(
                &page,
                selector,
                input
                    .timeout_ms
                    .unwrap_or_else(|| ActionTimeoutPolicy::default().timeout_ms.min(10_000)),
            )
            .await?;
            true
        } else {
            false
        };

        ctx.refresh_connection_metadata().await?;
        ctx.invalidate_page_state().await;

        let title = page
            .evaluate("(function() { return document.title; })()")
            .await
            .ok()
            .and_then(|value| value.into_value::<String>().ok());

        let current_url = ctx
            .capture_page_state()
            .await
            .ok()
            .map(|page_state| page_state.url);

        Ok(NavigateOutput {
            current_url,
            title,
            waited_for_selector,
        })
    }
}

pub async fn navigate(ctx: &ActionContext, input: NavigateInput) -> ActionResult<NavigateOutput> {
    let detail = input
        .url
        .clone()
        .or_else(|| input.wait_selector.clone());
    let result = ctx
        .run_instrumented("navigate", detail, NavigateAction.execute(ctx, input))
        .await;

    if let Ok(output) = &result {
        ctx.record_navigation(output.title.clone(), output.current_url.clone())
            .await;
    }

    result
}