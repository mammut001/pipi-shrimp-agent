use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RawBrowserInspection {
    pub url: String,
    pub title: String,
    pub has_password_input: bool,
    pub has_login_form: bool,
    pub has_qr_auth: bool,
    pub has_captcha: bool,
    pub text_markers: Vec<String>,
    pub dom_markers: Vec<String>,
    #[serde(default)]
    pub has_login_modal: bool,
    #[serde(default)]
    pub content_word_count: u32,
}

pub(crate) const EMBEDDED_SURFACE_INSPECTION_SCRIPT: &str = r#"
(function() {
    try {
        const url = window.location.href;
        const title = document.title;
        const hasPasswordInput = document.querySelectorAll('input[type="password"]').length > 0;
        const hasLoginForm = document.querySelectorAll('form[action*="login"], form[action*="signin"], form[action*="auth"]').length > 0;
        const hasQrAuth = !!(
            document.querySelector('[data-testid="qr-code"]') ||
            document.querySelector('img[alt*="QR"]') ||
            document.querySelector('img[src*="qr"]') ||
            document.body.innerText.toLowerCase().includes('scan qr')
        );
        const hasCaptcha = !!(
            document.querySelector('[class*="captcha"]') ||
            document.querySelector('[id*="captcha"]') ||
            document.body.innerText.toLowerCase().includes('captcha') ||
            document.body.innerText.toLowerCase().includes('verify you\'re human') ||
            document.body.innerText.toLowerCase().includes('i\'m not a robot')
        );

        const bodyText = document.body.innerText;
        const textMarkers = [];
        const authTexts = [
            'sign in', 'sign in to', 'log in', 'log in to', 'login',
            'password', 'username', 'email', 'authentication',
            'two-factor', '2fa', 'verification code', 'security code',
            'dashboard', 'my apps', 'account', 'profile', 'settings',
            'chats', 'messages', 'contacts', 'whatsapp', 'telegram',
        ];

        for (const text of authTexts) {
            if (bodyText.toLowerCase().includes(text)) {
                textMarkers.push(text);
            }
        }

        const domMarkers = [];
        const passwordInputs = document.querySelectorAll('input[type="password"]');
        for (const input of passwordInputs) {
            domMarkers.push('input[type="password"]');
            if (input.id) domMarkers.push('input#' + input.id);
            if (input.name) domMarkers.push('input[name="' + input.name + '"]');
        }

        const forms = document.querySelectorAll('form');
        for (const form of forms) {
            if (form.action && (form.action.includes('login') || form.action.includes('signin'))) {
                domMarkers.push('form[action*="login"]');
            }
        }

        const uniqueTextMarkers = [...new Set(textMarkers)];
        const uniqueDomMarkers = [...new Set(domMarkers)];

        const modalSelectors = [
            'dialog',
            '[role="dialog"]',
            '[aria-modal="true"]',
            '[class*="modal"]',
            '[class*="overlay"]',
            '[class*="popup"]',
            '[class*="drawer"]',
            '[class*="sheet"]',
        ];
        let hasLoginModal = false;
        const loginKeywords = ['sign in', 'log in', 'login', 'sign up', 'create account'];
        for (const sel of modalSelectors) {
            try {
                const modals = document.querySelectorAll(sel);
                for (const modal of modals) {
                    const mt = (modal.innerText || '').toLowerCase();
                    if (loginKeywords.some(kw => mt.includes(kw))) {
                        hasLoginModal = true;
                        break;
                    }
                }
            } catch(e) {}
            if (hasLoginModal) break;
        }

        const contentWordCount = bodyText.trim().split(/\s+/).filter(w => w.length > 0).length;

        const result = {
            url: url,
            title: title,
            has_password_input: hasPasswordInput,
            has_login_form: hasLoginForm,
            has_qr_auth: hasQrAuth,
            has_captcha: hasCaptcha,
            text_markers: uniqueTextMarkers,
            dom_markers: uniqueDomMarkers,
            has_login_modal: hasLoginModal,
            content_word_count: contentWordCount,
        };

        window.__inspection_result = JSON.stringify(result);

        function emitInspectionResult(payload) {
            if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
                window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {
                    event: 'browser_inspection_result',
                    windowLabel: null,
                    payload: payload
                }).catch(function() {});
                return;
            }
            console.warn('[Browser] No Tauri IPC available for inspection result');
        }

        emitInspectionResult(result);
        console.log('[Browser] Inspection complete:', result.url);
    } catch (e) {
        console.error('Inspection error:', e);
        function emitInspectionError(msg) {
            if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
                window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {
                    event: 'browser_inspection_error',
                    windowLabel: null,
                    payload: { message: msg }
                }).catch(function() {});
            }
        }
        emitInspectionError(e.message || String(e));
    }
})();
"#;

pub(crate) const STANDALONE_INSPECTION_SCRIPT: &str = r#"
(function() {
    try {
        const url = window.location.href;
        const title = document.title;
        const hasPasswordInput = document.querySelectorAll('input[type="password"]').length > 0;
        const hasLoginForm = document.querySelectorAll('form[action*="login"], form[action*="signin"], form[action*="auth"]').length > 0;
        const hasQrAuth = !!(
            document.querySelector('[data-testid="qr-code"]') ||
            document.querySelector('img[alt*="QR"]') ||
            document.querySelector('img[src*="qr"]') ||
            document.body.innerText.toLowerCase().includes('scan qr')
        );
        const hasCaptcha = !!(
            document.querySelector('[class*="captcha"]') ||
            document.querySelector('[id*="captcha"]') ||
            document.body.innerText.toLowerCase().includes('captcha') ||
            document.body.innerText.toLowerCase().includes('verify you\'re human') ||
            document.body.innerText.toLowerCase().includes('i\'m not a robot')
        );

        const bodyText = document.body.innerText;
        const textMarkers = [];
        const authTexts = [
            'sign in', 'sign in to', 'log in', 'log in to', 'login',
            'password', 'username', 'email', 'authentication',
            'two-factor', '2fa', 'verification code', 'security code',
            'dashboard', 'my apps', 'account', 'profile', 'settings',
            'chats', 'messages', 'contacts', 'whatsapp', 'telegram',
        ];

        for (const text of authTexts) {
            if (bodyText.toLowerCase().includes(text)) {
                textMarkers.push(text);
            }
        }

        const domMarkers = [];
        const passwordInputs = document.querySelectorAll('input[type="password"]');
        for (const input of passwordInputs) {
            domMarkers.push('input[type="password"]');
            if (input.id) domMarkers.push('input#' + input.id);
            if (input.name) domMarkers.push('input[name="' + input.name + '"]');
        }

        const forms = document.querySelectorAll('form');
        for (const form of forms) {
            if (form.action && (form.action.includes('login') || form.action.includes('signin'))) {
                domMarkers.push('form[action*="login"]');
            }
        }

        const uniqueTextMarkers = [...new Set(textMarkers)];
        const uniqueDomMarkers = [...new Set(domMarkers)];

        const modalSelectors2 = [
            'dialog',
            '[role="dialog"]',
            '[aria-modal="true"]',
            '[class*="modal"]',
            '[class*="overlay"]',
            '[class*="popup"]',
            '[class*="drawer"]',
            '[class*="sheet"]',
        ];
        let hasLoginModal2 = false;
        const loginKeywords2 = ['sign in', 'log in', 'login', 'sign up', 'create account'];
        for (const sel of modalSelectors2) {
            try {
                const modals = document.querySelectorAll(sel);
                for (const modal of modals) {
                    const mt = (modal.innerText || '').toLowerCase();
                    if (loginKeywords2.some(kw => mt.includes(kw))) {
                        hasLoginModal2 = true;
                        break;
                    }
                }
            } catch(e) {}
            if (hasLoginModal2) break;
        }
        const contentWordCount2 = bodyText.trim().split(/\s+/).filter(w => w.length > 0).length;

        const result = {
            url: url,
            title: title,
            has_password_input: hasPasswordInput,
            has_login_form: hasLoginForm,
            has_qr_auth: hasQrAuth,
            has_captcha: hasCaptcha,
            text_markers: uniqueTextMarkers,
            dom_markers: uniqueDomMarkers,
            has_login_modal: hasLoginModal2,
            content_word_count: contentWordCount2,
        };

        window.__inspection_result = JSON.stringify(result);

        if (window.__TAURI__) {
            window.__TAURI__.event.emit('browser_inspection_result', result);
        }

        console.log('[Browser] Inspection complete:', result.url);
    } catch (e) {
        console.error('Inspection error:', e);
        if (window.__TAURI__) {
            window.__TAURI__.event.emit('browser_inspection_error', { message: e.message });
        }
    }
})();
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_script_emits_plugin_events() {
        assert!(EMBEDDED_SURFACE_INSPECTION_SCRIPT.contains("plugin:event|emit"));
        assert!(EMBEDDED_SURFACE_INSPECTION_SCRIPT.contains("browser_inspection_result"));
    }

    #[test]
    fn standalone_script_emits_window_events() {
        assert!(STANDALONE_INSPECTION_SCRIPT.contains("window.__TAURI__.event.emit"));
        assert!(STANDALONE_INSPECTION_SCRIPT.contains("browser_inspection_error"));
    }
}
