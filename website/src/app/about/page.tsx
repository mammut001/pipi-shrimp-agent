"use client";

import { useLanguage } from "@/contexts/LanguageContext";

export default function AboutPage() {
  const { t } = useLanguage();

  return (
    <div className="page-enter stack-reset">
      {/* Hero Section */}
      <section className="section-padding bg-secondary pt-32">
        <div className="max-w-[1200px] mx-auto px-6">
          <h1 className="text-4xl md:text-5xl font-bold text-[var(--text-primary)] mb-6">
            {t.about.title}
          </h1>
          <p className="text-lg text-[var(--text-secondary)] max-w-2xl">
            {t.about.description}
          </p>
        </div>
      </section>

      {/* Features Section */}
      <section className="section-padding">
        <div className="max-w-[1200px] mx-auto px-6">
          <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-12">
            {t.about.features.title}
          </h2>

          <div className="grid md:grid-cols-3 gap-8">
            {/* AI Powered */}
            <div className="p-8 bg-[var(--background-secondary)] rounded-2xl">
              <div className="w-14 h-14 mb-6 flex items-center justify-center bg-[var(--accent)]/10 rounded-xl">
                <svg className="w-7 h-7 text-[var(--accent)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-3">
                {t.about.features.ai.title}
              </h3>
              <p className="text-[var(--text-secondary)]">
                {t.about.features.ai.description}
              </p>
            </div>

            {/* Privacy First */}
            <div className="p-8 bg-[var(--background-secondary)] rounded-2xl">
              <div className="w-14 h-14 mb-6 flex items-center justify-center bg-[var(--accent)]/10 rounded-xl">
                <svg className="w-7 h-7 text-[var(--accent)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-3">
                {t.about.features.privacy.title}
              </h3>
              <p className="text-[var(--text-secondary)]">
                {t.about.features.privacy.description}
              </p>
            </div>

            {/* Fast */}
            <div className="p-8 bg-[var(--background-secondary)] rounded-2xl">
              <div className="w-14 h-14 mb-6 flex items-center justify-center bg-[var(--accent)]/10 rounded-xl">
                <svg className="w-7 h-7 text-[var(--accent)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-3">
                {t.about.features.fast.title}
              </h3>
              <p className="text-[var(--text-secondary)]">
                {t.about.features.fast.description}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Thanks Section */}
      <section className="section-padding">
        <div className="max-w-[1200px] mx-auto px-6">
          <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-8">
            {t.about.thanks.title}
          </h2>
          <div className="grid md:grid-cols-2 gap-8">
            {/* LobsterAI */}
            <div className="p-8 bg-[var(--background-secondary)] rounded-2xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 bg-gradient-to-br from-orange-400 to-red-500 rounded-xl flex items-center justify-center text-white font-bold text-lg">
                  L
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-[var(--text-primary)]">LobsterAI</h3>
                  <p className="text-sm text-[var(--text-secondary)]">Alibaba</p>
                </div>
              </div>
              <p className="text-[var(--text-secondary)] mb-4">
                {t.about.thanks.lobsterai.description}
              </p>
              <a
                href="https://github.com/alibaba/page-agent"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-[var(--accent)] hover:underline"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
                {t.about.thanks.github}
              </a>
            </div>

            {/* MiniMax Sponsor */}
            <div className="p-8 bg-[var(--background-secondary)] rounded-2xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-purple-500 rounded-xl flex items-center justify-center text-white font-bold text-lg">
                  M
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-[var(--text-primary)]">MiniMax</h3>
                  <p className="text-sm text-[var(--accent)]">{t.about.thanks.sponsor.badge}</p>
                </div>
              </div>
              <p className="text-[var(--text-secondary)] mb-4">
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
        </div>
      </section>

      {/* Tech Stack Section */}
      <section className="section-padding bg-secondary">
        <div className="max-w-[1200px] mx-auto px-6">
          <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-8">
            Built with modern technologies
          </h2>
          <div className="flex flex-wrap gap-4">
            {["Tauri", "Rust", "React", "TypeScript", "Tailwind CSS", "Claude SDK", "SQLite", "Typst"].map((tech) => (
              <span
                key={tech}
                className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] bg-white border border-[var(--border)] rounded-lg"
              >
                {tech}
              </span>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
