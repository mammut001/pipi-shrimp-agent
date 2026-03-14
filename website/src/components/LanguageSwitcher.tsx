"use client";

import { useLanguage } from "@/contexts/LanguageContext";
import { Language } from "@/translations";

const languages: { code: Language; name: string; flag: string }[] = [
  { code: "en", name: "English", flag: "🇨🇦" },
  { code: "fr", name: "Français", flag: "🇨🇦" },
  { code: "zh", name: "中文", flag: "🇨🇳" },
  { code: "ko", name: "한국어", flag: "🇰🇷" },
  { code: "vi", name: "Tiếng Việt", flag: "🇻🇳" },
];

export function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();

  return (
    <div className="relative group">
      <button
        className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors rounded-lg hover:bg-[var(--background-secondary)]"
        aria-label="Select language"
      >
        <span className="text-base">
          {languages.find((l) => l.code === language)?.flag}
        </span>
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      <div className="absolute right-0 top-full mt-1 w-40 py-1 bg-white dark:bg-[var(--background-dark)] rounded-lg shadow-lg border border-[var(--border)] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
        {languages.map((lang) => (
          <button
            key={lang.code}
            onClick={() => setLanguage(lang.code)}
            className={`w-full flex items-center gap-2 px-4 py-2 text-sm text-left hover:bg-[var(--background-secondary)] transition-colors ${
              language === lang.code
                ? "text-[var(--accent)] font-medium"
                : "text-[var(--text-primary)]"
            }`}
          >
            <span className="text-base">{lang.flag}</span>
            <span>{lang.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
