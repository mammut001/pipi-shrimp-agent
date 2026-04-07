/**
 * Configuration commands
 *
 * Handles app configuration storage and retrieval
 */

use crate::utils::{AppResult, AppError};
use std::fs;
use std::path::PathBuf;

/// Validate that a config key only contains safe characters.
/// Prevents path traversal attacks via key injection (e.g. "../../etc/passwd").
fn validate_config_key(key: &str) -> AppResult<()> {
    if key.is_empty() {
        return Err(AppError::InvalidInput("Config key cannot be empty".to_string()));
    }
    if !key.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-') {
        return Err(AppError::InvalidInput(format!(
            "Invalid config key '{}': only alphanumeric characters, underscores, and hyphens are allowed",
            key
        )));
    }
    Ok(())
}

/// Get the config directory path
fn get_config_dir() -> AppResult<PathBuf> {
    let config_dir = dirs::config_dir()
        .ok_or_else(|| "Failed to get config directory".to_string())?
        .join("tauri-ai-agent");

    if !config_dir.exists() {
        fs::create_dir_all(&config_dir)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }

    Ok(config_dir)
}

/**
 * Get a configuration value by key
 *
 * Returns the value as a JSON string
 */
#[tauri::command]
pub async fn get_config(key: String) -> AppResult<String> {
    validate_config_key(&key)?;
    let config_dir = get_config_dir()?;
    let config_file = config_dir.join(format!("{}.json", key));

    if !config_file.exists() {
        return Ok("{}".to_string());
    }

    let content = fs::read_to_string(&config_file)
        .map_err(|e| format!("Failed to read config: {}", e))?;

    Ok(content)
}

/**
 * Set a configuration value by key
 *
 * Stores the value as JSON
 */
#[tauri::command]
pub async fn set_config(key: String, value: String) -> AppResult<String> {
    validate_config_key(&key)?;
    let config_dir = get_config_dir()?;
    let config_file = config_dir.join(format!("{}.json", key));

    fs::write(&config_file, &value)
        .map_err(|e| format!("Failed to write config: {}", e))?;

    Ok("Config saved".to_string())
}

/**
 * Delete a configuration value by key
 */
#[tauri::command]
pub async fn delete_config(key: String) -> AppResult<String> {
    validate_config_key(&key)?;
    let config_dir = get_config_dir()?;
    let config_file = config_dir.join(format!("{}.json", key));

    if config_file.exists() {
        fs::remove_file(&config_file)
            .map_err(|e| format!("Failed to delete config: {}", e))?;
    }

    Ok("Config deleted".to_string())
}
