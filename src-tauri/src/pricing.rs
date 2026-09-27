/**
 * Model pricing table
 *
 * Per-model token prices from OpenRouter's public model catalog
 * (`GET https://openrouter.ai/api/v1/models`), stored in the app data dir as
 * `model_pricing.json`. Prices are USD per million tokens. The file format
 * matches tokei's `pricing.json`, so the two tables are interchangeable.
 *
 * A snapshot ships with the app so prices work offline and before the first
 * refresh. Models that disappear from the catalog are kept and marked
 * `retired`, so historical usage keeps its price.
 */
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const OPENROUTER_MODELS_URL: &str = "https://openrouter.ai/api/v1/models";
const PRICING_FILE_NAME: &str = "model_pricing.json";
const BUNDLED_SNAPSHOT: &str = include_str!("pricing/openrouter_snapshot.json");
const FETCH_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModelPrice {
    #[serde(rename = "in")]
    pub input: f64,
    #[serde(rename = "out")]
    pub output: f64,
    #[serde(default)]
    pub cache_read: f64,
    #[serde(default)]
    pub cache_write: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canonical_slug: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_length: Option<u64>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub retired: bool,
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PricingMeta {
    pub source: String,
    pub updated_at: String,
    pub count: usize,
    pub active_count: usize,
    pub retained_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PricingTable {
    #[serde(rename = "_meta")]
    pub meta: PricingMeta,
    pub models: BTreeMap<String, ModelPrice>,
}

#[derive(Deserialize)]
struct OpenRouterCatalog {
    data: Vec<OpenRouterModel>,
}

#[derive(Deserialize)]
struct OpenRouterModel {
    id: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    canonical_slug: Option<String>,
    #[serde(default)]
    context_length: Option<u64>,
    #[serde(default)]
    pricing: Option<BTreeMap<String, serde_json::Value>>,
}

/// OpenRouter quotes USD per token as strings ("0.000003"); convert to USD per
/// million tokens, rounded to 6 decimals like tokei.
fn per_million(pricing: &BTreeMap<String, serde_json::Value>, key: &str) -> f64 {
    let per_token = match pricing.get(key) {
        Some(serde_json::Value::String(text)) => text.trim().parse::<f64>().unwrap_or(0.0),
        Some(serde_json::Value::Number(number)) => number.as_f64().unwrap_or(0.0),
        _ => 0.0,
    };
    if !per_token.is_finite() || per_token < 0.0 {
        return 0.0;
    }
    (per_token * 1_000_000.0 * 1_000_000.0).round() / 1_000_000.0
}

fn non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

/// Build a pricing table from an OpenRouter `/models` response body. Free and
/// routing-placeholder entries (no prompt and no completion price) are
/// skipped. Models only present in `previous` are kept and marked retired.
pub fn parse_openrouter_catalog(
    body: &str,
    previous: Option<&PricingTable>,
    updated_at: String,
) -> Result<PricingTable, String> {
    let catalog: OpenRouterCatalog = serde_json::from_str(body)
        .map_err(|error| format!("Invalid OpenRouter models response: {}", error))?;

    let mut models = BTreeMap::new();
    for model in catalog.data {
        let Some(pricing) = model.pricing.as_ref() else {
            continue;
        };
        let input = per_million(pricing, "prompt");
        let output = per_million(pricing, "completion");
        if input == 0.0 && output == 0.0 {
            continue;
        }
        models.insert(
            model.id,
            ModelPrice {
                input,
                output,
                cache_read: per_million(pricing, "input_cache_read"),
                cache_write: per_million(pricing, "input_cache_write"),
                name: non_empty(model.name),
                canonical_slug: non_empty(model.canonical_slug),
                context_length: model.context_length.filter(|length| *length > 0),
                retired: false,
            },
        );
    }

    if models.is_empty() {
        return Err("OpenRouter returned no priced models".to_string());
    }

    let active_count = models.len();
    let mut retained_count = 0;
    if let Some(previous) = previous {
        for (id, price) in &previous.models {
            if models.contains_key(id) {
                continue;
            }
            let mut retained = price.clone();
            retained.retired = true;
            models.insert(id.clone(), retained);
            retained_count += 1;
        }
    }

    Ok(PricingTable {
        meta: PricingMeta {
            source: "openrouter/api/v1/models".to_string(),
            updated_at,
            count: models.len(),
            active_count,
            retained_count,
        },
        models,
    })
}

pub fn bundled_snapshot() -> PricingTable {
    serde_json::from_str(BUNDLED_SNAPSHOT).expect("bundled pricing snapshot is valid")
}

pub fn pricing_file_path() -> PathBuf {
    crate::database::get_data_directory().join(PRICING_FILE_NAME)
}

/// Saved table if present and readable, otherwise the bundled snapshot.
pub fn load_pricing_table_from(path: &Path) -> PricingTable {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<PricingTable>(&text).ok())
        .filter(|table| !table.models.is_empty())
        .unwrap_or_else(bundled_snapshot)
}

pub fn load_pricing_table() -> PricingTable {
    load_pricing_table_from(&pricing_file_path())
}

/// Write via a temp file + rename so a crash mid-write never leaves a
/// truncated table behind.
pub fn save_pricing_table_to(path: &Path, table: &PricingTable) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create pricing directory: {}", error))?;
    }
    let body = serde_json::to_string_pretty(table)
        .map_err(|error| format!("Failed to serialize pricing table: {}", error))?;
    let temp_path = path.with_extension("json.tmp");
    std::fs::write(&temp_path, body)
        .map_err(|error| format!("Failed to write pricing table: {}", error))?;
    std::fs::rename(&temp_path, path)
        .map_err(|error| format!("Failed to replace pricing table: {}", error))
}

pub async fn fetch_openrouter_catalog() -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .build()
        .map_err(|error| format!("Failed to build HTTP client: {}", error))?;
    let response = client
        .get(OPENROUTER_MODELS_URL)
        .send()
        .await
        .map_err(|error| format!("Failed to reach OpenRouter: {}", error))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("OpenRouter returned HTTP {}", status.as_u16()));
    }
    response
        .text()
        .await
        .map_err(|error| format!("Failed to read OpenRouter response: {}", error))
}

/// Fetch the live catalog, merge retired models from the current table, and
/// persist it. The previous table stays in place when anything fails.
pub async fn refresh_pricing_table() -> Result<PricingTable, String> {
    let body = fetch_openrouter_catalog().await?;
    let path = pricing_file_path();
    let previous = load_pricing_table_from(&path);
    let updated_at = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%z").to_string();
    let table = parse_openrouter_catalog(&body, Some(&previous), updated_at)?;
    save_pricing_table_to(&path, &table)?;
    Ok(table)
}

#[cfg(test)]
mod tests;
