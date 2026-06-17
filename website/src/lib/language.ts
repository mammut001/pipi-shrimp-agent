import { type Language } from "@/translations";

/**
 * Cookie name used to persist the visitor's chosen language.
 * Lives in its own non-React module so both client and server code
 * can import it without dragging in `"use client"` baggage.
 */
export const LANGUAGE_COOKIE = "language";

export const SUPPORTED_LANGUAGES: readonly Language[] = [
  "en",
  "fr",
  "zh",
  "ko",
  "vi",
] as const;

export const DEFAULT_LANGUAGE: Language = "en";

export const isSupportedLanguage = (
  value: string | null | undefined,
): value is Language =>
  typeof value === "string" &&
  (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
