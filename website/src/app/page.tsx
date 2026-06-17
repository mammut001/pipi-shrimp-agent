"use client";

import Image from "next/image";
import { useLanguage } from "@/contexts/LanguageContext";
import { Container, Section } from "@/components";
import { SITE_CONFIG, githubReleasesUrl } from "@/lib/siteConfig";

const GITHUB_RELEASES_URL = githubReleasesUrl;

const featureKeys = ["ai", "privacy", "fast"] as const;

const featureIcons = [
  // AI / spark
  <svg
    key="ai"
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
  // Privacy / shield-lock
  <svg
    key="privacy"
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
      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
    />
  </svg>,
  // Fast / bolt
  <svg
    key="fast"
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
      d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
    />
  </svg>,
];

export default function HomePage() {
  const { t } = useLanguage();

  return (
    <div className="page-enter">
      {/* ── Hero ── */}
      <Section variant="hero" className="relative overflow-hidden">
        {/* Background blobs */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10"
        >
          <div className="absolute left-1/4 top-10 h-[480px] w-[480px] rounded-full bg-[var(--accent)] opacity-[0.07] blur-3xl" />
          <div className="absolute bottom-0 right-1/5 h-[360px] w-[360px] rounded-full bg-[var(--accent)] opacity-[0.05] blur-3xl" />
        </div>

        <Container>
          <div className="flex flex-col-reverse items-center gap-12 md:flex-row md:items-center md:justify-between md:gap-12">
            {/* Text */}
            <div className="w-full max-w-xl flex-1">
              <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--background-secondary)] px-4 py-2 text-sm text-[var(--text-secondary)]">
                <span className="pulse-dot inline-block h-2 w-2 rounded-full bg-[var(--accent)]" />
                {t.hero.subtitle}
              </div>

              <h1 className="mb-6 text-4xl font-extrabold leading-[1.1] tracking-tight text-[var(--text-primary)] sm:text-5xl md:text-6xl">
                {t.hero.title}
              </h1>

              <p className="mb-10 max-w-[32rem] text-lg leading-relaxed text-[var(--text-secondary)]">
                {t.hero.description}
              </p>

              <div className="flex flex-wrap gap-4">
                <a
                  href={GITHUB_RELEASES_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-7 py-3.5 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(255,71,87,0.3)] transition-all hover:-translate-y-0.5 hover:bg-[var(--accent-hover)]"
                >
                  <svg
                    width={18}
                    height={18}
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
                  {t.hero.downloadArm}
                </a>
                <a
                  href={GITHUB_RELEASES_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--background-secondary)] px-7 py-3.5 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  <svg
                    width={18}
                    height={18}
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
                  {t.hero.downloadIntel}
                </a>
              </div>

              <p className="mt-6 text-sm text-[var(--text-secondary)]">
                {t.hero.version}: {SITE_CONFIG.version}
                {SITE_CONFIG.macosOnly ? " · macOS only" : ""}
              </p>
            </div>

            {/* Shrimp image */}
            <div className="relative h-64 w-64 shrink-0 md:h-72 md:w-72">
              <div
                aria-hidden="true"
                className="absolute inset-0 scale-110 rounded-full bg-[var(--accent)] opacity-10 blur-2xl"
              />
              <Image
                src="/shrimp-avatar-256.png"
                alt="PiPi Shrimp"
                fill
                priority
                sizes="(min-width: 768px) 18rem, 16rem"
                className="relative object-contain drop-shadow-[0_20px_40px_rgba(0,0,0,0.15)]"
              />
            </div>
          </div>
        </Container>
      </Section>

      {/* ── Features ── */}
      <Section variant="muted">
        <Container>
          <div className="mb-14 text-center">
            <h2 className="mb-3 text-3xl font-bold text-[var(--text-primary)] md:text-4xl">
              Why PiPi Shrimp Agent?
            </h2>
            <p className="mx-auto max-w-xl text-[var(--text-secondary)]">
              Built from the ground up for macOS, with privacy and
              performance at its core.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {featureKeys.map((key, i) => (
              <article
                key={key}
                className="group rounded-2xl border border-[var(--border)] bg-white p-7 transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--accent)] hover:shadow-[0_8px_32px_rgba(255,71,87,0.1)]"
              >
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]">
                  {featureIcons[i]}
                </div>
                <h3 className="mb-2 text-lg font-semibold text-[var(--text-primary)]">
                  {t.about.features[key].title}
                </h3>
                <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                  {t.about.features[key].description}
                </p>
              </article>
            ))}
          </div>
        </Container>
      </Section>

      {/* ── CTA ── */}
      <Section>
        <Container>
          <div className="relative overflow-hidden rounded-3xl bg-[var(--text-primary)] px-6 py-16 text-center sm:px-12">
            {/* Dot grid background rendered as a Tailwind gradient
                instead of an inline `style={{...}}` so the markup
                stays readable and Tailwind's tree-shaking still kicks
                in. The grid is purely decorative and ignored by
                assistive tech. */}
            <div
              aria-hidden="true"
              className="absolute inset-0 opacity-10 bg-[radial-gradient(circle,white_1px,transparent_1px)] [background-size:24px_24px]"
            />
            <div className="relative z-10 flex flex-col items-center">
              <Image
                src="/shrimp-avatar-128.webp"
                alt="PiPi Shrimp"
                width={80}
                height={80}
                className="mb-6 drop-shadow-[0_8px_16px_rgba(0,0,0,0.3)]"
              />
              <h2 className="mb-4 text-3xl font-bold text-white md:text-4xl">
                Ready to get started?
              </h2>
              <p className="mb-10 max-w-md text-base leading-relaxed text-white/60">
                Download PiPi Shrimp Agent today and experience the future
                of AI assistance on your Mac.
              </p>
              <a
                href={GITHUB_RELEASES_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-white px-9 py-4 text-base font-semibold text-[var(--text-primary)] transition-all hover:-translate-y-0.5 hover:shadow-lg"
              >
                <svg
                  width={18}
                  height={18}
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
            </div>
          </div>
        </Container>
      </Section>
    </div>
  );
}
