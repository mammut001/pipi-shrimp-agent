"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useLanguage } from "@/contexts/LanguageContext";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { githubRepoUrl, githubReleasesUrl } from "@/lib/siteConfig";

const GITHUB_URL = githubRepoUrl;
const DOWNLOAD_URL = githubReleasesUrl;

export function Header() {
  const pathname = usePathname();
  const { t } = useLanguage();
  const [mobileOpen, setMobileOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const navItems = [
    { href: "/", label: t.nav.home },
    { href: "/about", label: t.nav.about },
    { href: "/features", label: t.nav.features },
    { href: "/architecture", label: t.nav.architecture },
    { href: "/changelog", label: t.nav.changelog },
  ];

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const closeMobile = () => setMobileOpen(false);

  // Lock body scroll while the drawer is open so the page underneath
  // doesn't pan around. Also wire up Escape-to-close + focus
  // restoration, since the drawer has its own focusable children.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!mobileOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setMobileOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [mobileOpen]);

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-[var(--border)] bg-white/80 backdrop-blur-md backdrop-saturate-150">
      <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between gap-3 px-4 sm:px-6">
        {/* Logo — `min-w-0` lets the inner label truncate rather than
         * push the right-side controls off-screen on extremely narrow
         * viewports (320px). `truncate` adds `overflow-hidden` +
         * `text-ellipsis`. */}
        <Link
          href="/"
          className="flex min-w-0 shrink items-center gap-2.5 text-[var(--text-primary)]"
          aria-label="Pipi Shrimp home"
        >
          <span className="relative inline-block h-8 w-8 shrink-0 overflow-hidden rounded-full">
            <Image
              src="/shrimp-avatar-256.png"
              alt="PiPi Shrimp"
              width={32}
              height={32}
              className="h-8 w-8 object-cover"
              priority
            />
          </span>
          <span className="truncate text-base font-bold tracking-tight">
            Pipi Shrimp
          </span>
        </Link>

        {/* Desktop nav */}
        <nav
          aria-label="Primary"
          className="hidden items-center gap-1 md:flex"
        >
          {navItems.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={[
                  "rounded-lg px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-[var(--accent)]/10 font-semibold text-[var(--accent)]"
                    : "font-normal text-[var(--text-secondary)] hover:bg-[var(--background-secondary)] hover:text-[var(--text-primary)]",
                ].join(" ")}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Right side (desktop) */}
        <div className="hidden items-center gap-2 md:flex">
          <LanguageSwitcher />
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--background-secondary)] hover:text-[var(--text-primary)]"
          >
            <svg
              width={20}
              height={20}
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
          </a>
          <a
            href={DOWNLOAD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[var(--accent-hover)]"
          >
            {t.header.download}
          </a>
        </div>

        {/* Mobile right side */}
        <div className="flex items-center gap-2 md:hidden">
          <LanguageSwitcher compact onSelect={closeMobile} />
          <button
            ref={triggerRef}
            type="button"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            onClick={() => setMobileOpen((v) => !v)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--background-secondary)] hover:text-[var(--text-primary)]"
          >
            {mobileOpen ? (
              <svg
                width={20}
                height={20}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 6l12 12M18 6L6 18"
                />
              </svg>
            ) : (
              <svg
                width={20}
                height={20}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 7h16M4 12h16M4 17h16"
                />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile drawer — slides in from the top with a short transition
       * rather than popping in/out so the gesture feels natural. The
       * `data-state` attribute is also exposed for any future CSS
       * customisations. */}
      <div
        ref={drawerRef}
        id="mobile-nav"
        data-state={mobileOpen ? "open" : "closed"}
        // Keep the element in the DOM so it can animate out; hide via
        // visibility/opacity when closed.
        className={[
          "overflow-hidden border-[var(--border)] bg-white transition-[max-height,opacity] duration-200 ease-out md:hidden",
          mobileOpen
            ? "max-h-[80vh] border-t opacity-100"
            : "pointer-events-none max-h-0 opacity-0",
        ].join(" ")}
        // The drawer is decorative until open; hide it from assistive
        // tech in the closed state.
        aria-hidden={!mobileOpen}
      >
        <nav
          aria-label="Mobile"
          className="mx-auto flex w-full max-w-[1200px] flex-col gap-1 px-4 py-4 sm:px-6"
        >
          {navItems.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeMobile}
                aria-current={active ? "page" : undefined}
                className={[
                  "rounded-lg px-3 py-2.5 text-sm transition-colors",
                  active
                    ? "bg-[var(--accent)]/10 font-semibold text-[var(--accent)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--background-secondary)] hover:text-[var(--text-primary)]",
                ].join(" ")}
              >
                {item.label}
              </Link>
            );
          })}
          <div className="mt-2 flex items-center gap-2 border-t border-[var(--border)] pt-3">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={closeMobile}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-white px-4 py-2 text-sm font-medium text-[var(--text-primary)]"
            >
              GitHub
            </a>
            <a
              href={DOWNLOAD_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={closeMobile}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white"
            >
              {t.header.download}
            </a>
          </div>
        </nav>
      </div>
    </header>
  );
}
