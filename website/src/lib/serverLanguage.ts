import { cookies } from "next/headers";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_COOKIE,
  isSupportedLanguage,
} from "@/lib/language";
import type { Language } from "@/translations";

/**
 * Server-side helper: read the visitor's preferred language from the
 * `language` cookie and return a value guaranteed to be a supported
 * `Language`. Falls back to English when the cookie is missing or
 * holds a value we don't recognise (e.g. after a refactor that drops
 * a locale).
 *
 * Next.js 16 returns a Promise from `cookies()`; await it.
 */
export async function getServerLanguage(): Promise<Language> {
  const store = await cookies();
  const value = store.get(LANGUAGE_COOKIE)?.value;
  return isSupportedLanguage(value) ? value : DEFAULT_LANGUAGE;
}
