use super::*;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

fn create_temp_root(label: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be monotonic enough for tests")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("pipi-shrimp-file-test-{}-{}", label, unique));
    fs::create_dir_all(&root).expect("temp root should be created");
    root
}

#[test]
fn write_file_round_trip_reads_same_content() {
    let root = create_temp_root("round-trip");
    let root_string = root.to_string_lossy().to_string();
    let relative_path = "nested/output/result.txt";
    let expected = "alpha\nbeta\ngamma\n";

    let write_result = write_file_for_tool(relative_path, expected, Some(root_string.as_str()))
        .expect("write_file_for_tool should succeed");
    let read_result = read_file_for_tool(relative_path, Some(root_string.as_str()))
        .expect("read_file_for_tool should succeed");

    assert!(write_result.contains("Successfully wrote"));
    assert_eq!(read_result.content, expected);

    fs::remove_dir_all(root).expect("temp root should be removed");
}

#[cfg(unix)]
#[test]
fn write_file_returns_structured_error_for_permission_denied() {
    let root = create_temp_root("permission-denied");
    let root_string = root.to_string_lossy().to_string();
    let read_only_dir = root.join("readonly");
    fs::create_dir_all(&read_only_dir).expect("read-only dir should be created");

    let mut permissions = fs::metadata(&read_only_dir)
        .expect("metadata should exist")
        .permissions();
    permissions.set_mode(0o555);
    fs::set_permissions(&read_only_dir, permissions).expect("permissions should be set");

    let error = write_file_for_tool(
        "readonly/blocked.txt",
        "blocked",
        Some(root_string.as_str()),
    )
    .expect_err("write_file_for_tool should fail in read-only dir");

    assert_eq!(error.error_kind, "access_denied");
    assert_eq!(error.path, "readonly/blocked.txt");
    assert!(error.message.contains("readonly/blocked.txt"));
    assert!(error.cause.to_lowercase().contains("permission denied"));

    let mut cleanup_permissions = fs::metadata(&read_only_dir)
        .expect("metadata should still exist")
        .permissions();
    cleanup_permissions.set_mode(0o755);
    fs::set_permissions(&read_only_dir, cleanup_permissions)
        .expect("permissions should be restorable");
    fs::remove_dir_all(root).expect("temp root should be removed");
}

#[test]
fn write_file_rejects_paths_outside_bound_work_dir() {
    let root = create_temp_root("workdir-scope");
    let outside = create_temp_root("outside-scope");
    let root_string = root.to_string_lossy().to_string();
    let outside_target = outside.join("stolen.txt");

    let error = write_file_for_tool(
        outside_target.to_string_lossy().as_ref(),
        "blocked",
        Some(root_string.as_str()),
    )
    .expect_err("write_file_for_tool should reject writes outside work_dir");

    assert_eq!(error.error_kind, "access_denied");
    assert!(error.cause.contains("outside the bound work directory"));

    fs::remove_dir_all(root).expect("temp root should be removed");
    fs::remove_dir_all(outside).expect("outside temp root should be removed");
}

#[test]
#[cfg(target_os = "windows")]
fn read_file_resolves_wsl_mnt_work_dir_on_windows() {
    use crate::tools::shell_profile::convert_windows_path_to_wsl;

    let root = create_temp_root("wsl-workdir");
    let root_string = root.to_string_lossy().to_string();
    let wsl_work_dir =
        convert_windows_path_to_wsl(&root_string).expect("temp dir should convert to a /mnt/ path");
    let relative_path = "wsl-roundtrip.txt";
    let expected = "wsl path roundtrip\n";

    write_file_for_tool(relative_path, expected, Some(wsl_work_dir.as_str()))
        .expect("write_file_for_tool should accept a /mnt/ work_dir on Windows");
    let read_result = read_file_for_tool(relative_path, Some(wsl_work_dir.as_str()))
        .expect("read_file_for_tool should read via a /mnt/ work_dir on Windows");

    assert_eq!(read_result.content, expected);

    fs::remove_dir_all(root).expect("temp root should be removed");
}
