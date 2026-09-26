use crate::tools::ToolCallRequest;

pub(super) fn canonicalize_approval_arguments(arguments: &str) -> String {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(arguments) else {
        return arguments.to_string();
    };
    canonicalize_json_value(&value).to_string()
}

pub(super) fn canonicalize_json_value(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let mut out = serde_json::Map::new();
            for key in keys {
                if key == "executionId" || key == "execution_id" {
                    continue;
                }
                out.insert(key.clone(), canonicalize_json_value(&map[key]));
            }
            serde_json::Value::Object(out)
        }
        serde_json::Value::Array(items) => {
            serde_json::Value::Array(items.iter().map(canonicalize_json_value).collect())
        }
        other => other.clone(),
    }
}

pub(super) fn approval_arguments_match(stored: &str, incoming: &str) -> bool {
    canonicalize_approval_arguments(stored) == canonicalize_approval_arguments(incoming)
}

pub(super) fn inject_work_dir_into_args(req: &ToolCallRequest, args: &mut serde_json::Value) {
    if let Some(object) = args.as_object_mut() {
        if let Some(work_dir) = req.work_dir.as_ref().map(|v| v.trim()).filter(|v| !v.is_empty()) {
            object
                .entry("work_dir".to_string())
                .or_insert_with(|| serde_json::Value::String(work_dir.to_string()));
        }
    }
}

pub(super) fn normalize_work_dir(work_dir: &Option<String>) -> Option<String> {
    work_dir
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}
