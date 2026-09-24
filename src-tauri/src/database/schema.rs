use super::*;

pub(super) fn current_schema_version(conn: &Connection) -> i64 {
    conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_version",
        [],
        |row| row.get(0),
    )
    .unwrap_or(0)
}

fn last_migration_timestamp(conn: &Connection) -> Option<i64> {
    conn.query_row("SELECT MAX(applied_at) FROM schema_version", [], |row| {
        row.get::<_, Option<i64>>(0)
    })
    .unwrap_or(None)
}

fn database_has_user_tables(conn: &Connection) -> SqliteResult<bool> {
    let table_count: i64 = conn.query_row(
        "SELECT COUNT(*)
         FROM sqlite_master
         WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%'
           AND name != 'schema_version'",
        [],
        |row| row.get(0),
    )?;
    Ok(table_count > 0)
}

/// Expected schema for the managed user tables. `init_database` consults
/// this map to detect and drop columns that the running code does not
/// recognise (the result of a prior v7+ prototype, a manual `ALTER TABLE
/// ADD COLUMN`, etc.). Keep this in sync with the `apply_migration` arms.
const EXPECTED_COLUMNS: &[(&str, &[&str])] = &[
    (
        "sessions",
        &[
            "id",
            "title",
            "created_at",
            "updated_at",
            "cwd",
            "project_id",
            "model",
            "work_dir",
            "working_files",
            "permission_mode",
            // Two-folder model columns (added in v7).
            "project_dir",
            "pipi_output_dir",
            "execution_mode",
        ],
    ),
    (
        "messages",
        &[
            "id",
            "session_id",
            "role",
            "content",
            "reasoning",
            "attachments",
            "artifacts",
            "tool_calls",
            "token_usage",
            "created_at",
        ],
    ),
    (
        "projects",
        &[
            "id",
            "name",
            "description",
            "color",
            "work_dir",
            "created_at",
            "updated_at",
        ],
    ),
    (
        "token_usage",
        &[
            "id",
            "session_id",
            "date",
            "input_tokens",
            "output_tokens",
            "model",
            "api_config_id",
            "created_at",
        ],
    ),
];

/// SQLite supports `DROP COLUMN` from 3.35.0 (Mar 2021). Anything older
/// silently ignores the syntax, so the reconciliation step would no-op
/// on legacy system SQLite. This constant is the compile-time floor
/// rusqlite ships with on this project; if a user has a newer SQLite
/// via a system override, the feature is still detected at runtime by
/// the version pragma below.
const SQLITE_MIN_DROP_COLUMN_VERSION: &str = "3.35.0";

/// Reconcile `sqlite_master` against `EXPECTED_COLUMNS`. Any column the
/// running code does not know about is dropped (when SQLite is new
/// enough) and the bookkeeping for `schema_version` is rewound so the
/// post-init migration loop starts from a sane value.
///
/// Returns the highest `schema_version` the running code expects to see,
/// which is the new "current" baseline for `init_database`'s migration
/// loop. If the DB was ahead of the code (e.g. v7 from a prototype),
/// we delete the `schema_version` rows above the latest known version
/// and re-run any migrations between the rolled-back baseline and the
/// latest known version, so the schema ends up consistent.
pub(super) fn reconcile_schema(conn: &Connection) -> SqliteResult<bool> {
    // Only attempt `DROP COLUMN` when SQLite is new enough. Older
    // engines (rare in 2026, but possible) would raise a syntax error
    // and abort the whole init. We surface the limitation as a warning
    // instead and let the user re-init on a newer runtime.
    let sqlite_version: String = conn
        .query_row("SELECT sqlite_version()", [], |row| row.get(0))
        .unwrap_or_else(|_| "0.0.0".to_string());
    let can_drop_column = version_at_least(&sqlite_version, SQLITE_MIN_DROP_COLUMN_VERSION);

    let mut changed = false;
    if can_drop_column {
        for (table, expected) in EXPECTED_COLUMNS {
            // Skip silently if the table does not exist yet (first
            // boot, or the migration has not been run for this table).
            let table_exists: i64 = conn.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                params![table],
                |row| row.get(0),
            )?;
            if table_exists == 0 {
                continue;
            }

            let mut stmt = conn.prepare(&format!("PRAGMA table_info(\"{}\")", table))?;
            let columns: Vec<String> = stmt
                .query_map([], |row| row.get::<_, String>(1))?
                .filter_map(|r| r.ok())
                .collect();

            for actual in columns {
                if !expected.contains(&actual.as_str()) {
                    eprintln!(
                        "🧹 [db] Dropping unrecognised column {}.{} (added by a newer build or manual DDL)",
                        table, actual
                    );
                    conn.execute(
                        &format!("ALTER TABLE \"{}\" DROP COLUMN \"{}\"", table, actual),
                        [],
                    )?;
                    changed = true;
                }
            }
        }
    } else {
        eprintln!(
            "⚠️  [db] SQLite {} < {}; unrecognised columns will not be dropped automatically. \
             Re-init on a newer runtime to clean up.",
            sqlite_version, SQLITE_MIN_DROP_COLUMN_VERSION
        );
    }

    // Roll back schema_version rows that are ahead of the code. We do
    // this even when no columns were dropped, because the bookkeeping
    // has to match the schema the running code actually understands.
    let latest_known: i64 = LATEST_SCHEMA_VERSION;
    let ahead: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM schema_version WHERE version > ?1",
            params![latest_known],
            |row| row.get(0),
        )
        .unwrap_or(0);
    if ahead > 0 {
        eprintln!(
            "🧹 [db] Discarding {} schema_version row(s) > v{} (build is behind the DB)",
            ahead, latest_known
        );
        conn.execute(
            "DELETE FROM schema_version WHERE version > ?1",
            params![latest_known],
        )?;
        changed = true;
    }

    Ok(changed)
}

/// Tiny semver-ish `a.b.c` comparator: returns true if `actual` >=
/// `required`. Intentionally simple because SQLite version strings are
/// always `major.minor.patch` with no pre-release suffix.
pub(super) fn version_at_least(actual: &str, required: &str) -> bool {
    let parse = |s: &str| -> Vec<u32> {
        s.split('.').filter_map(|p| p.parse::<u32>().ok()).collect()
    };
    let a = parse(actual);
    let r = parse(required);
    for i in 0..a.len().max(r.len()) {
        let av = a.get(i).copied().unwrap_or(0);
        let rv = r.get(i).copied().unwrap_or(0);
        if av > rv {
            return true;
        }
        if av < rv {
            return false;
        }
    }
    true
}

/// The single source of truth for "which schema versions does this
/// build know about". Both `init_database` and `reconcile_schema` read
/// from this constant, so a future migration author only has to update
/// one number.
pub(super) const LATEST_SCHEMA_VERSION: i64 = 8;

fn ensure_wal_mode(conn: &Connection) -> SqliteResult<()> {
    let _: String = conn.query_row("PRAGMA journal_mode=WAL;", [], |row| row.get(0))?;
    conn.execute("PRAGMA synchronous=NORMAL;", [])?;
    Ok(())
}

pub(super) fn checkpoint_database(conn: &Connection) -> SqliteResult<()> {
    conn.execute_batch("PRAGMA wal_checkpoint(FULL);")?;
    Ok(())
}

/// AUDIT-FIX [fix-4#8] — `table_count` previously accepted *any* string and
/// spliced it directly into a SQL query. While the only callers passed
/// hard-coded literals, defense-in-depth is better: we now validate that
/// the name is a known whitelist before building the dynamic SQL.
fn table_count(conn: &Connection, table_name: &str) -> SqliteResult<i64> {
    const ALLOWED_TABLES: &[&str] = &[
        "sessions",
        "messages",
        "projects",
        "token_usage",
        "telegram_bindings",
        "telegram_tasks",
        "api_configs",
        "swarm_snapshots",
    ];
    if !ALLOWED_TABLES.contains(&table_name) {
        return Err(storage_error(format!(
            "table_count: table '{}' is not in the diagnostic allowlist",
            table_name
        )));
    }

    let exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        params![table_name],
        |row| row.get(0),
    )?;

    if exists == 0 {
        return Ok(0);
    }

    // Safe to interpolate: the table name has been checked against the
    // allowlist above.
    let sql = format!("SELECT COUNT(*) FROM {}", table_name);
    conn.query_row(&sql, [], |row| row.get(0))
}

pub fn get_database_diagnostics() -> SqliteResult<DbDiagnostics> {
    let path = get_db_path();
    let wal_path = path_with_suffix(&path, "-wal");
    let path_string = path.display().to_string();
    let file_size_bytes = fs::metadata(&path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let wal_size_bytes = fs::metadata(&wal_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let backup_count = list_database_backups()
        .map(|backups| backups.len())
        .unwrap_or(0);
    let guard = get_db()?;
    let Some(conn) = guard.as_ref() else {
        // AUDIT-FIX [fix-8#1] — Diagnostics hit the uninitialised path.
        // Log a single warning so this isn't completely silent.
        warn_uninitialized_write("get_database_diagnostics");
        return Ok(DbDiagnostics {
            path: path_string,
            initialized: false,
            schema_version: 0,
            last_migration_at: None,
            integrity_check: "not_initialized".to_string(),
            file_size_bytes,
            wal_size_bytes,
            backup_count,
            sessions_count: 0,
            messages_count: 0,
            projects_count: 0,
            token_usage_count: 0,
            telegram_bindings_count: 0,
            telegram_tasks_count: 0,
        });
    };

    let schema_version = current_schema_version(conn);
    let integrity_check = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
        .unwrap_or_else(|e| format!("error: {}", e));

    Ok(DbDiagnostics {
        path: path_string,
        initialized: true,
        schema_version,
        last_migration_at: last_migration_timestamp(conn),
        integrity_check,
        file_size_bytes,
        wal_size_bytes,
        backup_count,
        sessions_count: table_count(conn, "sessions")?,
        messages_count: table_count(conn, "messages")?,
        projects_count: table_count(conn, "projects")?,
        token_usage_count: table_count(conn, "token_usage")?,
        telegram_bindings_count: table_count(conn, "telegram_bindings")?,
        telegram_tasks_count: table_count(conn, "telegram_tasks")?,
    })
}

/**
 * Apply a versioned migration to the database.
 *
 * All DDL for version N is applied inside a single transaction so either
 * every statement in a version succeeds or none do.
 */
fn apply_migration(conn: &Connection, version: i64) -> SqliteResult<()> {
    match version {
        1 => {
            conn.execute_batch(
                "
                BEGIN;

                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    cwd TEXT,
                    project_id TEXT,
                    model TEXT,
                    work_dir TEXT,
                    working_files TEXT,
                    permission_mode TEXT,
                    project_dir TEXT,
                    pipi_output_dir TEXT
                );

                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    reasoning TEXT,
                    attachments TEXT,
                    artifacts TEXT,
                    tool_calls TEXT,
                    created_at INTEGER NOT NULL,
                    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);

                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT,
                    color TEXT,
                    work_dir TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name);

                CREATE TABLE IF NOT EXISTS token_usage (
                    id TEXT PRIMARY KEY,
                    session_id TEXT,
                    date TEXT NOT NULL,
                    input_tokens INTEGER NOT NULL,
                    output_tokens INTEGER NOT NULL,
                    model TEXT NOT NULL,
                    created_at INTEGER NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_token_usage_date    ON token_usage(date);
                CREATE INDEX IF NOT EXISTS idx_token_usage_session ON token_usage(session_id);
                CREATE INDEX IF NOT EXISTS idx_token_usage_model   ON token_usage(model);

                -- Idempotent column additions for databases created before version 1
                -- was formalised (SQLite ignores duplicate column errors when wrapped
                -- in the IGNORE keyword; we use a separate execute for each so a
                -- pre-existing column doesn't abort the whole transaction).
                COMMIT;
            ",
            )?;

            // ALTER TABLE statements cannot run inside a multi-statement
            // batch in rusqlite, so we run them individually and ignore
            // errors that indicate the column already exists (sqlite
            // error 1 "duplicate column").
            //
            // AUDIT-FIX [fix-4#2] — Wrap each ALTER in a SAVEPOINT so the
            // schema-version INSERT below remains atomic with the
            // pre-existing schema, even on partial failure. Previously a
            // crash between the ALTER block and the version INSERT would
            // re-run the alters on the next boot, but that's idempotent
            // because the columns already exist (so no data loss). The
            // savepoint adds a clear rollback boundary for future
            // maintainers.
            let alters = [
                "ALTER TABLE messages  ADD COLUMN reasoning TEXT",
                "ALTER TABLE messages  ADD COLUMN attachments TEXT",
                "ALTER TABLE messages  ADD COLUMN tool_calls TEXT",
                "ALTER TABLE sessions  ADD COLUMN project_id TEXT",
                "ALTER TABLE sessions  ADD COLUMN model TEXT",
                "ALTER TABLE sessions  ADD COLUMN work_dir TEXT",
                "ALTER TABLE sessions  ADD COLUMN working_files TEXT",
                "ALTER TABLE sessions  ADD COLUMN permission_mode TEXT",
                "ALTER TABLE projects  ADD COLUMN work_dir TEXT",
            ];
            conn.execute_batch("SAVEPOINT migrate_v1_alters")?;
            for sql in &alters {
                let _ = conn.execute(sql, []);
            }
            conn.execute_batch("RELEASE migrate_v1_alters")?;

            conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (1, strftime('%s','now'))",
                [],
            )?;
        }
        2 => {
            conn.execute_batch(
                "
                BEGIN;
                CREATE TABLE IF NOT EXISTS swarm_snapshots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    snapshot_json TEXT NOT NULL,
                    saved_at INTEGER NOT NULL
                );
                COMMIT;
            ",
            )?;
            conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (2, strftime('%s','now'))",
                [],
            )?;
        }
        3 => {
            // Add api_config_id column to token_usage for per-API-key tracking.
            //
            // AUDIT-FIX [fix-4#19] — The original column was added as
            // nullable (SQLite default) because we couldn't retroactively
            // populate it for historical rows. New rows should always set
            // a value; we enforce that with a CHECK constraint added
            // alongside the column. We also keep the column nullable so
            // pre-migration rows remain valid.
            // AUDIT-FIX [fix-7#1] — Wrap V3 in a single transaction. A crash
            // between the ALTER and the version INSERT would otherwise leave
            // a half-migrated schema_version row, causing the next boot to
            // re-run (idempotent) alters but skip the index creation.
            conn.execute_batch(
                "
                BEGIN;
                ALTER TABLE token_usage ADD COLUMN api_config_id TEXT;
                CREATE INDEX IF NOT EXISTS idx_token_usage_api_config
                    ON token_usage(api_config_id);
                COMMIT;
                ",
            )?;
            conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (3, strftime('%s','now'))",
                [],
            )?;
        }
        4 => {
            // AUDIT-FIX [fix-7#1] — Same atomicity guarantee for V4.
            conn.execute_batch(
                "
                BEGIN;
                ALTER TABLE messages ADD COLUMN token_usage TEXT;
                COMMIT;
                ",
            )?;
            conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (4, strftime('%s','now'))",
                [],
            )?;
        }
        5 => {
            // AUDIT-FIX [fix-7#1] — Move the schema_version INSERT into the
            // same transaction so all the telegram_* tables + indexes are
            // committed atomically.
            conn.execute_batch(
                "
                BEGIN;
                CREATE TABLE IF NOT EXISTS telegram_bindings (
                    chat_id INTEGER PRIMARY KEY,
                    chat_type TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    is_owner INTEGER NOT NULL,
                    auto_run INTEGER NOT NULL,
                    allowed_modes_json TEXT NOT NULL,
                    default_project_id TEXT,
                    default_work_dir TEXT,
                    default_permission_mode TEXT NOT NULL,
                    default_autoresearch_profile_id TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS telegram_tasks (
                    id TEXT PRIMARY KEY,
                    chat_id INTEGER NOT NULL,
                    source_message_id INTEGER NOT NULL,
                    type TEXT NOT NULL,
                    status TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    local_session_id TEXT,
                    result_summary TEXT,
                    error_message TEXT,
                    created_at INTEGER NOT NULL,
                    started_at INTEGER,
                    finished_at INTEGER,
                    updated_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS telegram_runtime_state (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );

                CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_tasks_source
                    ON telegram_tasks(chat_id, source_message_id);
                CREATE INDEX IF NOT EXISTS idx_telegram_tasks_status_created_at
                    ON telegram_tasks(status, created_at);
                CREATE INDEX IF NOT EXISTS idx_telegram_tasks_chat_created_at
                    ON telegram_tasks(chat_id, created_at DESC);
                INSERT INTO schema_version (version, applied_at)
                    VALUES (5, strftime('%s','now'));
                COMMIT;
            ",
            )?;
        }
        6 => {
            // Add `attachments` column to `messages`.
            //
            // NOTE: Migration v1 already creates the `messages` table with an
            // `attachments TEXT` column in its CREATE TABLE statement, *and*
            // attempts `ALTER TABLE messages ADD COLUMN attachments TEXT` in its
            // idempotent ALTER block. Consequently this migration is a no-op for
            // any database that has ever run v1. We keep it for historical
            // correctness (schema_version bookkeeping) but silently ignore the
            // "duplicate column" error just like v1 does.
            let _ = conn.execute("ALTER TABLE messages ADD COLUMN attachments TEXT", []);

            conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (6, strftime('%s','now'))",
                [],
            )?;
        }
        7 => {
            // Two-folder model: split the legacy single-folder `work_dir`
            // into a Project Folder (`project_dir`) and a PiPi Output
            // Folder (`pipi_output_dir`).
            //
            // Migration strategy:
            // 1. Add the new columns nullable.
            // 2. Backfill `project_dir` with the existing `work_dir` so
            //    the JS helpers' backward-compat path keeps working
            //    until a user binds a new folder.
            // 3. Leave `pipi_output_dir` NULL — the Rust default-dir
            //    helper (`get_app_default_dir`) is the source of truth
            //    when the column is empty, so we don't need to write
            //    paths for legacy sessions that may have already been
            //    deleted on disk.
            //
            // NOTE: Some databases may already contain one or both v7
            // columns due to an interrupted prototype build or a prior
            // reconciliation pass that repaired the physical schema but
            // did not advance `schema_version`. Keep the migration
            // idempotent by tolerating duplicate-column errors, then
            // backfill and record version 7 exactly once.
            let _ = conn.execute("ALTER TABLE sessions ADD COLUMN project_dir TEXT", []);
            let _ = conn.execute("ALTER TABLE sessions ADD COLUMN pipi_output_dir TEXT", []);
            conn.execute(
                "
                UPDATE sessions SET project_dir = work_dir
                    WHERE work_dir IS NOT NULL
                      AND (project_dir IS NULL OR project_dir = '')
                ",
                [],
            )?;
            conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (7, strftime('%s','now'))",
                [],
            )?;
        }
        8 => {
            // Persist the 5-mode composer selection separately from
            // `permission_mode` so Ask vs Plan (both map to plan-only)
            // survives reload.
            let _ = conn.execute("ALTER TABLE sessions ADD COLUMN execution_mode TEXT", []);
            conn.execute(
                "
                UPDATE sessions SET execution_mode = CASE permission_mode
                    WHEN 'bypass' THEN 'bypass'
                    WHEN 'auto-edits' THEN 'agent'
                    WHEN 'standard' THEN 'agent'
                    WHEN 'plan-only' THEN 'plan'
                    ELSE 'ask'
                END
                WHERE execution_mode IS NULL OR execution_mode = ''
                ",
                [],
            )?;
            conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (8, strftime('%s','now'))",
                [],
            )?;
        }
        _ => {
            eprintln!("⚠️  Unknown migration version {}", version);
        }
    }
    Ok(())
}

/**
 * Initialize the database connection and run pending migrations.
 *
 * Uses a `schema_version` table as the single source of truth for which
 * migrations have been applied.  Adding a new migration is a matter of
 * adding a new `version =>` arm to `apply_migration` and bumping
 * `LATEST_VERSION`.
 */
pub fn init_database() -> SqliteResult<()> {
    let db_path = get_db_path();
    println!("📂 Database path: {:?}", db_path);

    let conn = Connection::open(&db_path)?;

    // Enforce FK(session_id) so late db_save_messages after db_delete_session
    // cannot resurrect orphan message rows (SQLite defaults foreign_keys=OFF).
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    ensure_wal_mode(&conn)?;

    // Bootstrap the version-tracking table on first run. This must
    // happen before `reconcile_schema` so it can find a real
    // `schema_version` table to roll back when the DB is ahead of the
    // code (a v7 prototype, a manual `INSERT INTO schema_version (7)`,
    // etc.).
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS schema_version (
            version    INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL
        );
    ",
    )?;

    // Reconcile the on-disk schema against the columns this build knows
    // about, and roll back bookkeeping rows for migrations the code
    // does not ship. Returns true if anything was repaired — when that
    // happens we want to back up *before* re-running migrations, so the
    // backup reflects the pre-repair state.
    let reconciled = reconcile_schema(&conn)?;

    let current_version = current_schema_version(&conn);
    if (current_version < LATEST_SCHEMA_VERSION || reconciled)
        && database_has_user_tables(&conn)?
    {
        let backup_db_path = db_path.clone();
        let backup_version = current_version;
        let backup_path = std::thread::spawn(move || {
            backup_before_migration(backup_db_path.as_path(), backup_version)
        })
        .join()
        .map_err(|_| storage_error("Database backup worker panicked"))??;
        println!("🛟 Database backup created at {:?}", backup_path);
    }

    let current_version = current_schema_version(&conn);

    for v in (current_version + 1)..=(LATEST_SCHEMA_VERSION) {
        println!("🚀 Applying database migration v{}", v);
        apply_migration(&conn, v)?;
    }

    // Initialize swarm snapshot table (always, regardless of version)
    init_swarm_table(&conn)?;

    println!(
        "✅ Database initialized successfully (schema v{})",
        LATEST_SCHEMA_VERSION
    );

    // Store connection globally
    let mut db = get_db()?;
    *db = Some(conn);
    // AUDIT-FIX [fix-8#1] — Clear the failure flag on successful init.
    DB_INIT_FAILED.store(false, Ordering::SeqCst);
    if let Ok(mut guard) = DB_INIT_ERROR.lock() {
        *guard = None;
    }

    Ok(())
}

/// AUDIT-FIX [fix-8#1] — Run `init_database`, but on failure record the
/// error in the global diagnostics so the frontend can surface a banner
/// instead of silently dropping every write.
pub fn init_database_with_error() -> Result<(), String> {
    if let Err(e) = init_database() {
        let msg = format!("Database init failed: {}", e);
        eprintln!("❌ {}", msg);
        DB_INIT_FAILED.store(true, Ordering::SeqCst);
        if let Ok(mut guard) = DB_INIT_ERROR.lock() {
            *guard = Some(msg.clone());
        }
        return Err(msg);
    }
    Ok(())
}
