"use client";

import Image from "next/image";
import { useLanguage } from "@/contexts/LanguageContext";

const GITHUB_RELEASES_URL = "https://github.com/mammut001/pipi-shrimp-agent/releases";

const features = [
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
    key: "ai" as const,
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
    ),
    key: "privacy" as const,
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
    key: "fast" as const,
  },
];

export default function HomePage() {
  const { t } = useLanguage();

  return (
    <div className="page-enter" style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>

      {/* ── Hero ── */}
      <section style={{ position: "relative", overflow: "hidden" }}>
        {/* Bg blobs */}
        <div style={{ position: "absolute", inset: 0, zIndex: -1, pointerEvents: "none" }}>
          <div style={{ position: "absolute", top: 40, left: "25%", width: 480, height: 480, background: "var(--accent)", opacity: 0.07, borderRadius: "50%", filter: "blur(80px)" }} />
          <div style={{ position: "absolute", bottom: 0, right: "20%", width: 360, height: 360, background: "var(--accent)", opacity: 0.05, borderRadius: "50%", filter: "blur(60px)" }} />
        </div>

        <div className="container hero-padding">
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 48, flexWrap: "wrap" }}>

            {/* Text */}
            <div style={{ flex: 1, minWidth: 280 }}>
              {/* Badge */}
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 16px", marginBottom: 32, fontSize: 14, color: "var(--text-secondary)", background: "var(--background-secondary)", border: "1px solid var(--border)", borderRadius: 9999 }}>
                <span style={{ width: 8, height: 8, background: "var(--accent)", borderRadius: "50%", animation: "pulse 2s infinite" }} />
                {t.hero.subtitle}
              </div>

              {/* Title */}
              <h1 style={{ fontSize: "clamp(2.5rem, 5vw, 4rem)", fontWeight: 800, color: "var(--text-primary)", lineHeight: 1.1, letterSpacing: "-0.02em", marginBottom: 24 }}>
                {t.hero.title}
              </h1>

              {/* Description */}
              <p style={{ fontSize: "1.125rem", color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 40, maxWidth: 520 }}>
                {t.hero.description}
              </p>

              {/* Buttons */}
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <a
                  href={GITHUB_RELEASES_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "14px 28px", fontSize: "0.95rem", fontWeight: 600, color: "white", background: "var(--accent)", borderRadius: 12, textDecoration: "none", transition: "all 0.2s", boxShadow: "0 8px 24px rgba(255,71,87,0.3)" }}
                  onMouseEnter={e => (e.currentTarget.style.transform = "scale(1.05)")}
                  onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
                >
                  <svg width={20} height={20} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  {t.hero.downloadArm}
                </a>

                <a
                  href={GITHUB_RELEASES_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "14px 28px", fontSize: "0.95rem", fontWeight: 600, color: "var(--text-primary)", background: "var(--background-secondary)", border: "1px solid var(--border)", borderRadius: 12, textDecoration: "none", transition: "all 0.2s" }}
                >
                  <svg width={20} height={20} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  {t.hero.downloadIntel}
                </a>
              </div>

              <p style={{ marginTop: 24, fontSize: "0.875rem", color: "var(--text-secondary)" }}>
                {t.hero.version}: 0.1.0 · macOS only
              </p>
            </div>

            {/* Shrimp Image */}
            <div style={{ flexShrink: 0, position: "relative", width: 280, height: 280 }}>
              <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "var(--accent)", opacity: 0.08, filter: "blur(40px)", transform: "scale(1.2)" }} />
              <Image
                src="/shrimp-avatar.png"
                alt="PiPi Shrimp"
                fill
                style={{ objectFit: "contain", filter: "drop-shadow(0 20px 40px rgba(0,0,0,0.15))" }}
                priority
              />
            </div>

          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="section-padding bg-secondary">
        <div className="container">
          {/* Section header */}
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <h2 style={{ fontSize: "2rem", fontWeight: 700, color: "var(--text-primary)", marginBottom: 12 }}>
              Why PiPi Shrimp Agent?
            </h2>
            <p style={{ color: "var(--text-secondary)", maxWidth: 480, margin: "0 auto" }}>
              Built from the ground up for macOS, with privacy and performance at its core.
            </p>
          </div>

          {/* Cards grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 24 }}>
            {features.map((f, i) => (
              <div
                key={i}
                style={{ padding: 28, background: "white", borderRadius: 16, border: "1px solid var(--border)", transition: "all 0.2s", cursor: "default" }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = "var(--accent)";
                  (e.currentTarget as HTMLDivElement).style.boxShadow = "0 8px 32px rgba(255,71,87,0.1)";
                  (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border)";
                  (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
                  (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)";
                }}
              >
                <div style={{ width: 48, height: 48, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,71,87,0.1)", borderRadius: 12, marginBottom: 20, color: "var(--accent)" }}>
                  {f.icon}
                </div>
                <h3 style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>
                  {t.about.features[f.key].title}
                </h3>
                <p style={{ fontSize: "0.9rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                  {t.about.features[f.key].description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="section-padding">
        <div className="container">
          <div style={{ position: "relative", overflow: "hidden", background: "var(--text-primary)", borderRadius: 24, padding: "64px 48px", textAlign: "center" }}>
            {/* dot pattern */}
            <div style={{ position: "absolute", inset: 0, opacity: 0.05, backgroundImage: "radial-gradient(circle, white 1px, transparent 1px)", backgroundSize: "24px 24px" }} />

            <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
              <Image src="/shrimp-avatar.png" alt="PiPi Shrimp" width={80} height={80} style={{ marginBottom: 24, filter: "drop-shadow(0 8px 16px rgba(0,0,0,0.3))" }} />
              <h2 style={{ fontSize: "2rem", fontWeight: 700, color: "white", marginBottom: 16 }}>
                Ready to get started?
              </h2>
              <p style={{ color: "rgba(255,255,255,0.6)", marginBottom: 40, maxWidth: 400, lineHeight: 1.6 }}>
                Download PiPi Shrimp Agent today and experience the future of AI assistance on your Mac.
              </p>
              <a
                href={GITHUB_RELEASES_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "16px 36px", fontSize: "1rem", fontWeight: 600, color: "var(--text-primary)", background: "white", borderRadius: 12, textDecoration: "none", transition: "all 0.2s" }}
                onMouseEnter={e => (e.currentTarget.style.transform = "scale(1.05)")}
                onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
              >
                <svg width={20} height={20} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                {t.header.download}
              </a>
            </div>
          </div>
        </div>
      </section>

    </div>
  );
}
