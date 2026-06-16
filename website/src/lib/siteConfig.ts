/**
 * Centralized site configuration. Anywhere in the website that needs
 * the GitHub repo URL, releases URL, app version, or any other
 * cross-cutting constant should import from here. Hard-coding these
 * strings in components is discouraged — keep this file the single
 * source of truth so a fork or rebrand only has to touch one place.
 */

export const SITE_CONFIG = {
  /** GitHub owner/repo slug, no leading slash. */
  githubRepo: "mammut001/pipi-shrimp-agent",

  /** Displayed app version. Bump per release. */
  version: "0.1.0",

  /** True when the site only ships macOS downloads. */
  macosOnly: true,
} as const;

export const siteUrl = (path = ""): string =>
  `https://github.com/${SITE_CONFIG.githubRepo}${path}`;

export const githubRepoUrl = siteUrl();
export const githubReleasesUrl = siteUrl("/releases");
export const githubCommitsApiUrl = (perPage = 20): string =>
  `https://api.github.com/repos/${SITE_CONFIG.githubRepo}/commits?per_page=${perPage}`;

export const githubCommitUrl = (sha: string): string =>
  `${githubRepoUrl}/commit/${sha}`;
