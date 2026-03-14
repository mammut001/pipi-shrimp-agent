"use client";

import { useLanguage } from "@/contexts/LanguageContext";

const GITHUB_RELEASES_URL = "https://github.com/mammut001/pipi-shrimp-agent/releases";

export default function HomePage() {
  const { t } = useLanguage();

  return (
    <div className="page-enter">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-[var(--accent)] opacity-5 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-[var(--accent)] opacity-5 rounded-full blur-3xl" />
        </div>

        <div className="max-w-[1200px] mx-auto px-6 py-24 md:py-32">
          <div className="text-center max-w-3xl mx-auto">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 mb-8 text-sm text-[var(--text-secondary)] bg-[var(--background-secondary)] rounded-full">
              <span className="w-2 h-2 bg-[var(--accent)] rounded-full animate-pulse" />
              {t.hero.subtitle}
            </div>

            {/* Title */}
            <h1 className="text-4xl md:text-6xl font-bold text-[var(--text-primary)] mb-6 leading-tight">
              {t.hero.title}
            </h1>

            {/* Description */}
            <p className="text-lg md:text-xl text-[var(--text-secondary)] mb-10 max-w-2xl mx-auto">
              {t.hero.description}
            </p>

            {/* Download Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <a
                href={GITHUB_RELEASES_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 text-base font-medium text-white bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg transition-all hover:scale-105 hover:shadow-lg"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                {t.hero.downloadArm}
                <span className="text-xs opacity-75 ml-1">(Apple Silicon)</span>
              </a>

              <a
                href={GITHUB_RELEASES_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 text-base font-medium text-[var(--text-primary)] bg-[var(--background-secondary)] hover:bg-[var(--border)] rounded-lg transition-all"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                {t.hero.downloadIntel}
                <span className="text-xs opacity-75 ml-1">(Intel)</span>
              </a>
            </div>

            {/* Version info */}
            <p className="mt-8 text-sm text-[var(--text-secondary)]">
              {t.hero.version}: 0.1.0
            </p>
          </div>
        </div>
      </section>

      {/* Features Preview Section */}
      <section className="py-20 bg-[var(--background-secondary)]">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid md:grid-cols-3 gap-8">
            {/* Feature 1 */}
            <div className="p-6 bg-white rounded-xl border border-[var(--border)] hover:border-[var(--accent)] transition-colors">
              <div className="w-12 h-12 mb-4 flex items-center justify-center bg-[var(--accent)] bg-opacity-10 rounded-lg">
                <svg className="w-6 h-6 text-[var(--accent)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
                {t.about.features.ai.title}
              </h3>
              <p className="text-[var(--text-secondary)]">
                {t.about.features.ai.description}
              </p>
            </div>

            {/* Feature 2 */}
            <div className="p-6 bg-white rounded-xl border border-[var(--border)] hover:border-[var(--accent)] transition-colors">
              <div className="w-12 h-12 mb-4 flex items-center justify-center bg-[var(--accent)] bg-opacity-10 rounded-lg">
                <svg className="w-6 h-6 text-[var(--accent)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
                {t.about.features.privacy.title}
              </h3>
              <p className="text-[var(--text-secondary)]">
                {t.about.features.privacy.description}
              </p>
            </div>

            {/* Feature 3 */}
            <div className="p-6 bg-white rounded-xl border border-[var(--border)] hover:border-[var(--accent)] transition-colors">
              <div className="w-12 h-12 mb-4 flex items-center justify-center bg-[var(--accent)] bg-opacity-10 rounded-lg">
                <svg className="w-6 h-6 text-[var(--accent)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
                {t.about.features.fast.title}
              </h3>
              <p className="text-[var(--text-secondary)]">
                {t.about.features.fast.description}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20">
        <div className="max-w-[1200px] mx-auto px-6 text-center">
          <h2 className="text-3xl font-bold text-[var(--text-primary)] mb-4">
            Ready to get started?
          </h2>
          <p className="text-[var(--text-secondary)] mb-8 max-w-xl mx-auto">
            Download Pipi Shrimp Agent today and experience the future of AI assistance on your Mac.
          </p>
          <a
            href={GITHUB_RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 px-8 py-4 text-lg font-medium text-white bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg transition-all hover:scale-105 hover:shadow-lg"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {t.header.download}
          </a>
        </div>
      </section>
    </div>
  );
}
