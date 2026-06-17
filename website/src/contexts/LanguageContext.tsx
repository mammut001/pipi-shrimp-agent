"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from "react";
import { translations, type Language, type TranslationKeys } from "@/translations";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_COOKIE,
  isSupportedLanguage,
} from "@/lib/language";

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: TranslationKeys;
}

const LanguageContext = createContext<LanguageContextType | undefined>(
  undefined,
);

interface LanguageProviderProps {
  children: ReactNode;
  /**
   * Initial language. On the server this comes from the `language`
   * cookie (see `lib/serverLanguage.ts`); on the client the layout
   * passes the same value via this prop so the very first paint
   * already matches the visitor's preference and there is no
   * "EN -> ZH" flash.
   */
  initialLanguage?: Language;
}

/**
 * Reads the active language from a `language` cookie. The server
 * layout passes the parsed value into `<LanguageProvider initialLanguage>`
 * so the first paint already has the right translation.
 */
export function LanguageProvider({
  children,
  initialLanguage = DEFAULT_LANGUAGE,
}: LanguageProviderProps) {
  const [language, setLanguageState] = useState<Language>(initialLanguage);

  // Belt-and-braces: if the cookie was modified by another tab
  // before hydration finished, honour that value too.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const match = document.cookie.match(
      new RegExp("(?:^|; )" + LANGUAGE_COOKIE + "=([^;]*)"),
    );
    const stored = match ? decodeURIComponent(match[1]) : null;
    if (isSupportedLanguage(stored) && stored !== language) {
      setLanguageState(stored);
    }
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep <html lang> in sync with the active locale on every change.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = language;
  }, [language]);

  const handleSetLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    if (typeof document !== "undefined") {
      document.documentElement.lang = lang;
      // 1 year, lax, root path so the server can read it on the
      // very next request.
      const oneYear = 60 * 60 * 24 * 365;
      document.cookie = `${LANGUAGE_COOKIE}=${encodeURIComponent(lang)}; Max-Age=${oneYear}; Path=/; SameSite=Lax`;
    }
  }, []);

  const value: LanguageContextType = {
    language,
    setLanguage: handleSetLanguage,
    t: translations[language],
  };

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}
