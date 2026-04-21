use std::collections::BTreeMap;

use chromiumoxide::cdp::browser_protocol::accessibility::{AxNode, AxProperty, AxPropertyName, AxValue};
use serde_json::Value;

use super::snapshot::AccessibilityNodeSnapshot;

pub(crate) fn normalize_ax_nodes(nodes: Vec<AxNode>) -> Vec<AccessibilityNodeSnapshot> {
    nodes
        .into_iter()
        .filter_map(|node| {
            let backend_node_id = *node.backend_dom_node_id.as_ref()?.inner();

            Some(AccessibilityNodeSnapshot {
                backend_node_id,
                frame_id: node.frame_id.map(String::from),
                ignored: node.ignored,
                role: ax_value_to_string(node.role.as_ref()),
                name: ax_value_to_string(node.name.as_ref()),
                description: ax_value_to_string(node.description.as_ref()),
                value: ax_value_to_string(node.value.as_ref()),
                properties: normalize_ax_properties(node.properties.as_deref()),
            })
        })
        .collect()
}

pub(crate) fn ax_value_to_string(value: Option<&AxValue>) -> Option<String> {
    let value = value?;
    match value.value.as_ref() {
        Some(Value::String(text)) if !text.trim().is_empty() => Some(text.trim().to_string()),
        Some(Value::Bool(flag)) => Some(flag.to_string()),
        Some(Value::Number(number)) => Some(number.to_string()),
        Some(Value::Array(items)) if !items.is_empty() => Some(Value::Array(items.clone()).to_string()),
        Some(Value::Object(object)) if !object.is_empty() => Some(Value::Object(object.clone()).to_string()),
        Some(Value::Null) | None => None,
        Some(other) => {
            let rendered = other.to_string();
            if rendered.is_empty() {
                None
            } else {
                Some(rendered)
            }
        }
    }
}

fn normalize_ax_properties(properties: Option<&[AxProperty]>) -> BTreeMap<String, Value> {
    let mut normalized = BTreeMap::new();

    for property in properties.unwrap_or_default() {
        normalized.insert(
            ax_property_name(&property.name),
            property.value.value.clone().unwrap_or(Value::Null),
        );
    }

    normalized
}

fn ax_property_name(name: &AxPropertyName) -> String {
    serde_json::to_value(name)
        .ok()
        .and_then(|value| value.as_str().map(ToOwned::to_owned))
        .unwrap_or_else(|| format!("{:?}", name).to_ascii_lowercase())
}