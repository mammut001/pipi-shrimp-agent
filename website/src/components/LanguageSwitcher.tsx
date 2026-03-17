"use client";

import { useState, useRef, useEffect } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { Language } from "@/translations";

const languages: { code: Language; name: string; flag: string }[] = [
  { code: "en", name: "English",     flag: "🇨🇦" },
  { code: "fr", name: "Français",    flag: "🇨🇦" },
  { code: "zh", name: "中文",         flag: "🇨🇳" },
  { code: "ko", name: "한국어",       flag: "🇰🇷" },
  { code: "vi", name: "Tiếng Việt",  flag: "🇻🇳" },
];

export function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = languages.find((l) => l.code === language);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {/* Trigger */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Select language"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 10px",
          fontSize: "0.875rem",
          color: "var(--text-secondary)",
          background: open ? "var(--background-secondary)" : "transparent",
          border: "1px solid",
          borderColor: open ? "var(--border)" : "transparent",
          borderRadius: 8,
          cursor: "pointer",
          transition: "all 0.15s",
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLButtonElement).style.background = "var(--background-secondary)";
          (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)";
        }}
        onMouseLeave={e => {
          if (!open) {
            (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            (e.currentTarget as HTMLButtonElement).style.borderColor = "transparent";
          }
        }}
      >
        <span style={{ fontSize: "1.1rem", lineHeight: 1 }}>{current?.flag}</span>
        <span style={{ fontWeight: 500, color: "var(--text-primary)" }}>{current?.name}</span>
        <svg
          width={14} height={14}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
          style={{ transition: "transform 0.2s", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: "absolute",
          right: 0,
          top: "calc(100% + 6px)",
          minWidth: 160,
          background: "white",
          border: "1px solid var(--border)",
          borderRadius: 10,
          boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
          overflow: "hidden",
          zIndex: 100,
        }}>
          {languages.map((lang) => (
            <button
              key={lang.code}
              onClick={() => { setLanguage(lang.code); setOpen(false); }}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 14px",
                fontSize: "0.875rem",
                fontWeight: language === lang.code ? 600 : 400,
                color: language === lang.code ? "var(--accent)" : "var(--text-primary)",
                background: language === lang.code ? "rgba(255,71,87,0.05)" : "transparent",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
                transition: "background 0.1s",
              }}
              onMouseEnter={e => {
                if (language !== lang.code)
                  (e.currentTarget as HTMLButtonElement).style.background = "var(--background-secondary)";
              }}
              onMouseLeave={e => {
                if (language !== lang.code)
                  (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              }}
            >
              <span style={{ fontSize: "1.1rem" }}>{lang.flag}</span>
              <span>{lang.name}</span>
              {language === lang.code && (
                <svg width={14} height={14} fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ marginLeft: "auto", color: "var(--accent)" }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
