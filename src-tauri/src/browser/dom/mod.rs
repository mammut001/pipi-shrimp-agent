pub mod accessibility;
pub mod interactive;
pub mod merge;
pub mod page_state;
pub mod snapshot;

use std::time::Duration;

use base64::Engine;
use chromiumoxide::cdp::browser_protocol::page::{CaptureScreenshotFormat, CaptureScreenshotParams};
use chromiumoxide::page::Page;

use crate::browser::cdp::{run_with_timeout, CdpError};

pub use page_state::{InteractiveElement, PageState, PageViewport, ScreenshotRef};
pub(crate) use page_state::{PageStateCacheMetadata, PageStateCapture};
pub use snapshot::{
    AccessibilityNodeSnapshot, CapturedPageSnapshot, DomNodeSnapshot, SnapshotFrame,
    SnapshotViewport,
};

use snapshot::{CdpPageSnapshotSource, StablePageSnapshotSource};

pub async fn capture_page_state(page: &Page, timeout: Duration) -> Result<PageState, CdpError> {
    Ok(capture_page_state_capture(page, timeout).await?.page_state)
}

pub(crate) async fn capture_page_state_capture(
    page: &Page,
    timeout: Duration,
) -> Result<PageStateCapture, CdpError> {
    let source = CdpPageSnapshotSource::new(timeout);
    let mut capture = capture_page_state_capture_with_source(page, &source).await?;

    match capture_page_screenshot(page, timeout).await {
        Ok(screenshot) => {
            capture.page_state.screenshot = Some(screenshot);
        }
        Err(error) => {
            capture
                .page_state
                .warnings
                .push(format!("screenshot_unavailable: {}", error));
        }
    }

    Ok(capture)
}

pub async fn capture_page_state_with_source<S>(
    page: &Page,
    source: &S,
) -> Result<PageState, CdpError>
where
    S: StablePageSnapshotSource + Sync,
{
    Ok(capture_page_state_capture_with_source(page, source).await?.page_state)
}

pub(crate) async fn capture_page_state_capture_with_source<S>(
    page: &Page,
    source: &S,
) -> Result<PageStateCapture, CdpError>
where
    S: StablePageSnapshotSource + Sync,
{
    let snapshot = source.capture(page).await?;
    Ok(page_state::build_page_state_capture(snapshot))
}

pub fn build_page_state_from_snapshot(snapshot: CapturedPageSnapshot) -> PageState {
    page_state::build_page_state(snapshot)
}

async fn capture_page_screenshot(page: &Page, timeout: Duration) -> Result<ScreenshotRef, CdpError> {
    let params = CaptureScreenshotParams::builder()
        .format(CaptureScreenshotFormat::Png)
        .build();

    let screenshot = run_with_timeout(
        "Page.captureScreenshot",
        timeout,
        page.execute(params),
    )
    .await?
    .map_err(|error| CdpError::Session(format!("Unable to capture page screenshot: {}", error)))?;

    Ok(ScreenshotRef {
        kind: "base64_png".to_string(),
        value: base64::engine::general_purpose::STANDARD.encode(&screenshot.data),
    })
}