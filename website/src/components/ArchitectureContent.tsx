"use client";

import { useLanguage } from "@/contexts/LanguageContext";
import { Container, Section } from "@/components";
import { githubRepoUrl } from "@/lib/siteConfig";

const layerIcons = [
  // Tauri shell (globe/desktop)
  <svg key="tauri" className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
  </svg>,
  // React + TS (code)
  <svg key="react" className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
  </svg>,
  // Claude SDK (spark)
  <svg key="claude" className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
  </svg>,
  // Local toolchain (terminal)
  <svg key="toolchain" className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>,
  // Browser agent (window)
  <svg key="browser" className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
  </svg>,
  // Local persistence (database)
  <svg key="db" className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
  </svg>,
];

export function ArchitectureContent() {
  const { t } = useLanguage();
  const arch = t.architecture;

  return (
    <div className="page-enter">
      {/* Hero */}
      <Section variant="hero-muted">
        <Container>
          <h1 className="mb-4 text-4xl font-bold text-[var(--text-primary)] md:text-5xl">
            {arch.title}
          </h1>
          <p className="max-w-2xl text-lg text-[var(--text-secondary)]">
            {arch.subtitle}
          </p>
        </Container>
      </Section>

      {/* Intro */}
      <Section>
        <Container>
          <p className="max-w-3xl text-lg leading-relaxed text-[var(--text-secondary)]">
            {arch.intro}
          </p>
        </Container>
      </Section>

      {/* Architecture layers */}
      <Section variant="muted">
        <Container>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {arch.layers.map((layer, i) => (
              <article
                key={layer.title}
                className="rounded-2xl border border-[var(--border)] bg-white p-7 transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--accent)] hover:shadow-[0_8px_32px_rgba(255,71,87,0.1)]"
              >
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
                  {layerIcons[i % layerIcons.length]}
                </div>
                <h3 className="mb-2 text-lg font-semibold text-[var(--text-primary)]">
                  {layer.title}
                </h3>
                <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                  {layer.description}
                </p>
              </article>
            ))}
          </div>
        </Container>
      </Section>

      {/* Message flow */}
      <Section>
        <Container>
          <h2 className="mb-3 text-2xl font-bold text-[var(--text-primary)] md:text-3xl">
            {arch.flow.title}
          </h2>
          <p className="mb-10 max-w-2xl text-[var(--text-secondary)]">
            {arch.flow.description}
          </p>

          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {arch.flow.steps.map((step) => (
              <li
                key={step.title}
                className="rounded-xl border border-[var(--border)] bg-[var(--background-secondary)] p-6"
              >
                <h3 className="mb-2 text-base font-semibold text-[var(--text-primary)]">
                  {step.title}
                </h3>
                <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                  {step.description}
                </p>
              </li>
            ))}
          </ol>
        </Container>
      </Section>

      {/* Security */}
      <Section variant="muted">
        <Container>
          <h2 className="mb-3 text-2xl font-bold text-[var(--text-primary)] md:text-3xl">
            {arch.security.title}
          </h2>
          <p className="mb-8 max-w-2xl text-[var(--text-secondary)]">
            {arch.security.description}
          </p>

          <ul className="grid gap-3 sm:grid-cols-2">
            {arch.security.items.map((item) => (
              <li
                key={item}
                className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-white p-5"
              >
                <svg
                  className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent)]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                  />
                </svg>
                <span className="text-sm leading-relaxed text-[var(--text-secondary)]">
                  {item}
                </span>
              </li>
            ))}
          </ul>
        </Container>
      </Section>

      {/* Open Source CTA */}
      <Section>
        <Container>
          <div className="relative overflow-hidden rounded-3xl bg-[var(--text-primary)] px-6 py-16 text-center sm:px-12">
            <div
              aria-hidden="true"
              className="absolute inset-0 opacity-10 bg-[radial-gradient(circle,white_1px,transparent_1px)] [background-size:24px_24px]"
            />
            <div className="relative z-10 flex flex-col items-center">
              <h2 className="mb-4 text-3xl font-bold text-white md:text-4xl">
                {arch.openSource.title}
              </h2>
              <p className="mb-8 max-w-xl text-base leading-relaxed text-white/60">
                {arch.openSource.description}
              </p>
              <a
                href={githubRepoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-white px-9 py-4 text-base font-semibold text-[var(--text-primary)] transition-all hover:-translate-y-0.5 hover:shadow-lg"
              >
                <svg
                  className="h-5 w-5"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                    clipRule="evenodd"
                  />
                </svg>
                {t.header.github}
              </a>
            </div>
          </div>
        </Container>
      </Section>
    </div>
  );
}
