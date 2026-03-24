/**
 * Browser Profiles - Site profile registry and matching
 *
 * Defines site-specific behaviors for auth detection and automation
 */

import type {
  SiteProfile,
  BrowserConnectorType,
} from '../types/browser';

/**
 * Predefined site profiles
 */
export const SITE_PROFILES: SiteProfile[] = [
  {
    id: 'app_store_connect',
    label: 'App Store Connect',
    connectorType: 'browser_web',
    domainMatchers: [
      'appstoreconnect.apple.com',
      'developer.apple.com',
      'idmsa.apple.com',
      'appleid.apple.com',
    ],
    loginDetectors: [
      // Apple ID sign-in page
      'input[type="password"]',
      '[data-testid="appleId"]',
      'form[action*="signin"]',
      // General login markers
      'text:Sign in to App Store Connect',
      'text:Sign In',
      'text:Apple ID',
    ],
    postLoginDetectors: [
      // Dashboard markers
      '[data-testid="dashboard"]',
      'text:My Apps',
      'text:App Store Connect',
      'text:Select a provider',
      // Account navigation
      'text:Account',
      'nav:account',
    ],
    blockDetectors: [
      // 2FA page
      'text:Two-Factor Authentication',
      'text:Enter the code',
      // Session timeout
      'text:Session Expired',
      'text:Please sign in again',
      // Browser unsupported
      'text:browser is not supported',
    ],
    automationSensitivity: 'medium',
  },
  {
    id: 'github',
    label: 'GitHub',
    connectorType: 'browser_web',
    domainMatchers: [
      'github.com',
      'github.dev',
      'gist.github.com',
    ],
    loginDetectors: [
      // Login form
      'input[name="login"]',
      'input[type="password"]',
      'form[action*="session"]',
      // Sign-in page markers
      'text:Sign in to GitHub',
      'text:Username or email address',
    ],
    postLoginDetectors: [
      // Logged in markers
      '[data-testid="header"]',
      'text:Sign out',
      'text:Your repositories',
      // Dashboard
      'text:Discover repositories',
      'nav:main',
    ],
    blockDetectors: [
      // 2FA
      'text:Two-factor authentication',
      'text:Authentication code',
      // Rate limiting
      'text:Rate limit exceeded',
      // SSO/SAML
      'text:Single sign-on',
    ],
    automationSensitivity: 'high',
  },
  {
    id: 'google',
    label: 'Google',
    connectorType: 'browser_web',
    domainMatchers: [
      'google.com',
      'accounts.google.com',
      'mail.google.com',
      'drive.google.com',
    ],
    loginDetectors: [
      // Google sign-in
      'input[type="email"]',
      'input[type="password"]',
      'input[type="tel"]',
      'form[action*="signin"]',
      'text:Sign in',
      'text:Enter your email',
    ],
    postLoginDetectors: [
      // Account switcher
      'text:Google Account',
      '[data-profile-icon]',
      // Gmail
      'text:Inbox',
      // Drive
      'text:My Drive',
    ],
    blockDetectors: [
      // 2FA
      'text:2-Step Verification',
      'text:Verify it\'s you',
      // Captcha
      'text:Verify you\'re human',
      // Too many attempts
      'text:Try again later',
    ],
    automationSensitivity: 'low',
  },
  {
    id: 'whatsapp_web',
    label: 'WhatsApp Web',
    connectorType: 'im_whatsapp',
    domainMatchers: [
      'web.whatsapp.com',
    ],
    loginDetectors: [
      // QR code login screen
      'text:Use WhatsApp on your phone to scan the QR code',
      'text:Log in to WhatsApp Web',
      'text:Loading',
      // QR element
      '[data-testid="qr-code"]',
      'img[alt="QR code"]',
    ],
    postLoginDetectors: [
      // Chat sidebar
      'text:Chats',
      '[data-testid="chat-list"]',
      // Message composer
      'text:Type a message',
      '[data-testid="compose-area"]',
      // Contact list
      'text:Contacts',
    ],
    blockDetectors: [
      // Connection issues
      'text:Phone battery low',
      'text:Connect your phone',
      'text:Connection lost',
      // Device linking
      'text:Link device',
      'text:Device linked',
    ],
    automationSensitivity: 'medium',
  },
  {
    id: 'telegram_web',
    label: 'Telegram Web',
    connectorType: 'im_telegram',
    domainMatchers: [
      'web.telegram.org',
      'telegram.org',
    ],
    loginDetectors: [
      // Phone number input
      'input[type="tel"]',
      'text:Log in by phone number',
      'text:Enter your phone number',
      // QR code
      'text:Log in',
      'text:QR code',
    ],
    postLoginDetectors: [
      // Chat list
      'text:Chats',
      'text:Contacts',
      // Message input
      'text:Type a message',
      'input[type="text"]',
    ],
    blockDetectors: [
      // Session expired
      'text:Session expired',
      // Account frozen
      'text:Account frozen',
    ],
    automationSensitivity: 'medium',
  },
  {
    id: 'slack',
    label: 'Slack',
    connectorType: 'im_slack',
    domainMatchers: [
      'slack.com',
      'app.slack.com',
    ],
    loginDetectors: [
      // Sign in form
      'input[type="email"]',
      'input[type="password"]',
      'text:Sign in to Slack',
      'text:Sign in',
    ],
    postLoginDetectors: [
      // Workspace
      'text:Slack',
      'text:Direct messages',
      'text:Channels',
      // Sidebar
      '[data-testid="sidebar"]',
    ],
    blockDetectors: [
      // SSO
      'text:Continue with SSO',
      // 2FA
      'text:Two-factor authentication',
    ],
    automationSensitivity: 'medium',
  },
  {
    id: 'generic_authenticated_site',
    label: 'Generic Authenticated Site',
    connectorType: 'generic_web',
    domainMatchers: ['*'],
    loginDetectors: [
      // Common login form patterns
      'input[type="password"]',
      'input[name*="email"]',
      'input[name*="username"]',
      'form[action*="login"]',
      'form[action*="signin"]',
      'text:Log in',
      'text:Sign in',
      'text:Log In',
      'text:Sign In',
      'text:Password',
    ],
    postLoginDetectors: [
      // Common authenticated markers
      'text:Account',
      'text:Profile',
      'text:Settings',
      'text:Logout',
      'text:Sign out',
    ],
    blockDetectors: [
      // Common block patterns
      'text:captcha',
      'text:robot',
      'text:verify',
      'text:blocked',
    ],
    automationSensitivity: 'medium',
  },
];

/**
 * Match a URL to a site profile
 */
export function matchProfileByUrl(url: string): SiteProfile {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    // Find the first matching profile
    for (const profile of SITE_PROFILES) {
      // Skip the generic profile for exact matches
      if (profile.id === 'generic_authenticated_site') continue;

      for (const matcher of profile.domainMatchers) {
        const lowerMatcher = matcher.toLowerCase();
        // Exact match
        if (hostname === lowerMatcher) {
          return profile;
        }
        // Wildcard match (*.example.com)
        if (lowerMatcher.startsWith('*.')) {
          const suffix = lowerMatcher.slice(2);
          if (hostname === suffix || hostname.endsWith(suffix)) {
            return profile;
          }
        }
        // Subdomain match
        if (hostname.endsWith(`.${lowerMatcher}`)) {
          return profile;
        }
      }
    }

    // Return generic profile if no specific match
    const genericProfile = SITE_PROFILES.find(p => p.id === 'generic_authenticated_site');
    return genericProfile || {
      id: 'unknown',
      label: 'Unknown Site',
      connectorType: 'generic_web' as BrowserConnectorType,
      domainMatchers: [],
      loginDetectors: [],
      postLoginDetectors: [],
      blockDetectors: [],
      automationSensitivity: 'none' as const,
    };
  } catch {
    // Invalid URL, return generic
    const genericProfile = SITE_PROFILES.find(p => p.id === 'generic_authenticated_site');
    return genericProfile || {
      id: 'unknown',
      label: 'Unknown Site',
      connectorType: 'generic_web' as BrowserConnectorType,
      domainMatchers: [],
      loginDetectors: [],
      postLoginDetectors: [],
      blockDetectors: [],
      automationSensitivity: 'none' as const,
    };
  }
}

/**
 * Detect login requirement from inspection markers
 */
export function detectLoginRequired(
  textMarkers: string[],
  domMarkers: string[]
): boolean {
  const loginPatterns = [
    'sign in',
    'sign in to',
    'log in',
    'log in to',
    'login',
    'password',
    'username',
    'email address',
    'authenticate',
    'verify your identity',
  ];

  const lowerText = textMarkers.map(t => t.toLowerCase());
  const lowerDom = domMarkers.map(d => d.toLowerCase());

  // Check for password input
  if (domMarkers.some(d => d.includes('password') && d.includes('input'))) {
    return true;
  }

  // Check for login-related text
  return [...lowerText, ...lowerDom].some(marker =>
    loginPatterns.some(pattern => marker.includes(pattern))
  );
}

/**
 * Detect captcha requirement from inspection markers
 */
export function detectCaptchaRequired(
  textMarkers: string[],
  domMarkers: string[]
): boolean {
  const captchaPatterns = [
    'captcha',
    'verify you\'re human',
    'i\'m not a robot',
    'recaptcha',
    'hcaptcha',
    'turnstile',
  ];

  const combined = [...textMarkers, ...domMarkers].map(s => s.toLowerCase());
  return combined.some(marker =>
    captchaPatterns.some(pattern => marker.includes(pattern))
  );
}

/**
 * Detect MFA requirement from inspection markers
 */
export function detectMfaRequired(textMarkers: string[]): boolean {
  const mfaPatterns = [
    'two-factor',
    'two factor',
    '2fa',
    'authentication code',
    'verification code',
    'enter code',
    '6-digit',
    'security code',
  ];

  const lowerText = textMarkers.map(t => t.toLowerCase());
  return lowerText.some(marker =>
    mfaPatterns.some(pattern => marker.includes(pattern))
  );
}

/**
 * Detect authenticated state (post-login) from inspection markers
 */
export function detectAuthenticated(
  textMarkers: string[],
  domMarkers: string[]
): boolean {
  const authPatterns = [
    'account',
    'profile',
    'settings',
    'logout',
    'sign out',
    'dashboard',
    'my account',
    'sign out',
  ];

  const combined = [...textMarkers, ...domMarkers].map(s => s.toLowerCase());
  return combined.some(marker =>
    authPatterns.some(pattern => marker.includes(pattern))
  );
}

/**
 * Get auth policy for a site profile
 */
export function getAuthPolicyForProfile(profileId: string): 'manual_login_required' | 'login_optional' | 'none' {
  const profile = SITE_PROFILES.find(p => p.id === profileId);
  if (!profile) return 'none';

  switch (profile.automationSensitivity) {
    case 'low':
    case 'none':
      return 'manual_login_required';
    case 'medium':
      return 'login_optional';
    case 'high':
      return 'none';
    default:
      return 'login_optional';
  }
}

/**
 * Get connector type for a site profile
 */
export function getConnectorTypeForProfile(profileId: string): BrowserConnectorType {
  const profile = SITE_PROFILES.find(p => p.id === profileId);
  return profile?.connectorType || 'generic_web';
}

/**
 * Get all available profiles (for UI display)
 */
export function getAllProfiles(): SiteProfile[] {
  return SITE_PROFILES.filter(p => p.id !== 'generic_authenticated_site');
}

/**
 * Get a profile by its ID
 * Returns the profile if found, otherwise returns the generic authenticated site profile
 */
export function getProfileById(profileId: string): SiteProfile {
  const profile = SITE_PROFILES.find(p => p.id === profileId);
  if (profile) {
    return profile;
  }

  // Return generic profile if not found
  return SITE_PROFILES.find(p => p.id === 'generic_authenticated_site')!;
}
