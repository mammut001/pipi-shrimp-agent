"use client";

import { useLanguage } from "@/contexts/LanguageContext";
import { Container, Section } from "@/components";
import { githubReleasesUrl } from "@/lib/siteConfig";

const featureIcons = [
  <svg
    key="1"
    className="h-6 w-6"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
    />
  </svg>,
  <svg
    key="2"
    className="h-6 w-6"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
    />
  </svg>,
  <svg
    key="3"
    className="h-6 w-6"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M13 10V3L4 14h7v7l9-11h-7z"
    />
  </svg>,
  <svg
    key="4"
    className="h-6 w-6"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
    />
  </svg>,
  <svg
    key="5"
    className="h-6 w-6"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"
    />
  </svg>,
  <svg
    key="6"
    className="h-6 w-6"
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
    />
  </svg>,
];

export default function FeaturesPage() {
  const { t } = useLanguage();

  return (
    <div className="page-enter">
      <Section variant="hero-muted">
        <Container className="text-center">
          <h1 className="mb-6 text-4xl font-bold text-[var(--text-primary)] md:text-5xl">
            {t.features.title}
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-[var(--text-secondary)]">
            {t.features.subtitle}
          </p>
        </Container>
      </Section>

      <Section>
        <Container>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {t.features.list.map((feature, index) => (
              <article
                key={feature.title}
                className="group rounded-2xl border border-[var(--border)] bg-white p-8 transition-all duration-300 hover:-translate-y-0.5 hover:border-[var(--accent)] hover:shadow-lg"
              >
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)] transition-colors group-hover:bg-[var(--accent)]/20">
                  {featureIcons[index % featureIcons.length]}
                </div>
                <h3 className="mb-3 text-xl font-semibold text-[var(--text-primary)]">
                  {feature.title}
                </h3>
                <p className="leading-relaxed text-[var(--text-secondary)]">
                  {feature.description}
                </p>
              </article>
            ))}
          </div>
        </Container>
      </Section>

      <Section muted>
        <Container className="text-center">
          <h2 className="mb-4 text-3xl font-bold text-[var(--text-primary)] md:text-4xl">
            Start using Pipi Shrimp Agent today
          </h2>
          <p className="mx-auto mb-8 max-w-xl text-[var(--text-secondary)]">
            Join thousands of developers who are already using Pipi Shrimp
            Agent to boost their productivity.
          </p>
          <a
            href={githubReleasesUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-8 py-4 text-base font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-[var(--accent-hover)] hover:shadow-lg"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            {t.header.download}
          </a>
        </Container>
      </Section>
    </div>
  );
}
