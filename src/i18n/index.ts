/**
 * i18n 核心模块
 * 
 * 提供多语言支持，包括：
 * - 获取当前语言
 * - 设置语言
 * - 获取翻译文本
 * - React Hook
 */

import type { Locale, TranslationKeys } from './types';
import zhCN from './locales/zh-CN';
import enUS from './locales/en-US';

/** 所有翻译 */
const translations: Record<Locale, TranslationKeys> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

/** 默认语言 */
const DEFAULT_LOCALE: Locale = 'zh-CN';

/** 本地存储 key */
const LOCALE_STORAGE_KEY = 'ai-agent-locale';

/** 语言变更监听器 */
type LocaleChangeListener = (locale: Locale) => void;
const listeners: LocaleChangeListener[] = [];

/**
 * 获取当前语言
 */
export function getCurrentLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && (stored === 'zh-CN' || stored === 'en-US')) {
      return stored;
    }
  } catch {
    // ignore
  }
  return DEFAULT_LOCALE;
}

/**
 * 设置语言
 */
export function setLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    // 通知所有监听器
    listeners.forEach(listener => listener(locale));
  } catch {
    // ignore
  }
}

/**
 * 添加语言变更监听器
 */
export function addLocaleChangeListener(listener: LocaleChangeListener): () => void {
  listeners.push(listener);
  // 返回取消监听的函数
  return () => {
    const index = listeners.indexOf(listener);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  };
}

/**
 * 获取翻译文本
 */
export function t(key: keyof TranslationKeys): string {
  const locale = getCurrentLocale();
  return translations[locale][key] || translations[DEFAULT_LOCALE][key] || key;
}

/**
 * 获取所有支持的语言
 */
export function getSupportedLocales(): { value: Locale; label: string; flag: string }[] {
  return [
    { value: 'zh-CN', label: '中文', flag: '🇨🇳' },
    { value: 'en-US', label: 'English', flag: '🇨🇦' },
  ];
}

/**
 * 将旧的语言代码转换为新的 Locale 格式
 */
export function convertOldLanguageCode(oldCode: 'en' | 'zh'): Locale {
  return oldCode === 'en' ? 'en-US' : 'zh-CN';
}

/**
 * 将新的 Locale 格式转换为旧的语言代码
 */
export function convertToOldLanguageCode(locale: Locale): 'en' | 'zh' {
  return locale === 'en-US' ? 'en' : 'zh';
}

export type { Locale, TranslationKeys };
