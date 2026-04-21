use serde::{Deserialize, Serialize};

use super::interactive::collect_interactive_elements;
use super::merge::merge_snapshot;
use super::snapshot::{CapturedPageSnapshot, SnapshotViewport};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ElementBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScreenshotRef {
    pub kind: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InteractiveElement {
    pub index: u32,
    pub backend_node_id: i64,
    pub frame_id: String,
    pub role: String,
    pub name: String,
    pub tag_name: Option<String>,
    pub bounds: Option<ElementBounds>,
    pub is_visible: bool,
    pub is_clickable: bool,
    pub is_editable: bool,
    pub selector_hint: Option<String>,
    pub text_hint: Option<String>,
    pub href: Option<String>,
    pub input_type: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PageState {
    pub url: String,
    pub title: String,
    pub navigation_id: String,
    pub frame_count: usize,
    pub warnings: Vec<String>,
    pub elements: Vec<InteractiveElement>,
    pub screenshot: Option<ScreenshotRef>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PageStateCacheMetadata {
    pub viewport_signature: String,
    pub dom_version: String,
}

impl PageStateCacheMetadata {
    pub fn from_page_state(page_state: &PageState, viewport_signature: impl Into<String>) -> Self {
        Self {
            viewport_signature: viewport_signature.into(),
            dom_version: build_dom_version(page_state),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct PageStateCapture {
    pub page_state: PageState,
    pub cache_metadata: PageStateCacheMetadata,
}

pub(crate) fn build_page_state(snapshot: CapturedPageSnapshot) -> PageState {
    build_page_state_capture(snapshot).page_state
}

pub(crate) fn build_page_state_capture(snapshot: CapturedPageSnapshot) -> PageStateCapture {
    let merged_nodes = merge_snapshot(&snapshot);
    let elements = collect_interactive_elements(&snapshot, merged_nodes);

    let page_state = PageState {
        url: snapshot.url,
        title: snapshot.title,
        navigation_id: snapshot.navigation_id,
        frame_count: snapshot.frames.len().max(1),
        warnings: snapshot.warnings,
        elements,
        screenshot: None,
    };

    PageStateCapture {
        cache_metadata: PageStateCacheMetadata::from_page_state(
            &page_state,
            build_viewport_signature(&snapshot.viewport),
        ),
        page_state,
    }
}

impl PageState {
    pub fn find_element(&self, index: u64) -> Option<&InteractiveElement> {
        self.elements.iter().find(|element| element.index as u64 == index)
    }

    pub fn find_element_by_backend_node_id(&self, backend_node_id: i64) -> Option<&InteractiveElement> {
        self.elements
            .iter()
            .find(|element| element.backend_node_id == backend_node_id)
    }

    pub fn to_text(&self) -> String {
        const MAX_ELEMENTS: usize = 30;
        const MAX_TEXT_CHARS: usize = 2000;

        let mut lines = vec![
            format!("URL: {}", self.url),
            format!("Title: {}", self.title),
            String::new(),
        ];

        if self.elements.is_empty() {
            lines.push("No interactive elements detected.".to_string());
        } else {
            for element in self.elements.iter().take(MAX_ELEMENTS) {
                lines.push(format!(
                    "[{}] {} \"{}\"",
                    element.index,
                    element.display_role(),
                    normalize_text(&element.display_name())
                ));
            }
        }

        let mut warnings = self.warnings.clone();
        if self.elements.len() > MAX_ELEMENTS {
            warnings.push("truncated_interactive_list".to_string());
        }

        if !warnings.is_empty() {
            lines.push(String::new());
            lines.push(format!("Warnings: {}", warnings.join(", ")));
        }

        let mut rendered = lines.join("\n");
        if rendered.chars().count() > MAX_TEXT_CHARS {
            rendered = truncate_chars(&rendered, MAX_TEXT_CHARS.saturating_sub(3));
            rendered.push_str("...");
        }

        rendered
    }
}

impl InteractiveElement {
    fn display_role(&self) -> &str {
        if self.role.trim().is_empty() {
            self.tag_name.as_deref().unwrap_or("element")
        } else {
            self.role.as_str()
        }
    }

    fn display_name(&self) -> String {
        if !self.name.trim().is_empty() {
            return self.name.trim().to_string();
        }

        if let Some(text_hint) = self
            .text_hint
            .as_ref()
            .map(|text| text.trim())
            .filter(|text| !text.is_empty())
        {
            return text_hint.to_string();
        }

        if let Some(selector_hint) = self
            .selector_hint
            .as_ref()
            .map(|selector| selector.trim())
            .filter(|selector| !selector.is_empty())
        {
            return selector_hint.to_string();
        }

        self.tag_name.clone().unwrap_or_else(|| self.role.clone())
    }
}

fn normalize_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    text.chars().take(max_chars).collect()
}

fn build_viewport_signature(viewport: &SnapshotViewport) -> String {
    format!(
        "viewport:{}:{}:{}:{}",
        viewport.page_x.round() as i64,
        viewport.page_y.round() as i64,
        viewport.width.round() as i64,
        viewport.height.round() as i64,
    )
}

fn build_dom_version(page_state: &PageState) -> String {
    let seed = page_state
        .elements
        .iter()
        .take(32)
        .map(|element| {
            format!(
                "{}:{}:{}:{}:{}",
                element.backend_node_id,
                element.index,
                u8::from(element.is_visible),
                u8::from(element.is_clickable),
                u8::from(element.is_editable),
            )
        })
        .collect::<Vec<_>>()
        .join("|");

    let warning_seed = page_state.warnings.join("|");
    let raw = format!("{}:{}:{}", page_state.navigation_id, warning_seed, seed);
    format!("dom-{}", simple_hash(&raw))
}

fn simple_hash(value: &str) -> String {
    let mut hash = 0_i32;
    for ch in value.chars() {
        hash = hash
            .wrapping_shl(5)
            .wrapping_sub(hash)
            .wrapping_add(ch as i32);
    }

    to_base36(i64::from(hash).unsigned_abs())
}

fn to_base36(mut value: u64) -> String {
    if value == 0 {
        return "0".to_string();
    }

    let mut digits = Vec::new();
    while value > 0 {
        let digit = (value % 36) as u8;
        digits.push(match digit {
            0..=9 => (b'0' + digit) as char,
            _ => (b'a' + (digit - 10)) as char,
        });
        value /= 36;
    }
    digits.iter().rev().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_state_text_lists_indices_and_warnings() {
        let state = PageState {
            url: "https://example.com/login".to_string(),
            title: "Sign in".to_string(),
            navigation_id: "loader-1".to_string(),
            frame_count: 1,
            warnings: vec!["cross_origin_iframe_partial".to_string()],
            elements: vec![InteractiveElement {
                index: 0,
                backend_node_id: 10,
                frame_id: "root".to_string(),
                role: "button".to_string(),
                name: "Continue".to_string(),
                tag_name: Some("button".to_string()),
                bounds: None,
                is_visible: true,
                is_clickable: true,
                is_editable: false,
                selector_hint: None,
                text_hint: None,
                href: None,
                input_type: None,
            }],
            screenshot: None,
        };

        let text = state.to_text();

        assert!(text.contains("URL: https://example.com/login"));
        assert!(text.contains("[0] button \"Continue\""));
        assert!(text.contains("Warnings: cross_origin_iframe_partial"));
    }

    #[test]
    fn page_state_finds_element_by_backend_node_id() {
        let state = PageState {
            url: "https://example.com/login".to_string(),
            title: "Sign in".to_string(),
            navigation_id: "loader-1".to_string(),
            frame_count: 1,
            warnings: Vec::new(),
            elements: vec![InteractiveElement {
                index: 0,
                backend_node_id: 42,
                frame_id: "root".to_string(),
                role: "button".to_string(),
                name: "Continue".to_string(),
                tag_name: Some("button".to_string()),
                bounds: None,
                is_visible: true,
                is_clickable: true,
                is_editable: false,
                selector_hint: None,
                text_hint: None,
                href: None,
                input_type: None,
            }],
            screenshot: None,
        };

        assert_eq!(
            state
                .find_element_by_backend_node_id(42)
                .map(|element| element.name.as_str()),
            Some("Continue")
        );
    }
}