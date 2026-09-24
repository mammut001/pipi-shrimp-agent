use super::schema::{checkpoint_database, current_schema_version};
use super::{
    get_data_directory, get_db, get_db_path, init_database, path_with_suffix, storage_error,
};
use rusqlite::{Connection, Result as SqliteResult};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbBackupEntry {
    pub name: String,
    pub path: String,
    pub created_at: i64,
    pub schema_version: i64,
    pub size_bytes: u64,
}

const MAX_DATABASE_BACKUPS: usize = 10;

pub fn get_backup_directory() -> SqliteResult<PathBuf> {
    let backup_dir = get_data_directory().join("backups");
    fs::create_dir_all(&backup_dir)
        .map_err(|e| storage_error(format!("Failed to create backup directory: {}", e)))?;
    Ok(backup_dir)
}

fn parse_backup_schema_version(file_name: &str) -> Option<i64> {
    file_name
        .strip_prefix("db-")?
        .strip_suffix(".sqlite")?
        .rsplit_once("-v")?
        .1
        .parse::<i64>()
        .ok()
}

pub fn list_database_backups() -> SqliteResult<Vec<DbBackupEntry>> {
    let backup_dir = get_backup_directory()?;
    let mut backups = Vec::new();

    for entry in fs::read_dir(&backup_dir)
        .map_err(|e| storage_error(format!("Failed to read backup directory: {}", e)))?
    {
        let entry =
            entry.map_err(|e| storage_error(format!("Failed to read backup entry: {}", e)))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !file_name.starts_with("db-") || !file_name.ends_with(".sqlite") {
            continue;
        }

        let metadata = entry
            .metadata()
            .map_err(|e| storage_error(format!("Failed to read backup metadata: {}", e)))?;
        let created_at = metadata
            .modified()
            .ok()
            .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs() as i64)
            .unwrap_or(0);

        backups.push(DbBackupEntry {
            name: file_name.to_string(),
            path: path.display().to_string(),
            created_at,
            schema_version: parse_backup_schema_version(file_name).unwrap_or(0),
            size_bytes: metadata.len(),
        });
    }

    backups.sort_by(|left, right| right.name.cmp(&left.name));
    Ok(backups)
}

pub(super) fn rotate_backups(backup_dir: &Path, keep: usize) -> SqliteResult<()> {
    let mut backups = list_database_backups()?;
    backups.sort_by(|left, right| right.name.cmp(&left.name));

    for backup in backups.into_iter().skip(keep) {
        let backup_path = backup_dir.join(&backup.name);
        if backup_path.exists() {
            fs::remove_file(&backup_path).map_err(|e| {
                storage_error(format!(
                    "Failed to remove old backup {}: {}",
                    backup_path.display(),
                    e
                ))
            })?;
        }
    }

    Ok(())
}

pub fn backup_before_migration(db_path: &Path, schema_version: i64) -> SqliteResult<PathBuf> {
    let backup_dir = get_backup_directory()?;
    let timestamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let backup_path = backup_dir.join(format!("db-{}-v{}.sqlite", timestamp, schema_version));

    fs::copy(db_path, &backup_path).map_err(|e| {
        storage_error(format!(
            "Failed to create database backup at {}: {}",
            backup_path.display(),
            e
        ))
    })?;

    rotate_backups(&backup_dir, MAX_DATABASE_BACKUPS)?;
    Ok(backup_path)
}

pub(super) fn validate_backup_path(backup_path: &Path) -> SqliteResult<PathBuf> {
    let canonical_backup_path = backup_path.canonicalize().map_err(|e| {
        storage_error(format!(
            "Failed to access backup {}: {}",
            backup_path.display(),
            e
        ))
    })?;
    let backup_dir = get_backup_directory()?
        .canonicalize()
        .map_err(|e| storage_error(format!("Failed to access backup directory: {}", e)))?;

    // AUDIT-FIX [R2-06] — Use `is_within_dir` so a sibling like
    // `{backup_dir}-evil/...` cannot pass a naive prefix / starts_with check.
    if !crate::commands::path_security::is_within_dir(&canonical_backup_path, &backup_dir) {
        return Err(storage_error(format!(
            "Backup path {} is outside the managed backup directory",
            backup_path.display()
        )));
    }

    Ok(canonical_backup_path)
}

fn copy_database_file(source_path: &Path, destination_path: &Path) -> SqliteResult<PathBuf> {
    if let Some(parent) = destination_path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            storage_error(format!(
                "Failed to prepare export directory {}: {}",
                parent.display(),
                e
            ))
        })?;
    }

    fs::copy(source_path, destination_path).map_err(|e| {
        storage_error(format!(
            "Failed to copy database from {} to {}: {}",
            source_path.display(),
            destination_path.display(),
            e
        ))
    })?;

    Ok(destination_path.to_path_buf())
}

pub fn export_database_backup_file(
    destination_path: &Path,
    backup_source_path: Option<&Path>,
) -> SqliteResult<PathBuf> {
    let source_path = if let Some(backup_source_path) = backup_source_path {
        validate_backup_path(backup_source_path)?
    } else {
        let db_path = get_db_path();
        let guard = get_db()?;
        if let Some(conn) = guard.as_ref() {
            checkpoint_database(conn)?;
        }
        db_path
    };

    copy_database_file(&source_path, destination_path)
}

pub fn restore_database_from_backup(backup_path: &Path) -> SqliteResult<()> {
    let validated_backup_path = validate_backup_path(backup_path)?;
    let db_path = get_db_path();
    let wal_path = path_with_suffix(&db_path, "-wal");
    let shm_path = path_with_suffix(&db_path, "-shm");

    let existing_schema_version = {
        let guard = get_db()?;
        if let Some(conn) = guard.as_ref() {
            checkpoint_database(conn)?;
            current_schema_version(conn)
        } else if db_path.exists() {
            Connection::open(&db_path)
                .map(|conn| current_schema_version(&conn))
                .unwrap_or(0)
        } else {
            0
        }
    };

    if db_path.exists()
        && fs::metadata(&db_path)
            .map(|metadata| metadata.len())
            .unwrap_or(0)
            > 0
    {
        backup_before_migration(&db_path, existing_schema_version)?;
    }

    {
        let mut guard = get_db()?;
        *guard = None;
    }

    if wal_path.exists() {
        fs::remove_file(&wal_path).map_err(|e| {
            storage_error(format!(
                "Failed to remove WAL file {}: {}",
                wal_path.display(),
                e
            ))
        })?;
    }
    if shm_path.exists() {
        fs::remove_file(&shm_path).map_err(|e| {
            storage_error(format!(
                "Failed to remove SHM file {}: {}",
                shm_path.display(),
                e
            ))
        })?;
    }
    if db_path.exists() {
        fs::remove_file(&db_path).map_err(|e| {
            storage_error(format!(
                "Failed to replace database {}: {}",
                db_path.display(),
                e
            ))
        })?;
    }

    copy_database_file(&validated_backup_path, &db_path)?;
    init_database()
}
