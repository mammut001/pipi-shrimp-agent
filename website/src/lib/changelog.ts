/**
 * Server-side helpers for fetching and normalising the GitHub commit
 * log used by /changelog.
 *
 * Why server-side?
 *   * GitHub's public REST API is anonymous-rate-limited (60 req/IP/h).
 *     Funnelling every visitor through a single Next.js route + ISR
 *     cache means we only hit the upstream API once per ~5 min
 *     regardless of traffic, so the page is reliable and never gets
 *     stuck on the "Loading commits..." spinner.
 *   * We also avoid leaking the API contract to the client, and we
 *     can fail gracefully (timeouts, rate limits, network) without
 *     leaving the user with a half-rendered card.
 */
import { SITE_CONFIG, githubCommitsApiUrl, githubCommitUrl } from "./siteConfig";

export const CHANGELOG_REVALIDATE_SECONDS = 5 * 60; // 5 minutes

export interface CommitAuthor {
  name: string;
  login: string;
  avatarUrl: string;
}

export interface ChangelogCommit {
  sha: string;
  messageTitle: string;
  messageBody: string;
  author: CommitAuthor;
  date: string;
  url: string;
}

export type ChangelogResult =
  | { status: "ok"; commits: ChangelogCommit[] }
  | { status: "empty"; commits: [] }
  | { status: "error"; reason: ChangelogError };

export type ChangelogError =
  | "timeout"
  | "rate-limited"
  | "upstream"
  | "network"
  | "unknown";

const REQUEST_TIMEOUT_MS = 8_000;

/**
 * Normalises the GitHub REST response shape into the minimal contract
 * the UI actually needs.
 */
function normaliseCommit(raw: unknown): ChangelogCommit | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  if (typeof r.sha !== "string" || r.sha.length === 0) return null;

  const commit = r.commit as Record<string, unknown> | undefined;
  if (!commit || typeof commit.message !== "string") return null;

  const commitAuthor = (commit.author as Record<string, unknown> | undefined) ?? {};
  const userAuthor = (r.author as Record<string, unknown> | undefined) ?? null;

  const name =
    typeof commitAuthor.name === "string" && commitAuthor.name.length > 0
      ? commitAuthor.name
      : typeof userAuthor?.login === "string"
        ? userAuthor.login
        : "Unknown";
  const login =
    typeof userAuthor?.login === "string" ? userAuthor.login : name;
  const avatarUrl =
    typeof userAuthor?.avatar_url === "string"
      ? userAuthor.avatar_url
      : `https://github.com/identicons/${encodeURIComponent(login)}.png`;
  const date =
    typeof commitAuthor.date === "string" ? commitAuthor.date : new Date().toISOString();

  const [titleLine, ...rest] = commit.message.split("\n");
  const body = rest.join("\n").trim();

  return {
    sha: r.sha,
    messageTitle: titleLine ?? commit.message,
    messageBody: body,
    author: { name, login, avatarUrl },
    date,
    url: githubCommitUrl(r.sha),
  };
}

function classifyError(err: unknown): ChangelogError {
  if (err instanceof Error) {
    const name = err.name ?? "";
    if (name === "AbortError") return "timeout";
    const msg = err.message.toLowerCase();
    if (msg.includes("aborted")) return "timeout";
    if (msg.includes("fetch failed") || msg.includes("network")) return "network";
  }
  return "unknown";
}

interface FetchCommitsOptions {
  /** Override the per-page limit (defaults to 20). */
  perPage?: number;
  /** Force-skip the in-memory cache (e.g. for /api/changelog route). */
  noStore?: boolean;
  /** Override the revalidation window. */
  revalidate?: number;
}

/**
 * Fetches the latest commits for the configured repository.
 *
 * The result shape is intentionally tri-state so the UI can render
 * distinct ok/empty/error states without inspecting the data array.
 */
export async function fetchChangelog(
  options: FetchCommitsOptions = {}
): Promise<ChangelogResult> {
  const { perPage = 20, noStore = false, revalidate = CHANGELOG_REVALIDATE_SECONDS } = options;

  // Test/QA hook: short-circuit to a synthetic error state without
  // hitting the network. Set `CHANGELOG_FORCE_ERROR` in the process
  // environment to verify the error UI / retry flow in a deploy or
  // local preview. No-op when the variable is unset.
  const forced = process.env.CHANGELOG_FORCE_ERROR;
  if (forced) {
    const allowed: ChangelogError[] = [
      "timeout",
      "rate-limited",
      "upstream",
      "network",
      "unknown",
    ];
    const reason =
      (allowed as readonly string[]).includes(forced)
        ? (forced as ChangelogError)
        : "upstream";
    return { status: "error", reason };
  }

  // Same hook, but for the "empty" / "ok" fast paths so smoke tests
  // can assert the other UI states without touching GitHub.
  if (process.env.CHANGELOG_FORCE_EMPTY === "1") {
    return { status: "empty", commits: [] };
  }

  const url = githubCommitsApiUrl(perPage);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        // Send a descriptive UA so GitHub support can identify us in
        // rate-limit / abuse reports.
        "User-Agent": `${SITE_CONFIG.githubRepo}-website`,
      },
      signal: controller.signal,
      // ISR / route-level caching. 5 minutes is the project spec.
      next: noStore
        ? { revalidate: 0 }
        : { revalidate, tags: ["changelog"] },
      cache: noStore ? "no-store" : undefined,
    });

    if (response.status === 403 || response.status === 429) {
      return { status: "error", reason: "rate-limited" };
    }
    if (!response.ok) {
      return { status: "error", reason: "upstream" };
    }

    const json: unknown = await response.json();
    if (!Array.isArray(json) || json.length === 0) {
      return { status: "empty", commits: [] };
    }

    const commits = json
      .map(normaliseCommit)
      .filter((c): c is ChangelogCommit => c !== null);

    if (commits.length === 0) {
      return { status: "empty", commits: [] };
    }

    return { status: "ok", commits };
  } catch (err) {
    return { status: "error", reason: classifyError(err) };
  } finally {
    clearTimeout(timeout);
  }
}

export const GITHUB_COMMITS_PAGE_URL = `https://github.com/${SITE_CONFIG.githubRepo}/commits/main`;
