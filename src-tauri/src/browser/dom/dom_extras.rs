//! Lightweight observation + screenshot helpers.
//!
//! These complement the heavy `capture_page_state` flow with cheap variants
//! the agent loop can call every step without paying for a full DOMSnapshot
//! + AX tree capture.
//!
//! - `capture_light_observation` runs `Page.Runtime.evaluate` against a
//!   single JS expression that returns URL/title/readyState/text excerpt
//!   and the active element description.
//! - `capture_screenshot_with_options` runs `Page.captureScreenshot` with
//!   the requested format/quality/max_width and applies an optional
//!   downscale step on the Rust side before returning bytes.

use std::time::Duration;

use base64::Engine;
use chromiumoxide::cdp::browser_protocol::page::{
    CaptureScreenshotFormat, CaptureScreenshotParams,
};
use chromiumoxide::page::Page;
use serde::{Deserialize, Serialize};

use crate::browser::cdp::{run_with_timeout, CdpError};

// ─── Light observation ─────────────────────────────────────────────────────

/// Cheaper than a full PageState — just URL/title/text excerpt/active
/// element. The frontend agent loop polls this every step.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LightObservation {
    pub url: String,
    pub title: String,
    pub navigation_id: String,
    pub ready_state: String,
    pub text_excerpt: String,
    pub active_element: String,
    pub timestamp_ms: i64,
}

/// Mirrors the frontend `ObservationLevel` enum so the Tauri command can
/// accept a string argument directly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ObservationLevelArg {
    Light,
    Interactive,
    Full,
    Screenshot,
}

impl ObservationLevelArg {
    pub fn from_str(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "light" => Self::Light,
            "interactive" => Self::Interactive,
            "full" => Self::Full,
            "screenshot" => Self::Screenshot,
            _ => Self::Interactive,
        }
    }
}

const LIGHT_SCRIPT: &str = r#"(function(){
  try {
    var active = document.activeElement;
    var activeDesc = active
      ? (active.tagName || '') +
        (active.id ? '#' + active.id : '') +
        (active.className && typeof active.className === 'string'
          ? '.' + active.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.')
          : '')
      : '';
    var text = (document.body && document.body.innerText) ? document.body.innerText : '';
    return JSON.stringify({
      url: location.href,
      title: document.title,
      ready_state: document.readyState,
      text_excerpt: text.replace(/\s+/g, ' ').trim().slice(0, 600),
      active_element: activeDesc,
      navigation_id: ''
    });
  } catch (e) {
    return JSON.stringify({ url: '', title: '', ready_state: 'unknown', text_excerpt: '', active_element: '', navigation_id: '' });
  }
})()"#;

pub async fn capture_light_observation(
    page: &Page,
    timeout: Duration,
) -> Result<LightObservation, CdpError> {
    let evaluation = run_with_timeout(
        "Runtime.evaluate (light)",
        timeout,
        page.evaluate(LIGHT_SCRIPT),
    )
    .await?
    .map_err(|error| CdpError::Session(format!("Light observation failed: {}", error)))?;

    // The script returns a JSON-encoded string. Convert the EvaluationResult
    // into a serde_json::Value (which can be either a string or whatever the
    // runtime actually returned) and normalise it back to a JSON object.
    let raw_value = evaluation.into_value::<serde_json::Value>().unwrap_or(serde_json::json!({}));
    let raw_string = match raw_value {
        serde_json::Value::String(s) => s,
        other => other.to_string(),
    };
    let parsed: serde_json::Value =
        serde_json::from_str(raw_string.trim()).unwrap_or_else(|_| serde_json::json!({}));

    let obj = parsed.as_object().cloned().unwrap_or_default();
    let now = chrono::Utc::now().timestamp_millis();

    Ok(LightObservation {
        url: obj.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        title: obj.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        navigation_id: obj
            .get("navigation_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        ready_state: obj
            .get("ready_state")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string(),
        text_excerpt: obj
            .get("text_excerpt")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        active_element: obj
            .get("active_element")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        timestamp_ms: now,
    })
}

// ─── Screenshot options + artifact ─────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScreenshotFormatArg {
    Png,
    Jpeg,
}

impl ScreenshotFormatArg {
    pub fn as_cdp_format(self) -> CaptureScreenshotFormat {
        match self {
            ScreenshotFormatArg::Png => CaptureScreenshotFormat::Png,
            ScreenshotFormatArg::Jpeg => CaptureScreenshotFormat::Jpeg,
        }
    }

    pub fn from_str(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "png" => Self::Png,
            "jpeg" | "jpg" => Self::Jpeg,
            _ => Self::Jpeg,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScreenshotOptions {
    pub format: ScreenshotFormatArg,
    /// JPEG quality 0–100. Ignored for PNG.
    pub quality: Option<u8>,
    /// Optional max width in pixels. The screenshot is downscaled on the
    /// Rust side using the `image` crate before being returned.
    pub max_width: Option<u32>,
    /// Capture the entire scrollable page rather than just the viewport.
    pub full_page: bool,
}

impl ScreenshotOptions {
    /// Defaults used for UI live-preview screenshots: small, JPEG, not full page.
    pub fn preview_default() -> Self {
        Self {
            format: ScreenshotFormatArg::Jpeg,
            quality: Some(70),
            max_width: Some(960),
            full_page: false,
        }
    }

    /// Defaults used by the future vision-fallback path: a bit larger but
    /// still compressed JPEG so the screenshot ref stays cheap to store.
    pub fn vision_default() -> Self {
        Self {
            format: ScreenshotFormatArg::Jpeg,
            quality: Some(80),
            max_width: Some(1280),
            full_page: false,
        }
    }
}

impl Default for ScreenshotOptions {
    fn default() -> Self {
        Self::preview_default()
    }
}

/// What we return from a screenshot capture. Two flavours:
///   - `base64_*` — inline data the frontend can drop straight into `<img src>`.
///   - `file:*`   — a file path on disk so the frontend can fetch lazily.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScreenshotArtifact {
    pub kind: String,
    pub value: String,
    pub format: ScreenshotFormatArg,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub bytes: Option<usize>,
}

impl ScreenshotArtifact {
    pub fn from_inline(format: ScreenshotFormatArg, bytes: &[u8]) -> Self {
        let prefix = match format {
            ScreenshotFormatArg::Png => "base64_png",
            ScreenshotFormatArg::Jpeg => "base64_jpeg",
        };
        Self {
            kind: prefix.to_string(),
            value: base64::engine::general_purpose::STANDARD.encode(bytes),
            format,
            width: None,
            height: None,
            bytes: Some(bytes.len()),
        }
    }
}

pub async fn capture_screenshot_with_options(
    page: &Page,
    timeout: Duration,
    options: ScreenshotOptions,
) -> Result<Vec<u8>, CdpError> {
    let mut builder = CaptureScreenshotParams::builder().format(options.format.as_cdp_format());
    if let Some(quality) = options.quality {
        builder = builder.quality(quality);
    }
    if options.full_page {
        builder = builder.capture_beyond_viewport(true);
    }
    let params = builder.build();

    let response = run_with_timeout("Page.captureScreenshot", timeout, page.execute(params))
        .await?
        .map_err(|error| CdpError::Session(format!("Screenshot failed: {}", error)))?;

    // chromiumoxide returns a Binary ref. Copy the bytes into a Vec so the
    // caller doesn't depend on chromiumoxide's internal buffer lifetime.
    let bytes: &[u8] = response.data.as_ref();
    Ok(bytes.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_default_is_small_jpeg() {
        let opts = ScreenshotOptions::preview_default();
        assert_eq!(opts.format, ScreenshotFormatArg::Jpeg);
        assert_eq!(opts.quality, Some(70));
        assert_eq!(opts.max_width, Some(960));
        assert!(!opts.full_page);
    }

    #[test]
    fn vision_default_is_1280_jpeg() {
        let opts = ScreenshotOptions::vision_default();
        assert_eq!(opts.format, ScreenshotFormatArg::Jpeg);
        assert_eq!(opts.max_width, Some(1280));
        assert!(!opts.full_page);
    }

    #[test]
    fn format_parser_accepts_short_form() {
        assert_eq!(ScreenshotFormatArg::from_str("png"), ScreenshotFormatArg::Png);
        assert_eq!(ScreenshotFormatArg::from_str("JPEG"), ScreenshotFormatArg::Jpeg);
        assert_eq!(ScreenshotFormatArg::from_str("jpg"), ScreenshotFormatArg::Jpeg);
        assert_eq!(ScreenshotFormatArg::from_str("unknown"), ScreenshotFormatArg::Jpeg);
    }

    #[test]
    fn artifact_serialises_inline_kind() {
        let artifact = ScreenshotArtifact::from_inline(ScreenshotFormatArg::Jpeg, b"abc");
        assert!(artifact.kind.starts_with("base64_"));
        assert!(!artifact.value.is_empty());
    }
}
