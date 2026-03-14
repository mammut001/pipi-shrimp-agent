"use client";

import { useLanguage } from "@/contexts/LanguageContext";

const featureIcons = [
  <svg key="1" className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
  </svg>,
  <svg key="2" className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
  </svg>,
  <svg key="3" className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
  </svg>,
  <svg key="4" className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
  </svg>,
  <svg key="5" className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
  </svg>,
  <svg key="6" className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>,
];

export default function FeaturesPage() {
  const { t } = useLanguage();

  return (
    <div className="page-enter">
      {/* Hero Section */}
      <section className="py-20 bg-[var(--background-secondary)]">
        <div className="max-w-[1200px] mx-auto px-6 text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-[var(--text-primary)] mb-6">
            {t.features.title}
          </h1>
          <p className="text-lg text-[var(--text-secondary)] max-w-2xl mx-auto">
            {t.features.subtitle}
          </p>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {t.features.list.map((feature, index) => (
              <div
                key={index}
                className="p-8 bg-white rounded-2xl border border-[var(--border)] hover:border-[var(--accent)] hover:shadow-lg transition-all duration-300 group"
              >
                <div className="w-12 h-12 mb-5 flex items-center justify-center bg-[var(--accent)] bg-opacity-10 rounded-xl group-hover:bg-[var(--accent)] group-hover:bg-opacity-20 transition-colors">
                  <div className="text-[var(--accent)] group-hover:text-[var(--accent)] transition-colors">
                    {featureIcons[index]}
                  </div>
                </div>
                <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-3">
                  {feature.title}
                </h3>
                <p className="text-[var(--text-secondary)] leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Call to Action */}
      <section className="py-20 bg-[var(--background-secondary)]">
        <div className="max-w-[1200px] mx-auto px-6 text-center">
          <h2 className="text-3xl font-bold text-[var(--text-primary)] mb-4">
            Start using Pipi Shrimp Agent today
          </h2>
          <p className="text-[var(--text-secondary)] mb-8 max-w-xl mx-auto">
            Join thousands of developers who are already using Pipi Shrimp Agent to boost their productivity.
          </p>
          <a
            href="https://github.com/mammut001/pipi-shrimp-agent/releases"
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
