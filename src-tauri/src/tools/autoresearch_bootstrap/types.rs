//! Bootstrap data models and their deserialize helpers.

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PaperReference {
    pub(super) source: String,
    pub(super) title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) authors: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) year: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) venue: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) original_url: Option<String>,
    #[serde(rename = "abstract", skip_serializing_if = "Option::is_none")]
    pub(super) abstract_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) citation_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReportedMetric {
    pub(super) name: String,
    pub(super) value: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) unit: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BaselineMethod {
    pub(super) summary: String,
    #[serde(default, deserialize_with = "deserialize_optional_json_map", skip_serializing_if = "Option::is_none")]
    pub(super) key_hyperparams: Option<Map<String, Value>>,
}

fn deserialize_optional_json_map<'de, D>(
    deserializer: D,
) -> Result<Option<Map<String, Value>>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<Value>::deserialize(deserializer)?;
    match value {
        None => Ok(None),
        Some(Value::Object(map)) => Ok(Some(map)),
        Some(Value::String(raw)) => serde_json::from_str(&raw)
            .map(Some)
            .map_err(serde::de::Error::custom),
        Some(other) => Err(serde::de::Error::custom(format!(
            "expected object or JSON string for keyHyperparams, got {other}"
        ))),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Reproducibility {
    pub(super) has_official_code: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) repo_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ExtractedBaseline {
    pub(super) name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) paper: Option<PaperReference>,
    pub(super) task: String,
    pub(super) dataset: String,
    pub(super) reported_metrics: Vec<ReportedMetric>,
    pub(super) method: BaselineMethod,
    pub(super) reproducibility: Reproducibility,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ScaffoldFile {
    pub(super) path: String,
    pub(super) purpose: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ScaffoldPlan {
    pub(super) template_id: String,
    pub(super) work_dir: String,
    pub(super) language: String,
    pub(super) entry_command: String,
    pub(super) vars: Map<String, Value>,
    pub(super) files: Vec<ScaffoldFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BootstrapPlan {
    pub(super) research_goal: String,
    pub(super) success_criteria: String,
    pub(super) primary_metric: String,
    pub(super) secondary_metrics: Vec<String>,
    pub(super) papers: Vec<PaperReference>,
    pub(super) baselines: Vec<ExtractedBaseline>,
    pub(super) scaffold: ScaffoldPlan,
    pub(super) git_initialized: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) initial_commit_sha: Option<String>,
    pub(super) conversational_template_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AutoResearchBootstrapResult {
    pub(super) status: String,
    pub(super) plan: BootstrapPlan,
    pub(super) warnings: Vec<String>,
    pub(super) unresolved_questions: Vec<String>,
    pub(super) created_at: String,
    pub(super) schema_version: u8,
}

#[derive(Debug, Clone)]
pub(super) struct TemplateFileSource {
    pub(super) output: &'static str,
    pub(super) purpose: &'static str,
    pub(super) content: &'static str,
}

#[derive(Debug, Clone)]
pub(super) struct TemplateDefinition {
    pub(super) language: &'static str,
    pub(super) entry_command: &'static str,
    pub(super) required_vars: &'static [&'static str],
    pub(super) files: &'static [TemplateFileSource],
}

#[derive(Debug, Clone, Serialize)]
pub(super) struct RenderedScaffoldFile {
    pub(super) path: String,
    pub(super) purpose: String,
    pub(super) content: String,
}

#[derive(Debug, Clone, Serialize)]
pub(super) struct ScaffoldRenderResult {
    pub(super) scaffold: ScaffoldPlan,
    pub(super) rendered_files: Vec<RenderedScaffoldFile>,
}

pub(super) trait IfEmptyThen {
    fn if_empty_then(self, fallback: &str) -> String;
}

impl IfEmptyThen for String {
    fn if_empty_then(self, fallback: &str) -> String {
        if self.trim().is_empty() {
            fallback.to_string()
        } else {
            self
        }
    }
}
