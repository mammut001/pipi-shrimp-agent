//! Native OS keychain commands for discrete application secrets.
use keyring::{Entry, Error as KeyringError};

const KEYCHAIN_SERVICE: &str = "com.pipishrimp.agent";
const MAX_SECRET_KEY_LENGTH: usize = 128;

fn validate_secret_key(key: &str) -> Result<(), String> {
    if key.is_empty() {
        return Err("Secret key must not be empty.".to_string());
    }
    if key.len() > MAX_SECRET_KEY_LENGTH {
        return Err(format!(
            "Secret key must be at most {MAX_SECRET_KEY_LENGTH} bytes."
        ));
    }
    if !key
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.' | b':'))
    {
        return Err("Secret key contains unsupported characters.".to_string());
    }
    Ok(())
}

fn keyring_entry(key: &str) -> Result<Entry, String> {
    validate_secret_key(key)?;
    Entry::new(KEYCHAIN_SERVICE, key)
        .map_err(|error| format!("Could not open OS keychain entry: {error}"))
}

#[tauri::command]
pub async fn secure_storage_save(key: String, value: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let entry = keyring_entry(&key)?;
        if value.is_empty() {
            return match entry.delete_credential() {
                Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
                Err(error) => Err(format!("Could not delete OS keychain secret: {error}")),
            };
        }
        entry
            .set_password(&value)
            .map_err(|error| format!("Could not save OS keychain secret: {error}"))
    })
    .await
    .map_err(|error| format!("OS keychain worker failed: {error}"))?
}

#[tauri::command]
pub async fn secure_storage_load(key: String) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || {
        let entry = keyring_entry(&key)?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(error) => Err(format!("Could not load OS keychain secret: {error}")),
        }
    })
    .await
    .map_err(|error| format!("OS keychain worker failed: {error}"))?
}

#[tauri::command]
pub async fn secure_storage_delete(key: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let entry = keyring_entry(&key)?;
        match entry.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(error) => Err(format!("Could not delete OS keychain secret: {error}")),
        }
    })
    .await
    .map_err(|error| format!("OS keychain worker failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::validate_secret_key;

    #[test]
    fn accepts_setting_secret_identifiers() {
        assert!(validate_secret_key("telegram-token").is_ok());
        assert!(validate_secret_key("api-key-config-123").is_ok());
        assert!(validate_secret_key("provider.key:secondary").is_ok());
    }

    #[test]
    fn rejects_empty_oversized_and_path_like_secret_identifiers() {
        assert!(validate_secret_key("").is_err());
        assert!(validate_secret_key(&"a".repeat(129)).is_err());
        assert!(validate_secret_key("../telegram-token").is_err());
        assert!(validate_secret_key("telegram token").is_err());
    }
}
