"use client";

import { useLanguage } from "@/contexts/LanguageContext";
import { Container, Section } from "@/components";

const techs = [
  "Tauri",
  "Rust",
  "React",
  "TypeScript",
  "Tailwind CSS",
  "Claude SDK",
  "SQLite",
  "Typst",
];

export default function AboutPage() {
  const { t } = useLanguage();

  return (
    <div className="page-enter">
      <Section variant="hero-muted">
        <Container>
          <h1 className="mb-6 text-4xl font-bold text-[var(--text-primary)] md:text-5xl">
            {t.about.title}
          </h1>
          <p className="max-w-2xl text-lg text-[var(--text-secondary)]">
            {t.about.description}
          </p>
        </Container>
      </Section>

      <Section>
        <Container>
          <h2 className="mb-12 text-2xl font-semibold text-[var(--text-primary)] md:text-3xl">
            {t.about.features.title}
          </h2>

          <div className="grid gap-6 md:grid-cols-3">
            {(["ai", "privacy", "fast"] as const).map((key) => (
              <div
                key={key}
                className="rounded-2xl bg-[var(--background-secondary)] p-8"
              >
                <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
                  {key === "ai" && (
                    <svg
                      className="h-7 w-7"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                      />
                    </svg>
                  )}
                  {key === "privacy" && (
                    <svg
                      className="h-7 w-7"
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
                  )}
                  {key === "fast" && (
                    <svg
                      className="h-7 w-7"
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
                    </svg>
                  )}
                </div>
                <h3 className="mb-3 text-xl font-semibold text-[var(--text-primary)]">
                  {t.about.features[key].title}
                </h3>
                <p className="text-[var(--text-secondary)]">
                  {t.about.features[key].description}
                </p>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      <Section>
        <Container>
          <h2 className="mb-8 text-2xl font-semibold text-[var(--text-primary)] md:text-3xl">
            {t.about.thanks.title}
          </h2>
          <div className="grid gap-6 md:grid-cols-2">
            {/* LobsterAI */}
            <div className="rounded-2xl bg-[var(--background-secondary)] p-8">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-orange-400 to-red-500 text-lg font-bold text-white">
                  L
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-[var(--text-primary)]">
                    LobsterAI
                  </h3>
                  <p className="text-sm text-[var(--text-secondary)]">Alibaba</p>
                </div>
              </div>
              <p className="mb-4 text-[var(--text-secondary)]">
                {t.about.thanks.lobsterai.description}
              </p>
              <a
                href="https://github.com/alibaba/page-agent"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-[var(--accent)] hover:underline"
              >
                <svg
                  className="h-5 w-5"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
                {t.about.thanks.github}
              </a>
            </div>

            {/* MiniMax sponsor */}
            <div className="rounded-2xl bg-[var(--background-secondary)] p-8">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-400 to-purple-500 text-lg font-bold text-white">
                  M
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-[var(--text-primary)]">
                    MiniMax
                  </h3>
                  <p className="text-sm text-[var(--accent)]">
                    {t.about.thanks.sponsor.badge}
                  </p>
                </div>
              </div>
              <p className="mb-4 text-[var(--text-secondary)]">
                {t.about.thanks.minimax.description}
              </p>
              <a
                href="https://www.minimax.io/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-[var(--accent)] hover:underline"
              >
                {t.about.thanks.visitWebsite}
              </a>
            </div>
          </div>
        </Container>
      </Section>

      <Section muted>
        <Container>
          <h2 className="mb-8 text-2xl font-semibold text-[var(--text-primary)] md:text-3xl">
            Built with modern technologies
          </h2>
          <div className="flex flex-wrap gap-3">
            {techs.map((tech) => (
              <span
                key={tech}
                className="rounded-lg border border-[var(--border)] bg-white px-4 py-2 text-sm font-medium text-[var(--text-secondary)]"
              >
                {tech}
              </span>
            ))}
          </div>
        </Container>
      </Section>
    </div>
  );
}
