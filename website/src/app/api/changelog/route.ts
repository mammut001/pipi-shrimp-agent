import { NextResponse } from "next/server";
import {
  fetchChangelog,
  CHANGELOG_REVALIDATE_SECONDS,
  GITHUB_COMMITS_PAGE_URL,
} from "@/lib/changelog";

/**
 * GET /api/changelog
 *
 * Returns the latest 20 commits for the configured repository. This
 * route is the only place the server talks to api.github.com; the
 * changelog page is now a server component that imports the same
 * helper, but the route is kept around so client-side code (e.g. a
 * "retry" button) can re-hit the data without a full page reload.
 *
 * Caching: Next's data cache is used with a 5-minute revalidation
 * window. Visitors behind a slow / blocked GitHub will be served the
 * last good response for up to 5 minutes before we try again.
 */

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const perPageRaw = searchParams.get("per_page");
  const parsed = perPageRaw ? Number.parseInt(perPageRaw, 10) : NaN;
  const perPage =
    Number.isFinite(parsed) && parsed > 0 && parsed <= 100 ? parsed : 20;

  const result = await fetchChangelog({ perPage });

  if (result.status === "error") {
    const status = result.reason === "rate-limited" ? 429 : 502;
    return NextResponse.json(
      {
        status: "error",
        reason: result.reason,
        commitsPageUrl: GITHUB_COMMITS_PAGE_URL,
      },
      { status }
    );
  }

  return NextResponse.json(result, {
    headers: {
      // Keep the browser cache short so a fixed upstream isn't seen
      // as broken for long after recovery.
      "Cache-Control": `public, s-maxage=${CHANGELOG_REVALIDATE_SECONDS}, stale-while-revalidate=60`,
    },
  });
}
