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

    pub fn from_processed(format: ScreenshotFormatArg, processed: &ProcessedScreenshot) -> Self {
        let prefix = match format {
            ScreenshotFormatArg::Png => "base64_png",
            ScreenshotFormatArg::Jpeg => "base64_jpeg",
        };
        Self {
            kind: prefix.to_string(),
            value: base64::engine::general_purpose::STANDARD.encode(&processed.bytes),
            format,
            width: Some(processed.width),
            height: Some(processed.height),
            bytes: Some(processed.bytes.len()),
        }
    }
}

/// Result of processing a screenshot through the optional resize pipeline.
/// Carries the final image bytes together with the actual pixel dimensions
/// so callers don't need to re-decode just to read width/height.
#[derive(Debug, Clone)]
pub struct ProcessedScreenshot {
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

pub async fn capture_screenshot_with_options(
    page: &Page,
    timeout: Duration,
    options: ScreenshotOptions,
) -> Result<ProcessedScreenshot, CdpError> {
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
    let raw_bytes: &[u8] = response.data.as_ref();

    // Apply optional max_width resize using the `image` crate.
    if let Some(max_width) = options.max_width {
        resize_screenshot(raw_bytes, max_width, options.format, options.quality)
    } else {
        // No resize needed — decode once to populate width/height.
        let (w, h) = match image::load_from_memory(raw_bytes) {
            Ok(img) => (img.width(), img.height()),
            Err(_) => (0, 0),
        };
        Ok(ProcessedScreenshot {
            bytes: raw_bytes.to_vec(),
            width: w,
            height: h,
        })
    }
}

/// Decode `raw_bytes`, resize to fit within `max_width` preserving aspect
/// ratio, then re-encode in the target format.
fn resize_screenshot(
    raw_bytes: &[u8],
    max_width: u32,
    format: ScreenshotFormatArg,
    quality: Option<u8>,
) -> Result<ProcessedScreenshot, CdpError> {
    let img = image::load_from_memory(raw_bytes)
        .map_err(|error| CdpError::Session(format!("Failed to decode screenshot: {}", error)))?;

    let (orig_w, orig_h) = (img.width(), img.height());

    if orig_w <= max_width {
        // Already within budget — return the original bytes.
        return Ok(ProcessedScreenshot {
            bytes: raw_bytes.to_vec(),
            width: orig_w,
            height: orig_h,
        });
    }

    let scale = max_width as f64 / orig_w as f64;
    let new_height = (orig_h as f64 * scale).round().max(1.0) as u32;
    let resized = img.resize(max_width, new_height, image::imageops::FilterType::Lanczos3);

    let mut out = std::io::Cursor::new(Vec::new());
    match format {
        ScreenshotFormatArg::Jpeg => {
            let q = quality.unwrap_or(70);
            let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, q);
            resized
                .write_with_encoder(encoder)
                .map_err(|error| CdpError::Session(format!("JPEG encode failed: {}", error)))?;
        }
        ScreenshotFormatArg::Png => {
            let encoder = image::codecs::png::PngEncoder::new(&mut out);
            resized
                .write_with_encoder(encoder)
                .map_err(|error| CdpError::Session(format!("PNG encode failed: {}", error)))?;
        }
    }

    Ok(ProcessedScreenshot {
        bytes: out.into_inner(),
        width: resized.width(),
        height: resized.height(),
    })
}

/// Create a minimal valid JPEG in memory for tests that need to exercise
/// the image-decode / resize pipeline. The returned bytes are a 100×50
/// white JPEG produced entirely by the `image` crate.
fn make_test_jpeg(width: u32, height: u32) -> Vec<u8> {
    let img = image::DynamicImage::ImageRgb8(image::ImageBuffer::from_pixel(
        width,
        height,
        image::Rgb([255u8, 255, 255]),
    ));
    let mut buf = std::io::Cursor::new(Vec::new());
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 90);
    img.write_with_encoder(encoder).unwrap();
    buf.into_inner()
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

    #[test]
    fn artifact_from_processed_populates_dimensions() {
        let processed = ProcessedScreenshot {
            bytes: make_test_jpeg(100, 50),
            width: 100,
            height: 50,
        };
        let artifact = ScreenshotArtifact::from_processed(ScreenshotFormatArg::Jpeg, &processed);
        assert_eq!(artifact.width, Some(100));
        assert_eq!(artifact.height, Some(50));
        assert!(artifact.bytes.unwrap() > 0);
        assert_eq!(artifact.kind, "base64_jpeg");
    }

    #[test]
    fn resize_screenshot_reduces_width_when_over_max() {
        let raw = make_test_jpeg(1920, 1080);
        let result = resize_screenshot(&raw, 960, ScreenshotFormatArg::Jpeg, Some(70)).unwrap();
        assert!(result.width <= 960, "width {} should be <= 960", result.width);
        assert!(result.height > 0, "height should be positive");
        // Aspect ratio preserved: 960/1920 = 0.5 → height = 540
        let expected_h = (1080.0_f64 * 960.0_f64 / 1920.0_f64).round() as u32;
        assert_eq!(result.height, expected_h);
        assert!(!result.bytes.is_empty());
    }

    #[test]
    fn resize_screenshot_no_op_when_within_max() {
        let raw = make_test_jpeg(800, 400);
        let result = resize_screenshot(&raw, 960, ScreenshotFormatArg::Jpeg, Some(70)).unwrap();
        assert_eq!(result.width, 800);
        assert_eq!(result.height, 400);
    }

    #[test]
    fn resize_screenshot_png_format_roundtrips() {
        let raw = make_test_jpeg(640, 320);
        let result = resize_screenshot(&raw, 320, ScreenshotFormatArg::Png, None).unwrap();
        assert!(result.width <= 320);
        assert!(result.height > 0);
        // Verify it's valid PNG by decoding it.
        let decoded = image::load_from_memory(&result.bytes).unwrap();
        assert_eq!(decoded.width(), result.width);
        assert_eq!(decoded.height(), result.height);
    }
}
