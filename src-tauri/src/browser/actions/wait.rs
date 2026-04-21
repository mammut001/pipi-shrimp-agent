use std::time::Instant;

use async_trait::async_trait;
use chromiumoxide::page::Page;
use serde::{Deserialize, Serialize};

use super::common::{
    ActionContext, ActionResult, ActionTimeoutPolicy, BrowserAction, BrowserActionError,
};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct WaitInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seconds: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wait_selector: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WaitOutput {
    pub waited_ms: u64,
    pub selector_matched: bool,
}

pub struct WaitAction;

pub(crate) async fn wait_for_selector(page: &Page, selector: &str, timeout_ms: u64) -> ActionResult<u64> {
    let started_at = Instant::now();
    loop {
        if page.find_element(selector).await.is_ok() {
            return Ok(started_at.elapsed().as_millis() as u64);
        }

        if started_at.elapsed().as_millis() as u64 >= timeout_ms {
            return Err(BrowserActionError::timeout(format!(
                "Timed out waiting for selector '{}' after {}ms.",
                selector, timeout_ms
            )));
        }

        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
}

#[async_trait]
impl BrowserAction for WaitAction {
    type Input = WaitInput;
    type Output = WaitOutput;

    async fn execute(&self, ctx: &ActionContext, input: Self::Input) -> ActionResult<Self::Output> {
        let page = ctx.page().await?;

        if let Some(selector) = input
            .wait_selector
            .as_ref()
            .map(|selector| selector.trim())
            .filter(|selector| !selector.is_empty())
        {
            let timeout_ms = input
                .timeout_ms
                .unwrap_or_else(|| ActionTimeoutPolicy::default().timeout_ms.min(10_000));
            let waited_ms = wait_for_selector(&page, selector, timeout_ms).await?;
            return Ok(WaitOutput {
                waited_ms,
                selector_matched: true,
            });
        }

        let seconds = input.seconds.unwrap_or(2).min(10);
        tokio::time::sleep(std::time::Duration::from_secs(seconds)).await;
        Ok(WaitOutput {
            waited_ms: seconds * 1_000,
            selector_matched: false,
        })
    }
}

pub async fn wait(ctx: &ActionContext, input: WaitInput) -> ActionResult<WaitOutput> {
    let detail = input
        .wait_selector
        .clone()
        .or_else(|| input.seconds.map(|seconds| format!("{}s", seconds)));
    ctx.run_instrumented("wait", detail, WaitAction.execute(ctx, input))
        .await
}