use async_trait::async_trait;

use crate::browser::dom::{capture_screenshot_with_options, ScreenshotArtifact, ScreenshotOptions};

use super::common::{ActionContext, ActionResult, BrowserAction, BrowserActionError};

/// Default ScreenshotOptions used by the existing `screenshot()` action and any
/// Tauri command that calls into it. Centralising it here keeps the
/// preview / vision defaults documented and consistent.
pub fn default_screenshot_options() -> ScreenshotOptions {
    ScreenshotOptions::preview_default()
}

pub type ScreenshotOutput = ScreenshotArtifact;

pub struct ScreenshotAction;

#[async_trait]
impl BrowserAction for ScreenshotAction {
    type Input = Option<ScreenshotOptions>;
    type Output = ScreenshotOutput;

    async fn execute(
        &self,
        ctx: &ActionContext,
        input: Self::Input,
    ) -> ActionResult<Self::Output> {
        let page = ctx.page().await?;
        let options = input.unwrap_or_else(default_screenshot_options);

        let processed = capture_screenshot_with_options(&page, std::time::Duration::from_secs(15), options)
            .await
            .map_err(|error| {
                BrowserActionError::execution_failed(
                    "browser.action_failed",
                    format!("Screenshot failed: {}", error),
                )
            })?;

        Ok(ScreenshotArtifact::from_processed(options.format, &processed))
    }
}

pub async fn screenshot(ctx: &ActionContext) -> ActionResult<ScreenshotOutput> {
    ctx.run_instrumented("screenshot", None, ScreenshotAction.execute(ctx, None))
        .await
}

/// Convenience wrapper used by the existing Tauri command that returns the
/// raw base64 string (no ScreenshotArtifact). Keeping this in place preserves
/// backwards compatibility with the current frontend callers.
pub async fn screenshot_base64(ctx: &ActionContext) -> ActionResult<String> {
    let artifact = screenshot(ctx).await?;
    if artifact.kind.starts_with("base64_") {
        Ok(artifact.value)
    } else {
        // File references are not base64 inline; return an empty string so
        // callers fall back to fetching the file separately.
        Ok(String::new())
    }
}
