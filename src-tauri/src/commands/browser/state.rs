use crate::utils::AppError;
use tauri::{Webview, WebviewWindow};

/// Represents which browser surface is currently active.
/// This eliminates ambiguity in dual-track execution environment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ActiveSurface {
    /// No browser surface is currently active
    #[default]
    None,
    /// Standalone window mode (created via open_browser_window)
    StandaloneWindow,
    /// Embedded mode (created via open_embedded_surface)
    Embedded,
}

/// Browser window state management
pub struct BrowserState {
    pub browser_window: Option<WebviewWindow>,
    pub embedded_webview: Option<Webview>,
    pub is_busy: bool,
    /// Embedded webview mode - when true, browser renders in embedded pane
    pub embedded_mode: bool,
    /// The main window label for embedding
    pub main_window_label: String,
    /// Current active surface type - authoritative source for routing decisions
    pub active_surface: ActiveSurface,
}

impl BrowserState {
    /// Check if any browser surface is currently open
    #[allow(dead_code)]
    pub fn has_active_surface(&self) -> bool {
        self.embedded_webview.is_some() || self.browser_window.is_some()
    }

    /// Get the target webview and surface type for execution.
    /// This is the unified entry point for all browser operations,
    /// ensuring consistent routing across all commands.
    ///
    /// Returns: (Webview, ActiveSurface) or error if no surface is available
    pub fn get_target(&self) -> Result<(Webview, ActiveSurface), AppError> {
        // Priority: Embedded > StandaloneWindow (consistent with get_embedded_surface_url)
        if let Some(ref webview) = self.embedded_webview {
            return Ok((webview.clone(), ActiveSurface::Embedded));
        }

        if let Some(ref window) = self.browser_window {
            // WebviewWindow.webviews() returns Vec<(label, Webview)> in Tauri v2
            let webviews = window.webviews();
            let (_, webview) = webviews
                .into_iter()
                .next()
                .ok_or_else(|| AppError::InternalError("No webview in window".to_string()))?;
            return Ok((webview, ActiveSurface::StandaloneWindow));
        }

        Err(AppError::InvalidInput(
            "No browser surface open".to_string(),
        ))
    }

    /// Activate embedded surface mode
    pub fn activate_embedded(&mut self, webview: Webview) {
        self.embedded_webview = Some(webview);
        self.active_surface = ActiveSurface::Embedded;
    }

    /// Activate standalone window mode
    pub fn activate_standalone(&mut self, window: WebviewWindow) {
        self.browser_window = Some(window);
        self.active_surface = ActiveSurface::StandaloneWindow;
    }

    /// Deactivate all surfaces and reset state
    pub fn deactivate_all(&mut self) {
        if let Some(w) = self.browser_window.take() {
            let _ = w.close();
        }
        if let Some(w) = self.embedded_webview.take() {
            let _ = w.close();
        }
        self.active_surface = ActiveSurface::None;
    }

    /// Get description of current surface for logging/debugging
    pub fn surface_description(&self) -> &'static str {
        match self.active_surface {
            ActiveSurface::Embedded => "embedded",
            ActiveSurface::StandaloneWindow => "standalone_window",
            ActiveSurface::None => "none",
        }
    }
}

impl Default for BrowserState {
    fn default() -> Self {
        Self {
            browser_window: None,
            embedded_webview: None,
            is_busy: false,
            embedded_mode: false,
            main_window_label: "main".to_string(),
            active_surface: ActiveSurface::None,
        }
    }
}

