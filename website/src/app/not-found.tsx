import Link from "next/link";
import { Container, Section } from "@/components";
import { githubRepoUrl } from "@/lib/siteConfig";
import { translations } from "@/translations";
import { getServerLanguage } from "@/lib/serverLanguage";

/**
 * 404 page.
 *
 * Server component that reads the visitor's saved language from
 * the cookie (via `getServerLanguage`) so the message matches the
 * rest of the site. Renders with the same shell as the rest of the
 * site (Header + Footer via the root layout, app-shell spacing).
 */
export default async function NotFound() {
  const language = await getServerLanguage();
  const t = translations[language].notFound;

  return (
    <div className="page-enter">
      <Section variant="hero-muted">
        <Container>
          <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--accent)]">
            404
          </p>
          <h1 className="mb-4 text-4xl font-bold text-[var(--text-primary)] md:text-5xl">
            {t.title}
          </h1>
          <p className="max-w-2xl text-lg text-[var(--text-secondary)]">
            {t.description}
          </p>
        </Container>
      </Section>

      <Section>
        <Container>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
            >
              {t.goHome}
            </Link>
            <Link
              href="/features"
              className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--background-secondary)] px-5 py-2.5 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              {t.seeFeatures}
            </Link>
            <Link
              href="/changelog"
              className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--background-secondary)] px-5 py-2.5 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              {t.readChangelog}
            </Link>
            <a
              href={githubRepoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--background-secondary)] px-5 py-2.5 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              {t.openGithub} →
            </a>
          </div>
        </Container>
      </Section>
    </div>
  );
}
