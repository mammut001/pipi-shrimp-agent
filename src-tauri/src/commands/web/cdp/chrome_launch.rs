//! Chrome remote-debugging launch helpers for the CDP tier commands in
//! `commands/web/cdp.rs`: debug-port probe, Linux launch arguments and the
//! platform-specific Chrome/Chromium spawn + readiness poll.
//!
//! Moved verbatim from `cdp.rs` (mechanical extract, no behavior change).

use std::time::Duration;

pub(super) enum ChromeDebugLaunchOutcome {
    DebugPortReady,
    Launched,
}

async fn chrome_debug_port_ready() -> bool {
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(1500))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    client
        .get("http://127.0.0.1:9222/json/version")
        .send()
        .await
        .is_ok()
}

/// Builds Chrome/Chromium launch arguments for Linux environments.
/// In containerized/box desktop environments, Chrome remote debugging requires
/// --no-sandbox and --disable-dev-shm-usage to stay healthy and avoid shared memory crashes.
/// --remote-debugging-address=127.0.0.1 binds explicitly to localhost.
/// --enable-unsafe-swiftshader provides software rendering fallback when hardware GPU is unavailable.
#[cfg(any(test, not(any(target_os = "macos", target_os = "windows"))))]
pub(in crate::commands::web) fn linux_chrome_debug_args(debug_profile: &str) -> Vec<String> {
    vec![
        "--remote-debugging-port=9222".to_string(),
        "--remote-debugging-address=127.0.0.1".to_string(),
        format!("--user-data-dir={}", debug_profile),
        "--no-first-run".to_string(),
        "--no-default-browser-check".to_string(),
        "--no-sandbox".to_string(),
        "--disable-dev-shm-usage".to_string(),
        "--enable-unsafe-swiftshader".to_string(),
        "about:blank".to_string(),
    ]
}

pub(super) async fn ensure_chrome_debug_process(
    timeout: Duration,
) -> Result<ChromeDebugLaunchOutcome, String> {
    if chrome_debug_port_ready().await {
        return Ok(ChromeDebugLaunchOutcome::DebugPortReady);
    }

    #[cfg(target_os = "macos")]
    {
        let home = dirs::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| "/tmp".to_string());
        let debug_profile = format!(
            "{}/Library/Application Support/PipiShrimp/ChromeDebugProfile",
            home
        );
        let chrome_paths = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome".to_string(),
            "/Applications/Chromium.app/Contents/MacOS/Chromium".to_string(),
            format!(
                "{}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                home
            ),
            format!("{}/Applications/Chromium.app/Contents/MacOS/Chromium", home),
        ];

        let mut spawned = false;
        for path in &chrome_paths {
            if std::path::Path::new(path).exists() {
                std::process::Command::new(path)
                    .args([
                        "--remote-debugging-port=9222",
                        &format!("--user-data-dir={}", debug_profile),
                        "--no-first-run",
                        "--no-default-browser-check",
                        "about:blank",
                    ])
                    .spawn()
                    .map_err(|e| format!("启动 Chrome 失败: {}", e))?;
                spawned = true;
                break;
            }
        }

        if !spawned {
            return Err("未找到 Chrome 或 Chromium，请确认已安装".to_string());
        }
    }

    #[cfg(target_os = "windows")]
    {
        let program_files =
            std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".to_string());
        let program_files_x86 = std::env::var("ProgramFiles(x86)")
            .unwrap_or_else(|_| "C:\\Program Files (x86)".to_string());
        let local_appdata = std::env::var("LOCALAPPDATA")
            .unwrap_or_else(|_| "C:\\Users\\User\\AppData\\Local".to_string());

        let chrome_paths = [
            format!(r"{}\Google\Chrome\Application\chrome.exe", program_files),
            format!(
                r"{}\Google\Chrome\Application\chrome.exe",
                program_files_x86
            ),
            format!(r"{}\Google\Chrome\Application\chrome.exe", local_appdata),
            format!(r"{}\Chromium\Application\chrome.exe", program_files),
            format!(r"{}\Chromium\Application\chrome.exe", program_files_x86),
            format!(r"{}\Chromium\Application\chrome.exe", local_appdata),
        ];

        let debug_profile = format!("{}\\PipiShrimp\\ChromeDebugProfile", local_appdata);

        let mut spawned = false;
        for path in &chrome_paths {
            if std::path::Path::new(path).exists() {
                std::process::Command::new(path)
                    .args([
                        "--remote-debugging-port=9222",
                        &format!("--user-data-dir={}", debug_profile),
                        "--no-first-run",
                        "--no-default-browser-check",
                        "about:blank",
                    ])
                    .spawn()
                    .map_err(|e| format!("启动 Chrome 失败: {}", e))?;
                spawned = true;
                break;
            }
        }

        if !spawned {
            return Err("未找到 Chrome 或 Chromium，请确认已安装。".to_string());
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let home = dirs::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| "/tmp".to_string());
        let debug_profile = format!("{}/.config/pipi-shrimp/chrome-debug-profile", home);

        let commands = [
            "google-chrome",
            "google-chrome-stable",
            "chromium",
            "chromium-browser",
        ];

        let args = linux_chrome_debug_args(&debug_profile);

        let mut spawned = false;
        for cmd in &commands {
            match std::process::Command::new(cmd).args(&args).spawn() {
                Ok(_) => {
                    spawned = true;
                    break;
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    continue;
                }
                Err(e) => {
                    return Err(format!("启动 {} 失败: {}", cmd, e));
                }
            }
        }

        if !spawned {
            return Err("未找到 Chrome/Chromium 浏览器，请确认已安装。".to_string());
        }
    }

    // After spawning Chrome, poll for the port to become ready (max 8s poll to prevent main loop latency)
    let start_time = std::time::Instant::now();
    let poll_timeout = std::time::Duration::from_secs(8).min(timeout);
    while !chrome_debug_port_ready().await {
        if start_time.elapsed() >= poll_timeout {
            return Err("启动 Chrome 成功，但调试端口未能就绪，连接超时。请确认未占用 9222 端口，或尝试手动启动。".to_string());
        }
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    }

    Ok(ChromeDebugLaunchOutcome::Launched)
}
