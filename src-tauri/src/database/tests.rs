use super::*;
use super::schema::{reconcile_schema, version_at_least, LATEST_SCHEMA_VERSION};
use once_cell::sync::Lazy;
use std::sync::Mutex;

static TEST_ENV_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

fn with_temp_data_dir(test_fn: impl FnOnce(&Path)) {
    let _guard = TEST_ENV_LOCK.lock().expect("test env lock poisoned");
    let temp_dir =
        std::env::temp_dir().join(format!("pipi-shrimp-db-tests-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_dir).expect("create temp data dir");
    std::env::set_var("PIPI_SHRIMP_DATA_DIR", &temp_dir);

    test_fn(&temp_dir);

    std::env::remove_var("PIPI_SHRIMP_DATA_DIR");
    fs::remove_dir_all(&temp_dir).expect("remove temp data dir");
}

#[test]
fn backup_sibling_prefix() {
    with_temp_data_dir(|_| {
        let backup_dir = get_backup_directory().expect("backup dir");
        let backup_dir = backup_dir
            .canonicalize()
            .expect("canonicalize backup dir");

        // Accepted: real file under the managed backup directory.
        let inside = backup_dir.join("db-20240101-000000-v1.sqlite");
        fs::write(&inside, b"ok").expect("write inside backup");
        let accepted = validate_backup_path(&inside);
        assert!(
            accepted.is_ok(),
            "path under backup dir must be accepted: {:?}",
            accepted
        );

        // Rejected: sibling-prefix escape (`backups-evil/...`).
        let parent = backup_dir.parent().expect("backup parent");
        let evil_dir = parent.join(format!(
            "{}-evil",
            backup_dir
                .file_name()
                .and_then(|n| n.to_str())
                .expect("backup dir name")
        ));
        fs::create_dir_all(&evil_dir).expect("create evil sibling dir");
        let evil = evil_dir.join("db-evil.sqlite");
        fs::write(&evil, b"evil").expect("write evil backup");
        let rejected = validate_backup_path(&evil);
        assert!(
            rejected.is_err(),
            "sibling-prefix path must be rejected; got {:?}",
            rejected
        );
        let err = rejected.unwrap_err().to_string();
        assert!(
            err.contains("outside the managed backup directory"),
            "unexpected error message: {err}"
        );
    });
}

#[test]
fn backup_before_migration_creates_expected_backup_file() {
    with_temp_data_dir(|temp_dir| {
        let db_path = temp_dir.join("data.db");
        fs::write(&db_path, b"sqlite-backup-test").expect("write source db");

        let backup_path = backup_before_migration(&db_path, 7).expect("create backup");
        let backup_name = backup_path
            .file_name()
            .and_then(|name| name.to_str())
            .expect("backup file name");

        assert!(backup_path.exists());
        assert!(backup_name.starts_with("db-"));
        assert!(backup_name.ends_with("-v7.sqlite"));
        assert_eq!(
            fs::read(&backup_path).expect("read backup"),
            b"sqlite-backup-test"
        );
    });
}

#[test]
fn rotate_backups_keeps_only_latest_ten_entries() {
    with_temp_data_dir(|_| {
        let backup_dir = get_backup_directory().expect("backup dir");

        for index in 0..12 {
            let backup_name = format!("db-20240101-0000{:02}-v{}.sqlite", index, index);
            fs::write(backup_dir.join(&backup_name), format!("backup-{index}"))
                .expect("write backup fixture");
        }

        rotate_backups(&backup_dir, 10).expect("rotate backups");

        let backups = list_database_backups().expect("list backups");
        assert_eq!(backups.len(), 10);
        assert!(backups
            .iter()
            .all(|backup| !backup.name.ends_with("-v0.sqlite")));
        assert!(backups
            .iter()
            .all(|backup| !backup.name.ends_with("-v1.sqlite")));
    });
}

#[test]
fn version_at_least_handles_typical_semver_pairs() {
    assert!(version_at_least("3.35.0", "3.35.0"));
    assert!(version_at_least("3.36.0", "3.35.0"));
    assert!(version_at_least("4.0.0", "3.99.99"));
    assert!(!version_at_least("3.34.99", "3.35.0"));
    assert!(version_at_least("3.40.1", "3.35.0"));
    // Malformed strings should not panic; both should be treated
    // as a no-upgrade floor so we err on the conservative side.
    assert!(!version_at_least("3.34", "3.35.0"));
}

#[test]
fn reconcile_schema_drops_unrecognised_columns_and_ahead_rows() {
    with_temp_data_dir(|_| {
        let db_path = get_db_path();
        let conn = Connection::open(&db_path).expect("open db");

        // Bootstrap a schema that looks like a v8 prototype went
        // through and was then downgraded: the official v1 columns
        // are there, plus the rogue `goal_json` and `execution_mode`
        // columns a v8 prototype added. We seed v8 bookkeeping so
        // the test stays ahead of the current `LATEST_SCHEMA_VERSION`
        // (7) regardless of future bumps.
        conn.execute_batch(
            "
            CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
            INSERT INTO schema_version (version, applied_at) VALUES (1, 1), (2, 2), (3, 3), (4, 4), (5, 5), (6, 6), (7, 7), (8, 8);

            CREATE TABLE sessions (
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
                goal_json TEXT,
                execution_mode TEXT
            );

            CREATE TABLE messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                reasoning TEXT,
                attachments TEXT,
                artifacts TEXT,
                tool_calls TEXT,
                token_usage TEXT,
                created_at INTEGER NOT NULL
            );

            INSERT INTO sessions (id, title, created_at, updated_at)
                VALUES ('s1', 'Chat 1', 1, 1);
            INSERT INTO messages (id, session_id, role, content, created_at)
                VALUES ('m1', 's1', 'user', 'hi', 1);
            ",
        )
        .expect("seed schema");

        let changed = reconcile_schema(&conn).expect("reconcile");

        assert!(changed, "reconcile should report a change");

        // The rogue columns should be gone; the official ones stay.
        let mut stmt = conn
            .prepare("PRAGMA table_info(sessions)")
            .expect("pragma table_info");
        let columns: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .expect("query")
            .filter_map(|r| r.ok())
            .collect();
        assert!(!columns.iter().any(|c| c == "goal_json"));
        assert!(columns.iter().any(|c| c == "execution_mode"));
        assert!(columns.iter().any(|c| c == "permission_mode"));

        // The ahead-of-code schema_version row should be dropped.
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM schema_version WHERE version > ?1",
                params![LATEST_SCHEMA_VERSION],
                |row| row.get(0),
            )
            .expect("count ahead");
        assert_eq!(count, 0, "ahead-of-code rows should be rolled back");

        // User data is preserved by the reconciliation step.
        let user_rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
            .expect("count sessions");
        assert_eq!(user_rows, 1, "reconcile must not delete user data");
        let msg_rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))
            .expect("count messages");
        assert_eq!(msg_rows, 1, "reconcile must not delete user data");

        // Sanity: the file we just created is the one we expected.
        assert!(db_path.exists());
    });
}

#[test]
fn reconcile_schema_is_a_noop_when_schema_already_matches() {
    with_temp_data_dir(|_| {
        let conn = Connection::open(get_db_path()).expect("open db");
        conn.execute_batch(
            "
            CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
            INSERT INTO schema_version (version, applied_at) VALUES (1, 1), (6, 6), (7, 7);

            CREATE TABLE sessions (
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
            ",
        )
        .expect("seed schema");

        let changed = reconcile_schema(&conn).expect("reconcile");
        assert!(!changed, "no drift should mean no change");
    });
}

/// Soak knife 2: mid-tool orphan rows must survive process-restart stand-in
/// (drop global connection + reopen same data dir). Sibling session intact.
/// Does not fault-inject mid-COMMIT WAL tear — that remains deferred.
#[test]
fn orphan_messages_survive_db_reopen_after_mid_tool() {
    with_temp_data_dir(|_temp_dir| {
        {
            let mut guard = DATABASE.lock().expect("db lock");
            *guard = None;
        }
        init_database().expect("init database");

        let session_a = DbSession {
            id: "sess-crash-a".to_string(),
            title: "crash A".to_string(),
            created_at: 1,
            updated_at: 1,
            cwd: None,
            project_id: None,
            model: None,
            work_dir: None,
            working_files: None,
            permission_mode: None,
            project_dir: None,
            pipi_output_dir: None,
            execution_mode: None,
        };
        let session_b = DbSession {
            id: "sess-crash-b".to_string(),
            title: "crash B".to_string(),
            created_at: 1,
            updated_at: 1,
            cwd: None,
            project_id: None,
            model: None,
            work_dir: None,
            working_files: None,
            permission_mode: None,
            project_dir: None,
            pipi_output_dir: None,
            execution_mode: None,
        };
        save_session(&session_a).expect("save A");
        save_session(&session_b).expect("save B");

        // Mid-tool orphan on A (tool_calls, no matching result row).
        let orphan_a = DbMessage {
            id: "a-assistant-orphan".to_string(),
            session_id: "sess-crash-a".to_string(),
            role: "assistant".to_string(),
            content: "calling barrier".to_string(),
            reasoning: None,
            attachments: None,
            artifacts: None,
            tool_calls: Some(
                r#"[{"id":"tc-crash-a","name":"test_barrier_tool","arguments":"{}"}]"#
                    .to_string(),
            ),
            token_usage: None,
            created_at: 2,
        };
        let clean_b = DbMessage {
            id: "b-user".to_string(),
            session_id: "sess-crash-b".to_string(),
            role: "user".to_string(),
            content: "hello B".to_string(),
            reasoning: None,
            attachments: None,
            artifacts: None,
            tool_calls: None,
            token_usage: None,
            created_at: 2,
        };
        save_messages(&[orphan_a.clone(), clean_b.clone()]).expect("save mid-tool batch");

        let before_a = get_messages_for_session("sess-crash-a").expect("load A before");
        assert_eq!(before_a.len(), 1);
        assert!(
            before_a[0]
                .tool_calls
                .as_ref()
                .map(|t| t.contains("tc-crash-a"))
                .unwrap_or(false),
            "A must persist orphan tool_calls before reopen"
        );

        // Simulate process death: drop connection (do not delete DB files).
        {
            let mut guard = DATABASE.lock().expect("db lock");
            *guard = None;
        }

        // Reopen same PIPI_SHRIMP_DATA_DIR (WAL recovery / restart stand-in).
        init_database().expect("re-init database after crash");

        let after_a = get_messages_for_session("sess-crash-a").expect("load A after reopen");
        assert_eq!(after_a.len(), 1, "A orphan row must survive reopen");
        assert_eq!(after_a[0].id, "a-assistant-orphan");
        assert!(
            after_a[0]
                .tool_calls
                .as_ref()
                .map(|t| t.contains("tc-crash-a") && t.contains("test_barrier_tool"))
                .unwrap_or(false),
            "A tool_calls payload must survive reopen for hydrate to terminalize"
        );

        let after_b = get_messages_for_session("sess-crash-b").expect("load B after reopen");
        assert_eq!(after_b.len(), 1);
        assert_eq!(after_b[0].content, "hello B");
        assert!(
            after_b[0].tool_calls.is_none(),
            "B must not gain A's orphan tool_calls across reopen"
        );
    });
}

#[test]
fn delete_session_then_late_save_messages_does_not_resurrect() {
    with_temp_data_dir(|_| {
        {
            let mut guard = DATABASE.lock().expect("db lock");
            *guard = None;
        }
        init_database().expect("init database");

        let session = DbSession {
            id: "sess-del".to_string(),
            title: "dying".to_string(),
            created_at: 1,
            updated_at: 1,
            cwd: None,
            project_id: None,
            model: None,
            work_dir: None,
            working_files: None,
            permission_mode: None,
            project_dir: None,
            pipi_output_dir: None,
            execution_mode: None,
        };
        save_session(&session).expect("save session");
        save_message(&DbMessage {
            id: "m1".to_string(),
            session_id: "sess-del".to_string(),
            role: "assistant".to_string(),
            content: "calling".to_string(),
            reasoning: None,
            attachments: None,
            artifacts: None,
            tool_calls: Some(r#"[{"id":"tc-del"}]"#.to_string()),
            token_usage: None,
            created_at: 1,
        })
        .expect("save message");

        delete_session("sess-del").expect("delete session");
        assert!(
            get_messages_for_session("sess-del")
                .expect("load")
                .is_empty(),
            "messages must be gone after delete_session"
        );

        let late = DbMessage {
            id: "m-late".to_string(),
            session_id: "sess-del".to_string(),
            role: "assistant".to_string(),
            content: "resurrected cancel notice".to_string(),
            reasoning: None,
            attachments: None,
            artifacts: None,
            tool_calls: None,
            token_usage: None,
            created_at: 99,
        };

        let bulk = save_messages(&[late.clone()]);
        assert!(
            bulk.is_err(),
            "late db_save_messages must fail FK when session is deleted; got {:?}",
            bulk
        );
        assert!(
            get_messages_for_session("sess-del")
                .expect("load after bulk")
                .is_empty(),
            "late save_messages must not resurrect rows"
        );

        let single = save_message(&late);
        assert!(
            single.is_err(),
            "late db_save_message must fail FK when session is deleted; got {:?}",
            single
        );
        assert!(
            get_messages_for_session("sess-del")
                .expect("load after single")
                .is_empty(),
            "late save_message must not resurrect rows"
        );

        // Sibling session remains writable.
        let keep = DbSession {
            id: "sess-keep".to_string(),
            title: "keep".to_string(),
            created_at: 1,
            updated_at: 1,
            cwd: None,
            project_id: None,
            model: None,
            work_dir: None,
            working_files: None,
            permission_mode: None,
            project_dir: None,
            pipi_output_dir: None,
            execution_mode: None,
        };
        save_session(&keep).expect("save sibling session");
        save_message(&DbMessage {
            id: "m-keep".to_string(),
            session_id: "sess-keep".to_string(),
            role: "user".to_string(),
            content: "keep me".to_string(),
            reasoning: None,
            attachments: None,
            artifacts: None,
            tool_calls: None,
            token_usage: None,
            created_at: 1,
        })
        .expect("save sibling message");
        let kept = get_messages_for_session("sess-keep").expect("load sibling");
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].content, "keep me");
    });
}
