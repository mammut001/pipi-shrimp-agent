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
