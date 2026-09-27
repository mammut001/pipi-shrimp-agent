/**
 * Model pricing commands
 */
use crate::pricing::{self, PricingTable};

/// Current pricing table: the saved one, or the bundled snapshot.
#[tauri::command]
pub async fn get_model_pricing_table() -> Result<PricingTable, String> {
    tokio::task::spawn_blocking(pricing::load_pricing_table)
        .await
        .map_err(|error| format!("Failed to load pricing table: {}", error))
}

/// Fetch the latest prices from OpenRouter and save them.
#[tauri::command]
pub async fn refresh_model_pricing() -> Result<PricingTable, String> {
    pricing::refresh_pricing_table().await
}
