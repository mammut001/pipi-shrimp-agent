"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useLanguage } from "@/contexts/LanguageContext";
import { LanguageSwitcher } from "./LanguageSwitcher";

const GITHUB_URL = "https://github.com/mammut001/pipi-shrimp-agent";
const DOWNLOAD_URL = "https://github.com/mammut001/pipi-shrimp-agent/releases";

export function Header() {
  const pathname = usePathname();
  const { t } = useLanguage();

  const navItems = [
    { href: "/", label: t.nav.home },
    { href: "/about", label: t.nav.about },
    { href: "/features", label: t.nav.features },
    { href: "/changelog", label: t.nav.changelog },
  ];

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  return (
    <header style={{
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 50,
      background: "rgba(255,255,255,0.85)",
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
      borderBottom: "1px solid var(--border)",
    }}>
      <div className="container" style={{ height: 64, display: "flex", alignItems: "center", justifyContent: "space-between" }}>

        {/* Logo */}
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
          <Image
            src="/shrimp-avatar.png"
            alt="PiPi Shrimp"
            width={32}
            height={32}
            style={{ borderRadius: "50%", objectFit: "cover" }}
          />
          <span style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>
            Pipi Shrimp
          </span>
        </Link>

        {/* Navigation */}
        <nav style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              style={{
                padding: "6px 14px",
                fontSize: "0.875rem",
                fontWeight: isActive(item.href) ? 600 : 400,
                color: isActive(item.href) ? "var(--accent)" : "var(--text-secondary)",
                textDecoration: "none",
                borderRadius: 8,
                background: isActive(item.href) ? "rgba(255,71,87,0.08)" : "transparent",
                transition: "all 0.15s",
              }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Right side */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <LanguageSwitcher />

          {/* GitHub */}
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, color: "var(--text-secondary)", borderRadius: 8, transition: "all 0.15s", textDecoration: "none" }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLAnchorElement).style.color = "var(--text-primary)";
              (e.currentTarget as HTMLAnchorElement).style.background = "var(--background-secondary)";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLAnchorElement).style.color = "var(--text-secondary)";
              (e.currentTarget as HTMLAnchorElement).style.background = "transparent";
            }}
          >
            <svg width={20} height={20} fill="currentColor" viewBox="0 0 24 24">
              <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
            </svg>
          </a>

          {/* Download */}
          <a
            href={DOWNLOAD_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", fontSize: "0.875rem", fontWeight: 600, color: "white", background: "var(--accent)", borderRadius: 8, textDecoration: "none", transition: "background 0.15s" }}
            onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.background = "var(--accent-hover)"}
            onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.background = "var(--accent)"}
          >
            {t.header.download}
          </a>
        </div>

      </div>
    </header>
  );
}
