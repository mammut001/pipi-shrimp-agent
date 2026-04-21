use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::common::{ActionContext, ActionResult, BrowserAction, BrowserActionError};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ScrollInput {
    pub direction: String,
    pub pixels: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ScrollOutput {
    pub direction: String,
    pub pixels: i64,
}

pub struct ScrollAction;

#[async_trait]
impl BrowserAction for ScrollAction {
    type Input = ScrollInput;
    type Output = ScrollOutput;

    async fn execute(&self, ctx: &ActionContext, input: Self::Input) -> ActionResult<Self::Output> {
        let page = ctx.page().await?;
        let (dx, dy) = match input.direction.as_str() {
            "down" => (0, input.pixels),
            "up" => (0, -input.pixels),
            "right" => (input.pixels, 0),
            "left" => (-input.pixels, 0),
            other => {
                return Err(BrowserActionError::invalid_input(format!(
                    "Invalid scroll direction '{}'. Expected down/up/left/right.",
                    other
                )))
            }
        };

        let script = format!("window.scrollBy({}, {});", dx, dy);
        page.evaluate(script)
            .await
            .map_err(|error| BrowserActionError::execution_failed("browser.action_failed", error.to_string()))?;

        ctx.invalidate_page_state().await;
        Ok(ScrollOutput {
            direction: input.direction,
            pixels: input.pixels,
        })
    }
}

pub async fn scroll(ctx: &ActionContext, input: ScrollInput) -> ActionResult<ScrollOutput> {
    let detail = Some(format!("{} {}px", input.direction, input.pixels));
    ctx.run_instrumented("scroll", detail, ScrollAction.execute(ctx, input))
        .await
}