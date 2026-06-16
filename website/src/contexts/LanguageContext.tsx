"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from "react";
import { translations, Language, TranslationKeys } from "@/translations";

const STORAGE_KEY = "language";
const SUPPORTED_LANGUAGES: readonly Language[] = [
  "en",
  "fr",
  "zh",
  "ko",
  "vi",
] as const;

const isSupportedLanguage = (value: string | null): value is Language =>
  value !== null && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: TranslationKeys;
}

const LanguageContext = createContext<LanguageContextType | undefined>(
  undefined
);

interface LanguageProviderProps {
  children: ReactNode;
}

export function LanguageProvider({ children }: LanguageProviderProps) {
  const [language, setLanguageState] = useState<Language>("en");

  // Hydrate from localStorage exactly once on mount so a returning
  // user keeps their preferred locale instead of always seeing English
  // first. This is a one-way bootstrap effect — putting `language` in
  // the dep array would re-trigger the setState on every change.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isSupportedLanguage(stored) && stored !== language) {
      setLanguageState(stored);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep <html lang> in sync with the active locale on every change.
  useEffect(() => {
    if (typeof window === "undefined") return;
    document.documentElement.lang = language;
  }, [language]);

  const handleSetLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    if (typeof window !== "undefined") {
      document.documentElement.lang = lang;
      window.localStorage.setItem(STORAGE_KEY, lang);
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
