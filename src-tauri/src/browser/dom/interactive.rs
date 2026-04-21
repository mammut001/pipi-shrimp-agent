use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

use super::merge::MergedNode;
use super::page_state::{ElementBounds, InteractiveElement};
use super::snapshot::{CapturedPageSnapshot, SnapshotFrame, SnapshotViewport};

pub(crate) fn collect_interactive_elements(
    snapshot: &CapturedPageSnapshot,
    merged_nodes: Vec<MergedNode>,
) -> Vec<InteractiveElement> {
    let frame_depths = frame_depths(&snapshot.frames);
    let mut seen_backend_nodes = HashSet::new();
    let mut candidates: Vec<MergedNode> = merged_nodes
        .into_iter()
        .filter(|node| !node.is_disabled)
        .filter(|node| node.is_clickable || node.is_editable)
        .filter(|node| seen_backend_nodes.insert(node.backend_node_id))
        .collect();

    candidates.sort_by(|left, right| compare_candidates(left, right, &snapshot.viewport, &frame_depths));

    candidates
        .into_iter()
        .enumerate()
        .map(|(index, node)| {
            let name = preferred_label(&node);
            InteractiveElement {
                index: index as u32,
                backend_node_id: node.backend_node_id,
                frame_id: node.frame_id,
                role: node.role,
                name,
                tag_name: node.tag_name,
                bounds: node.bounds,
                is_visible: node.is_visible,
                is_clickable: node.is_clickable,
                is_editable: node.is_editable,
                selector_hint: node.selector_hint,
                text_hint: node.text_hint,
                href: node.href,
                input_type: node.input_type,
            }
        })
        .collect()
}

fn compare_candidates(
    left: &MergedNode,
    right: &MergedNode,
    viewport: &SnapshotViewport,
    frame_depths: &HashMap<String, usize>,
) -> Ordering {
    let left_visible = left.is_visible;
    let right_visible = right.is_visible;
    let left_in_view = left.bounds.as_ref().map(|bounds| in_viewport(bounds, viewport)).unwrap_or(false);
    let right_in_view = right.bounds.as_ref().map(|bounds| in_viewport(bounds, viewport)).unwrap_or(false);
    let left_top = left.bounds.as_ref().map(|bounds| bounds.y).unwrap_or(f64::MAX);
    let right_top = right.bounds.as_ref().map(|bounds| bounds.y).unwrap_or(f64::MAX);
    let left_left = left.bounds.as_ref().map(|bounds| bounds.x).unwrap_or(f64::MAX);
    let right_left = right.bounds.as_ref().map(|bounds| bounds.x).unwrap_or(f64::MAX);
    let left_depth = frame_depths.get(&left.frame_id).copied().unwrap_or(usize::MAX);
    let right_depth = frame_depths.get(&right.frame_id).copied().unwrap_or(usize::MAX);

    right_visible
        .cmp(&left_visible)
        .then_with(|| right_in_view.cmp(&left_in_view))
        .then_with(|| compare_f64(left_top, right_top))
        .then_with(|| compare_f64(left_left, right_left))
        .then_with(|| left_depth.cmp(&right_depth))
        .then_with(|| left.frame_id.cmp(&right.frame_id))
        .then_with(|| left.backend_node_id.cmp(&right.backend_node_id))
}

fn frame_depths(frames: &[SnapshotFrame]) -> HashMap<String, usize> {
    let parents: HashMap<String, Option<String>> = frames
        .iter()
        .map(|frame| (frame.id.clone(), frame.parent_id.clone()))
        .collect();
    let mut depths = HashMap::new();

    for frame in frames {
        let mut depth = 0;
        let mut current = frame.parent_id.clone();

        while let Some(parent_id) = current {
            depth += 1;
            current = parents.get(&parent_id).cloned().flatten();
        }

        depths.insert(frame.id.clone(), depth);
    }

    depths
}

fn in_viewport(bounds: &ElementBounds, viewport: &SnapshotViewport) -> bool {
    let viewport_right = viewport.page_x + viewport.width;
    let viewport_bottom = viewport.page_y + viewport.height;
    let right = bounds.x + bounds.width;
    let bottom = bounds.y + bounds.height;

    right > viewport.page_x
        && bottom > viewport.page_y
        && bounds.x < viewport_right
        && bounds.y < viewport_bottom
}

fn preferred_label(node: &MergedNode) -> String {
    if !node.name.trim().is_empty() {
        return node.name.trim().to_string();
    }

    if let Some(text_hint) = node.text_hint.as_ref().map(|text| text.trim()).filter(|text| !text.is_empty()) {
        return text_hint.to_string();
    }

    if let Some(selector_hint) = node
        .selector_hint
        .as_ref()
        .map(|selector| selector.trim())
        .filter(|selector| !selector.is_empty())
    {
        return selector_hint.to_string();
    }

    node.tag_name
        .clone()
        .filter(|tag_name| !tag_name.is_empty())
        .unwrap_or_else(|| node.role.clone())
}

fn compare_f64(left: f64, right: f64) -> Ordering {
    left.partial_cmp(&right).unwrap_or(Ordering::Equal)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::dom::merge::MergedNode;
    use crate::browser::dom::snapshot::{CapturedPageSnapshot, SnapshotViewport};

    fn make_node(backend_node_id: i64, x: f64, y: f64, visible: bool) -> MergedNode {
        MergedNode {
            backend_node_id,
            frame_id: "root".to_string(),
            role: "button".to_string(),
            name: format!("Button {}", backend_node_id),
            tag_name: Some("button".to_string()),
            bounds: Some(ElementBounds {
                x,
                y,
                width: 80.0,
                height: 30.0,
            }),
            is_visible: visible,
            is_clickable: true,
            is_editable: false,
            is_disabled: false,
            selector_hint: None,
            text_hint: None,
            href: None,
            input_type: None,
            tab_index: None,
        }
    }

    fn make_snapshot() -> CapturedPageSnapshot {
        CapturedPageSnapshot {
            url: "https://example.com".to_string(),
            title: "Example".to_string(),
            navigation_id: "loader-1".to_string(),
            frames: Vec::new(),
            viewport: SnapshotViewport::new(0.0, 0.0, 300.0, 400.0),
            dom_nodes: Vec::new(),
            ax_nodes: Vec::new(),
            warnings: Vec::new(),
        }
    }

    #[test]
    fn ranking_prefers_visible_viewport_nodes_then_document_order() {
        let snapshot = make_snapshot();

        let elements = collect_interactive_elements(
            &snapshot,
            vec![
                make_node(3, 24.0, 240.0, false),
                make_node(2, 24.0, 120.0, true),
                make_node(1, 24.0, 32.0, true),
            ],
        );

        assert_eq!(
            elements
                .iter()
                .map(|element| element.backend_node_id)
                .collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
        assert_eq!(elements[0].index, 0);
        assert_eq!(elements[1].index, 1);
        assert_eq!(elements[2].index, 2);
    }

    #[test]
    fn ranking_is_stable_across_repeated_captures_for_same_navigation() {
        let snapshot = make_snapshot();

        let first = collect_interactive_elements(
            &snapshot,
            vec![
                make_node(7, 24.0, 32.0, true),
                make_node(8, 24.0, 120.0, true),
                make_node(9, 24.0, 240.0, true),
            ],
        );
        let second = collect_interactive_elements(
            &snapshot,
            vec![
                make_node(9, 24.0, 240.0, true),
                make_node(7, 24.0, 32.0, true),
                make_node(8, 24.0, 120.0, true),
            ],
        );

        let first_mapping: Vec<(u32, i64)> = first
            .iter()
            .map(|element| (element.index, element.backend_node_id))
            .collect();
        let second_mapping: Vec<(u32, i64)> = second
            .iter()
            .map(|element| (element.index, element.backend_node_id))
            .collect();

        assert_eq!(first_mapping, second_mapping);
        assert_eq!(first_mapping, vec![(0, 7), (1, 8), (2, 9)]);
    }
}