use std::collections::{BTreeMap, HashMap, HashSet};
use std::time::Duration;

use async_trait::async_trait;
use chromiumoxide::cdp::browser_protocol::accessibility::{EnableParams, GetFullAxTreeParams};
use chromiumoxide::cdp::browser_protocol::dom_snapshot::{
    ArrayOfStrings, CaptureSnapshotParams, CaptureSnapshotReturns, DocumentSnapshot,
    RareBooleanData, RareIntegerData, RareStringData, Rectangle, StringIndex,
};
use chromiumoxide::cdp::browser_protocol::page::{
    FrameTree, GetFrameTreeParams, GetLayoutMetricsParams,
};
use chromiumoxide::page::Page;

use crate::browser::cdp::{run_with_timeout, CdpError};

use super::accessibility::normalize_ax_nodes;
use super::page_state::ElementBounds;

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SnapshotViewport {
    pub page_x: f64,
    pub page_y: f64,
    pub width: f64,
    pub height: f64,
}

impl SnapshotViewport {
    pub fn new(page_x: f64, page_y: f64, width: f64, height: f64) -> Self {
        Self {
            page_x,
            page_y,
            width,
            height,
        }
    }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SnapshotFrame {
    pub id: String,
    pub parent_id: Option<String>,
    pub loader_id: String,
    pub name: Option<String>,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct DomNodeSnapshot {
    pub backend_node_id: i64,
    pub frame_id: String,
    pub node_type: i64,
    pub tag_name: Option<String>,
    pub node_value: Option<String>,
    pub attributes: BTreeMap<String, String>,
    pub text_value: Option<String>,
    pub input_value: Option<String>,
    pub layout_text: Option<String>,
    pub bounds: Option<ElementBounds>,
    pub is_clickable: bool,
    pub shadow_root_type: Option<String>,
    pub content_document_index: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct AccessibilityNodeSnapshot {
    pub backend_node_id: i64,
    pub frame_id: Option<String>,
    pub ignored: bool,
    pub role: Option<String>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub value: Option<String>,
    pub properties: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct CapturedPageSnapshot {
    pub url: String,
    pub title: String,
    pub navigation_id: String,
    pub frames: Vec<SnapshotFrame>,
    pub viewport: SnapshotViewport,
    pub dom_nodes: Vec<DomNodeSnapshot>,
    pub ax_nodes: Vec<AccessibilityNodeSnapshot>,
    pub warnings: Vec<String>,
}

#[async_trait]
pub trait StablePageSnapshotSource {
    async fn capture(&self, page: &Page) -> Result<CapturedPageSnapshot, CdpError>;
}

#[derive(Debug, Clone)]
pub struct CdpPageSnapshotSource {
    timeout: Duration,
}

impl CdpPageSnapshotSource {
    pub fn new(timeout: Duration) -> Self {
        Self { timeout }
    }

    async fn capture_ax_nodes(
        &self,
        page: &Page,
        frame_id: Option<String>,
    ) -> Result<Vec<AccessibilityNodeSnapshot>, CdpError> {
        run_with_timeout(
            "Accessibility.enable",
            self.timeout,
            page.execute(EnableParams::default()),
        )
        .await?
        .map_err(|error| {
            CdpError::Session(format!("Unable to enable accessibility domain: {}", error))
        })?;

        let params = match frame_id {
            Some(frame_id) => GetFullAxTreeParams::builder().frame_id(frame_id).build(),
            None => GetFullAxTreeParams::default(),
        };
        let response = run_with_timeout(
            "Accessibility.getFullAXTree",
            self.timeout,
            page.execute(params),
        )
        .await?
        .map_err(|error| {
            CdpError::Session(format!("Unable to capture accessibility tree: {}", error))
        })?;

        Ok(normalize_ax_nodes(response.result.nodes))
    }
}

#[async_trait]
impl StablePageSnapshotSource for CdpPageSnapshotSource {
    async fn capture(&self, page: &Page) -> Result<CapturedPageSnapshot, CdpError> {
        let frame_tree = run_with_timeout(
            "Page.getFrameTree",
            self.timeout,
            page.execute(GetFrameTreeParams::default()),
        )
        .await?
        .map_err(|error| CdpError::Session(format!("Unable to get frame tree: {}", error)))?;
        let layout_metrics = run_with_timeout(
            "Page.getLayoutMetrics",
            self.timeout,
            page.execute(GetLayoutMetricsParams::default()),
        )
        .await?
        .map_err(|error| CdpError::Session(format!("Unable to get layout metrics: {}", error)))?;
        let dom_snapshot_params = CaptureSnapshotParams::builder()
            .computed_styles(["display", "visibility"])
            .include_dom_rects(true)
            .build()
            .map_err(CdpError::InvalidResponse)?;
        let dom_snapshot = run_with_timeout(
            "DOMSnapshot.captureSnapshot",
            self.timeout,
            page.execute(dom_snapshot_params),
        )
        .await?
        .map_err(|error| CdpError::Session(format!("Unable to capture DOM snapshot: {}", error)))?;

        let frames = flatten_frame_tree(&frame_tree.frame_tree);
        let root_frame = frames.first().cloned().ok_or_else(|| {
            CdpError::InvalidResponse("Page.getFrameTree returned no root frame".to_string())
        })?;
        let dom_nodes = flatten_dom_nodes(&dom_snapshot)?;
        let mut warnings = Vec::new();

        if frames.len() > dom_snapshot.documents.len()
            || has_partial_iframe_documents(&dom_nodes)
        {
            warnings.push("cross_origin_iframe_partial".to_string());
        }

        if dom_nodes
            .iter()
            .any(|node| node.shadow_root_type.as_deref() == Some("closed"))
        {
            warnings.push("closed_shadow_root_partial".to_string());
        }

        let ax_nodes = match self.capture_ax_nodes(page, Some(root_frame.id.clone())).await {
            Ok(nodes) => nodes,
            Err(error) => {
                warnings.push(format!("ax_tree_unavailable: {}", error));
                Vec::new()
            }
        };

        let root_document = dom_snapshot.documents.first().ok_or_else(|| {
            CdpError::InvalidResponse(
                "DOMSnapshot.captureSnapshot returned no documents".to_string(),
            )
        })?;
        let url = string_from_index(&dom_snapshot.strings, &root_document.document_url)
            .unwrap_or_else(|| root_frame.url.clone());
        let title = string_from_index(&dom_snapshot.strings, &root_document.title)
            .unwrap_or_default();

        Ok(CapturedPageSnapshot {
            url,
            title,
            navigation_id: root_frame.loader_id.clone(),
            frames,
            viewport: SnapshotViewport::new(
                layout_metrics.css_visual_viewport.page_x,
                layout_metrics.css_visual_viewport.page_y,
                layout_metrics.css_visual_viewport.client_width,
                layout_metrics.css_visual_viewport.client_height,
            ),
            dom_nodes,
            ax_nodes,
            warnings,
        })
    }
}

fn flatten_frame_tree(frame_tree: &FrameTree) -> Vec<SnapshotFrame> {
    let mut frames = Vec::new();
    flatten_frame_tree_into(frame_tree, &mut frames);
    frames
}

fn flatten_frame_tree_into(frame_tree: &FrameTree, frames: &mut Vec<SnapshotFrame>) {
    frames.push(SnapshotFrame {
        id: frame_tree.frame.id.as_ref().to_string(),
        parent_id: frame_tree
            .frame
            .parent_id
            .as_ref()
            .map(|parent_id| parent_id.as_ref().to_string()),
        loader_id: frame_tree.frame.loader_id.as_ref().to_string(),
        name: frame_tree.frame.name.clone(),
        url: frame_tree.frame.url.clone(),
    });

    for child_frame in frame_tree.child_frames.as_deref().unwrap_or_default() {
        flatten_frame_tree_into(child_frame, frames);
    }
}

fn flatten_dom_nodes(snapshot: &CaptureSnapshotReturns) -> Result<Vec<DomNodeSnapshot>, CdpError> {
    let mut flattened_nodes = Vec::new();

    for document in &snapshot.documents {
        let frame_id = string_from_index(&snapshot.strings, &document.frame_id).unwrap_or_default();
        let layout_bounds = layout_bounds_by_node(document);
        let layout_text = layout_text_by_node(document, &snapshot.strings);
        let text_values = rare_string_map(document.nodes.text_value.as_ref(), &snapshot.strings);
        let input_values = rare_string_map(document.nodes.input_value.as_ref(), &snapshot.strings);
        let shadow_root_types =
            rare_string_map(document.nodes.shadow_root_type.as_ref(), &snapshot.strings);
        let clickable_nodes = rare_boolean_set(document.nodes.is_clickable.as_ref());
        let content_documents = rare_integer_map(document.nodes.content_document_index.as_ref());

        let node_names = document.nodes.node_name.as_ref().ok_or_else(|| {
            CdpError::InvalidResponse("DOM snapshot is missing node names".to_string())
        })?;

        for (index, node_name) in node_names.iter().enumerate() {
            let backend_node_id = document
                .nodes
                .backend_node_id
                .as_ref()
                .and_then(|backend_node_ids| backend_node_ids.get(index))
                .map(|backend_node_id| *backend_node_id.inner())
                .unwrap_or_default();
            if backend_node_id <= 0 {
                continue;
            }

            let node_type = document
                .nodes
                .node_type
                .as_ref()
                .and_then(|node_types| node_types.get(index))
                .copied()
                .unwrap_or_default();
            let raw_node_name = string_from_index(&snapshot.strings, node_name).unwrap_or_default();
            let tag_name = if node_type == 1 {
                Some(raw_node_name.to_ascii_lowercase())
            } else {
                None
            };
            let node_value = document
                .nodes
                .node_value
                .as_ref()
                .and_then(|node_values| node_values.get(index))
                .and_then(|node_value| string_from_index(&snapshot.strings, node_value));
            let attributes = document
                .nodes
                .attributes
                .as_ref()
                .and_then(|attributes| attributes.get(index))
                .map(|attributes| decode_attributes(attributes, &snapshot.strings))
                .unwrap_or_default();

            flattened_nodes.push(DomNodeSnapshot {
                backend_node_id,
                frame_id: frame_id.clone(),
                node_type,
                tag_name,
                node_value,
                attributes,
                text_value: text_values.get(&index).cloned(),
                input_value: input_values.get(&index).cloned(),
                layout_text: layout_text.get(&index).cloned(),
                bounds: layout_bounds.get(&index).copied(),
                is_clickable: clickable_nodes.contains(&index),
                shadow_root_type: shadow_root_types.get(&index).cloned(),
                content_document_index: content_documents.get(&index).copied(),
            });
        }
    }

    Ok(flattened_nodes)
}

fn has_partial_iframe_documents(dom_nodes: &[DomNodeSnapshot]) -> bool {
    dom_nodes.iter().any(|node| {
        matches!(node.tag_name.as_deref(), Some("iframe") | Some("frame"))
            && node
                .attributes
                .get("src")
                .map(|src| !src.trim().is_empty())
                .unwrap_or(false)
            && node.content_document_index.is_none()
    })
}

fn layout_bounds_by_node(document: &DocumentSnapshot) -> HashMap<usize, ElementBounds> {
    let mut bounds = HashMap::new();

    for (layout_index, node_index) in document.layout.node_index.iter().enumerate() {
        let Some(rectangle) = document.layout.bounds.get(layout_index) else {
            continue;
        };
        let Some(bounds_value) = rectangle_to_bounds(rectangle) else {
            continue;
        };
        if *node_index >= 0 {
            bounds.insert(*node_index as usize, bounds_value);
        }
    }

    bounds
}

fn layout_text_by_node(document: &DocumentSnapshot, strings: &[String]) -> HashMap<usize, String> {
    let mut text_by_node = HashMap::new();

    for (layout_index, node_index) in document.layout.node_index.iter().enumerate() {
        let Some(text_index) = document.layout.text.get(layout_index) else {
            continue;
        };
        let Some(text) = string_from_index(strings, text_index) else {
            continue;
        };
        if text.trim().is_empty() || *node_index < 0 {
            continue;
        }

        text_by_node
            .entry(*node_index as usize)
            .or_insert_with(|| text.trim().to_string());
    }

    text_by_node
}

fn decode_attributes(attributes: &ArrayOfStrings, strings: &[String]) -> BTreeMap<String, String> {
    let mut decoded = BTreeMap::new();
    let values = attributes.inner();

    for pair in values.chunks(2) {
        let Some(name) = pair.first().and_then(|name| string_from_index(strings, name)) else {
            continue;
        };
        let value = pair
            .get(1)
            .and_then(|value| string_from_index(strings, value))
            .unwrap_or_default();
        decoded.insert(name.to_ascii_lowercase(), value);
    }

    decoded
}

fn rare_string_map(data: Option<&RareStringData>, strings: &[String]) -> HashMap<usize, String> {
    let mut values = HashMap::new();

    if let Some(data) = data {
        for (index, value_index) in data.index.iter().zip(data.value.iter()) {
            if *index < 0 {
                continue;
            }
            if let Some(value) = string_from_index(strings, value_index)
                .filter(|value| !value.trim().is_empty())
            {
                values.insert(*index as usize, value.trim().to_string());
            }
        }
    }

    values
}

fn rare_boolean_set(data: Option<&RareBooleanData>) -> HashSet<usize> {
    data.map(|data| {
        data.index
            .iter()
            .filter(|index| **index >= 0)
            .map(|index| *index as usize)
            .collect()
    })
    .unwrap_or_default()
}

fn rare_integer_map(data: Option<&RareIntegerData>) -> HashMap<usize, usize> {
    let mut values = HashMap::new();

    if let Some(data) = data {
        for (index, value) in data.index.iter().zip(data.value.iter()) {
            if *index < 0 || *value < 0 {
                continue;
            }
            values.insert(*index as usize, *value as usize);
        }
    }

    values
}

fn string_from_index(strings: &[String], index: &StringIndex) -> Option<String> {
    let idx = *index.inner();
    if idx < 0 {
        return None;
    }
    strings.get(idx as usize).cloned()
}

fn rectangle_to_bounds(rectangle: &Rectangle) -> Option<ElementBounds> {
    let values = rectangle.inner();
    if values.len() < 4 {
        return None;
    }

    Some(ElementBounds {
        x: values[0],
        y: values[1],
        width: values[2],
        height: values[3],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_iframe_detection_requires_missing_content_document() {
        let iframe_without_document = dom_node(Some("iframe"), Some("https://warning-frame.test/iframe-payment"), None);
        let iframe_with_document = dom_node(Some("iframe"), Some("https://warning-frame.test/iframe-payment"), Some(1));

        assert!(has_partial_iframe_documents(&[iframe_without_document]));
        assert!(!has_partial_iframe_documents(&[iframe_with_document]));
    }

    #[test]
    fn partial_iframe_detection_ignores_non_frame_nodes_and_blank_src() {
        let button_node = dom_node(Some("button"), None, None);
        let blank_src_iframe = dom_node(Some("iframe"), Some("   "), None);

        assert!(!has_partial_iframe_documents(&[button_node, blank_src_iframe]));
    }

    fn dom_node(tag_name: Option<&str>, src: Option<&str>, content_document_index: Option<usize>) -> DomNodeSnapshot {
        let mut attributes = BTreeMap::new();
        if let Some(src) = src {
            attributes.insert("src".to_string(), src.to_string());
        }

        DomNodeSnapshot {
            backend_node_id: 1,
            frame_id: "root".to_string(),
            node_type: 1,
            tag_name: tag_name.map(ToString::to_string),
            node_value: None,
            attributes,
            text_value: None,
            input_value: None,
            layout_text: None,
            bounds: None,
            is_clickable: false,
            shadow_root_type: None,
            content_document_index,
        }
    }
}