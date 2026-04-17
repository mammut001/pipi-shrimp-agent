/**
 * URL Security Validation — blocks SSRF-prone URLs.
 *
 * Rejects private/internal IP ranges, localhost, link-local,
 * and cloud metadata endpoints.
 */

const BLOCKED_HOSTNAMES = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '[::1]',
  'metadata.google.internal',
];

const BLOCKED_IP_PREFIXES = [
  '10.',        // Class A private
  '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.',
  '172.24.', '172.25.', '172.26.', '172.27.',
  '172.28.', '172.29.', '172.30.', '172.31.',  // Class B private
  '192.168.',   // Class C private
  '169.254.',   // Link-local / cloud metadata
  'fd',         // IPv6 ULA
  'fe80:',      // IPv6 link-local
];

export function isBlockedUrl(urlStr: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return 'Invalid URL';
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block known dangerous hostnames
  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    return `Blocked: requests to ${hostname} are not allowed (SSRF protection)`;
  }

  // Block private/internal IP ranges
  for (const prefix of BLOCKED_IP_PREFIXES) {
    if (hostname.startsWith(prefix)) {
      return `Blocked: requests to private/internal IP ${hostname} are not allowed (SSRF protection)`;
    }
  }

  // Block cloud metadata endpoint (AWS, GCP, Azure)
  if (hostname === '169.254.169.254' || hostname === '100.100.100.200') {
    return `Blocked: requests to cloud metadata endpoint are not allowed`;
  }

  // Block non-HTTP(S) schemes
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `Blocked: only http/https schemes are allowed, got ${parsed.protocol}`;
  }

  return null;
}
