use async_trait::async_trait;
use base64::Engine;

use crate::browser::dom::ScreenshotRef;

use super::common::{ActionContext, ActionResult, BrowserAction, BrowserActionError};

pub type ScreenshotOutput = ScreenshotRef;

pub struct ScreenshotAction;

#[async_trait]
impl BrowserAction for ScreenshotAction {
    type Input = ();
    type Output = ScreenshotOutput;

    async fn execute(&self, ctx: &ActionContext, _input: Self::Input) -> ActionResult<Self::Output> {
        let page = ctx.page().await?;

        use chromiumoxide::cdp::browser_protocol::page::CaptureScreenshotFormat;
        use chromiumoxide::cdp::browser_protocol::page::CaptureScreenshotParams;

        let params = CaptureScreenshotParams::builder()
            .format(CaptureScreenshotFormat::Png)
            .build();

        let screenshot = page
            .execute(params)
            .await
            .map_err(|error| BrowserActionError::execution_failed("browser.action_failed", format!("Screenshot failed: {}", error)))?;

        Ok(ScreenshotRef {
            kind: "base64_png".to_string(),
            value: base64::engine::general_purpose::STANDARD.encode(&screenshot.data),
        })
    }
}

pub async fn screenshot(ctx: &ActionContext) -> ActionResult<ScreenshotOutput> {
    ctx.run_instrumented("screenshot", None, ScreenshotAction.execute(ctx, ()))
        .await
}