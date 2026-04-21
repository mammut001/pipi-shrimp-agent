pub mod accessibility;
pub mod interactive;
pub mod merge;
pub mod page_state;
pub mod snapshot;

use std::time::Duration;

use chromiumoxide::page::Page;

use crate::browser::cdp::CdpError;

pub use page_state::{InteractiveElement, PageState, ScreenshotRef};
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
    capture_page_state_capture_with_source(page, &source).await
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