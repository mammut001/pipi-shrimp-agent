use std::collections::HashMap;

use serde_json::Value;

use super::page_state::ElementBounds;
use super::snapshot::{AccessibilityNodeSnapshot, CapturedPageSnapshot, DomNodeSnapshot};

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct MergedNode {
    pub backend_node_id: i64,
    pub frame_id: String,
    pub role: String,
    pub name: String,
    pub tag_name: Option<String>,
    pub bounds: Option<ElementBounds>,
    pub is_visible: bool,
    pub is_clickable: bool,
    pub is_editable: bool,
    pub is_disabled: bool,
    pub selector_hint: Option<String>,
    pub text_hint: Option<String>,
    pub href: Option<String>,
    pub input_type: Option<String>,
    pub tab_index: Option<i64>,
}

pub(crate) fn merge_snapshot(snapshot: &CapturedPageSnapshot) -> Vec<MergedNode> {
    let mut ax_by_backend: HashMap<i64, AccessibilityNodeSnapshot> = HashMap::new();

    for ax_node in &snapshot.ax_nodes {
        ax_by_backend
            .entry(ax_node.backend_node_id)
            .and_modify(|current| {
                if ax_preference_score(ax_node) > ax_preference_score(current) {
                    *current = ax_node.clone();
                }
            })
            .or_insert_with(|| ax_node.clone());
    }

    snapshot
        .dom_nodes
        .iter()
        .map(|dom_node| merge_dom_node(dom_node, ax_by_backend.get(&dom_node.backend_node_id)))
        .collect()
}

fn merge_dom_node(dom_node: &DomNodeSnapshot, ax_node: Option<&AccessibilityNodeSnapshot>) -> MergedNode {
    let tag_name = dom_node.tag_name.clone();
    let input_type = dom_node
        .attributes
        .get("type")
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty());
    let href = dom_node
        .attributes
        .get("href")
        .cloned()
        .filter(|value| !value.trim().is_empty());
    let tab_index = dom_node
        .attributes
        .get("tabindex")
        .and_then(|value| value.trim().parse::<i64>().ok());
    let selector_hint = build_selector_hint(dom_node);
    let text_hint = dom_text_hint(dom_node);
    let role = ax_node
        .and_then(|node| cleaned_string(node.role.as_ref()))
        .or_else(|| cleaned_string(dom_node.attributes.get("role")))
        .unwrap_or_else(|| infer_role(dom_node, input_type.as_deref()));
    let name = ax_node
        .and_then(|node| cleaned_string(node.name.as_ref()))
        .or_else(|| dom_accessible_name(dom_node))
        .unwrap_or_default();

    let has_bounds = dom_node
        .bounds
        .as_ref()
        .map(|bounds| bounds.width > 0.0 && bounds.height > 0.0)
        .unwrap_or(false);
    let hidden = ax_node.map(|node| node.ignored).unwrap_or(false)
        || ax_bool_property(ax_node, "hidden")
        || has_boolean_attr(dom_node, "hidden")
        || attr_equals(dom_node, "aria-hidden", "true")
        || !has_bounds;
    let is_disabled = ax_bool_property(ax_node, "disabled")
        || has_boolean_attr(dom_node, "disabled")
        || attr_equals(dom_node, "aria-disabled", "true");
    let is_editable = !is_disabled
        && (ax_editable(ax_node)
            || has_editable_attr(dom_node)
            || matches!(tag_name.as_deref(), Some("input" | "textarea" | "select")));
    let is_clickable = !is_disabled
        && (dom_node.is_clickable
            || href.is_some()
            || tab_index.map(|value| value >= 0).unwrap_or(false)
            || has_onclick(dom_node)
            || role_is_interactive(&role)
            || tag_is_interactive(tag_name.as_deref(), input_type.as_deref()));

    MergedNode {
        backend_node_id: dom_node.backend_node_id,
        frame_id: dom_node.frame_id.clone(),
        role,
        name,
        tag_name,
        bounds: dom_node.bounds,
        is_visible: !hidden,
        is_clickable,
        is_editable,
        is_disabled,
        selector_hint,
        text_hint,
        href,
        input_type,
        tab_index,
    }
}

fn ax_preference_score(node: &AccessibilityNodeSnapshot) -> usize {
    let mut score = 0;
    if !node.ignored {
        score += 4;
    }
    if cleaned_string(node.role.as_ref()).is_some() {
        score += 2;
    }
    if cleaned_string(node.name.as_ref()).is_some() {
        score += 3;
    }
    if !node.properties.is_empty() {
        score += 1;
    }
    score
}

fn infer_role(dom_node: &DomNodeSnapshot, input_type: Option<&str>) -> String {
    if let Some(role) = cleaned_string(dom_node.attributes.get("role")) {
        return role;
    }

    match dom_node.tag_name.as_deref() {
        Some("a") => "link".to_string(),
        Some("button") => "button".to_string(),
        Some("summary") => "button".to_string(),
        Some("select") => "combobox".to_string(),
        Some("textarea") => "textbox".to_string(),
        Some("input") => match input_type {
            Some("button" | "submit" | "reset" | "image") => "button".to_string(),
            Some("checkbox") => "checkbox".to_string(),
            Some("radio") => "radio".to_string(),
            Some("range") => "slider".to_string(),
            Some("email" | "search" | "tel" | "text" | "url" | "password") | None => "textbox".to_string(),
            Some(other) => other.to_string(),
        },
        Some(tag_name) => tag_name.to_string(),
        None => "element".to_string(),
    }
}

fn dom_accessible_name(dom_node: &DomNodeSnapshot) -> Option<String> {
    [
        dom_node.attributes.get("aria-label"),
        dom_node.attributes.get("title"),
        dom_node.attributes.get("placeholder"),
        dom_node.attributes.get("alt"),
        dom_node.attributes.get("value"),
        dom_node.input_value.as_ref(),
        dom_node.text_value.as_ref(),
        dom_node.layout_text.as_ref(),
        dom_node.node_value.as_ref(),
    ]
    .into_iter()
    .flatten()
    .find_map(|value| cleaned_string(Some(value)))
}

fn dom_text_hint(dom_node: &DomNodeSnapshot) -> Option<String> {
    [
        dom_node.text_value.as_ref(),
        dom_node.layout_text.as_ref(),
        dom_node.input_value.as_ref(),
        dom_node.attributes.get("placeholder"),
        dom_node.attributes.get("title"),
        dom_node.node_value.as_ref(),
    ]
    .into_iter()
    .flatten()
    .find_map(|value| cleaned_string(Some(value)))
}

fn build_selector_hint(dom_node: &DomNodeSnapshot) -> Option<String> {
    if let Some(id) = cleaned_string(dom_node.attributes.get("id")) {
        return Some(format!("#{}", id));
    }

    let tag_name = dom_node.tag_name.as_deref().unwrap_or("*");

    if let Some(test_id) = cleaned_string(dom_node.attributes.get("data-testid")) {
        return Some(format!(
            r#"{}[data-testid=\"{}\"]"#,
            tag_name,
            escape_attribute_value(&test_id)
        ));
    }

    if let Some(name) = cleaned_string(dom_node.attributes.get("name")) {
        return Some(format!(
            r#"{}[name=\"{}\"]"#,
            tag_name,
            escape_attribute_value(&name)
        ));
    }

    if let Some(label) = cleaned_string(dom_node.attributes.get("aria-label")) {
        return Some(format!(
            r#"{}[aria-label=\"{}\"]"#,
            tag_name,
            escape_attribute_value(&label)
        ));
    }

    None
}

fn escape_attribute_value(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn has_boolean_attr(dom_node: &DomNodeSnapshot, name: &str) -> bool {
    dom_node.attributes.contains_key(name)
}

fn has_editable_attr(dom_node: &DomNodeSnapshot) -> bool {
    dom_node
        .attributes
        .get("contenteditable")
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            normalized.is_empty() || (normalized != "false" && normalized != "inherit")
        })
        .unwrap_or(false)
}

    fn has_onclick(dom_node: &DomNodeSnapshot) -> bool {
    dom_node.attributes.contains_key("onclick")
}

fn attr_equals(dom_node: &DomNodeSnapshot, name: &str, expected: &str) -> bool {
    dom_node
        .attributes
        .get(name)
        .map(|value| value.trim().eq_ignore_ascii_case(expected))
        .unwrap_or(false)
}

fn role_is_interactive(role: &str) -> bool {
    matches!(
        role,
        "button"
            | "link"
            | "textbox"
            | "checkbox"
            | "radio"
            | "combobox"
            | "menuitem"
            | "menuitemcheckbox"
            | "menuitemradio"
            | "option"
            | "searchbox"
            | "slider"
            | "spinbutton"
            | "switch"
            | "tab"
    )
}

fn tag_is_interactive(tag_name: Option<&str>, input_type: Option<&str>) -> bool {
    match tag_name {
        Some("a" | "button" | "select" | "textarea") => true,
        Some("input") => !matches!(input_type, Some("hidden")),
        Some("summary") => true,
        _ => false,
    }
}

fn ax_bool_property(ax_node: Option<&AccessibilityNodeSnapshot>, key: &str) -> bool {
    ax_node
        .and_then(|node| node.properties.get(key))
        .and_then(json_value_to_bool)
        .unwrap_or(false)
}

fn ax_editable(ax_node: Option<&AccessibilityNodeSnapshot>) -> bool {
    ax_node
        .and_then(|node| node.properties.get("editable"))
        .map(|value| match value {
            Value::Bool(flag) => *flag,
            Value::String(text) => {
                let normalized = text.trim().to_ascii_lowercase();
                !normalized.is_empty() && normalized != "false"
            }
            _ => false,
        })
        .unwrap_or(false)
}

fn json_value_to_bool(value: &Value) -> Option<bool> {
    match value {
        Value::Bool(flag) => Some(*flag),
        Value::String(text) if text.eq_ignore_ascii_case("true") => Some(true),
        Value::String(text) if text.eq_ignore_ascii_case("false") => Some(false),
        _ => None,
    }
}

fn cleaned_string(value: Option<&String>) -> Option<String> {
    value
        .map(|text| text.trim())
        .filter(|text| !text.is_empty())
        .map(ToOwned::to_owned)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use serde_json::json;

    use super::*;
    use crate::browser::dom::snapshot::{AccessibilityNodeSnapshot, CapturedPageSnapshot, SnapshotViewport};

    #[test]
    fn merge_prefers_accessibility_role_name_and_flags() {
        let dom_node = DomNodeSnapshot {
            backend_node_id: 42,
            frame_id: "root".to_string(),
            node_type: 1,
            tag_name: Some("div".to_string()),
            node_value: None,
            attributes: BTreeMap::from([
                ("role".to_string(), "button".to_string()),
                ("aria-label".to_string(), "Fallback".to_string()),
            ]),
            text_value: Some("Fallback".to_string()),
            input_value: None,
            layout_text: Some("Fallback".to_string()),
            bounds: Some(ElementBounds {
                x: 10.0,
                y: 20.0,
                width: 80.0,
                height: 24.0,
            }),
            is_clickable: true,
            shadow_root_type: None,
            content_document_index: None,
        };

        let ax_node = AccessibilityNodeSnapshot {
            backend_node_id: 42,
            frame_id: Some("root".to_string()),
            ignored: false,
            role: Some("link".to_string()),
            name: Some("Open details".to_string()),
            description: None,
            value: None,
            properties: BTreeMap::from([
                ("disabled".to_string(), json!(false)),
                ("hidden".to_string(), json!(false)),
            ]),
        };

        let merged = merge_snapshot(&CapturedPageSnapshot {
            url: "https://example.com".to_string(),
            title: "Example".to_string(),
            navigation_id: "loader-1".to_string(),
            frames: Vec::new(),
            viewport: SnapshotViewport::new(0.0, 0.0, 1280.0, 720.0),
            dom_nodes: vec![dom_node],
            ax_nodes: vec![ax_node],
            warnings: Vec::new(),
        });

        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].role, "link");
        assert_eq!(merged[0].name, "Open details");
        assert!(merged[0].is_clickable);
        assert!(merged[0].is_visible);
    }
}