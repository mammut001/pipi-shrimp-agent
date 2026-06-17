import { fetchChangelog } from "@/lib/changelog";
import { ChangelogList } from "@/components/ChangelogList";
import { Container, Section } from "@/components";

export const metadata = {
  title: "Changelog - Pipi Shrimp Agent",
  description: "Latest commits and updates for Pipi Shrimp Agent.",
};

// Next.js 16 requires this export to be a static string literal.
// The page is always rendered on demand, but `fetchChangelog` still
// applies a 5-minute revalidation window at the data-cache layer, so
// production traffic to GitHub is throttled to ~once per 5 minutes
// per instance regardless of how dynamic this page is.
export const dynamic = "force-dynamic";

export default async function ChangelogPage() {
  // Server-side fetch. We always await here, so by the time React
  // renders, we already know which of the three states we are in
  // (ok / empty / error) and the UI can switch on `result.status`
  // without ever showing a loading spinner.
  const result = await fetchChangelog();

  return (
    <div className="page-enter">
      <Section variant="hero-muted">
        <Container>
          <h1 className="mb-4 text-4xl font-bold text-[var(--text-primary)] md:text-5xl">
            Changelog
          </h1>
          <p className="max-w-2xl text-lg text-[var(--text-secondary)]">
            Latest updates and improvements. Pulled from the GitHub commit
            history of the main branch.
          </p>
        </Container>
      </Section>

      <Section>
        <Container>
          <ChangelogList initialResult={result} />
        </Container>
      </Section>
    </div>
  );
}
