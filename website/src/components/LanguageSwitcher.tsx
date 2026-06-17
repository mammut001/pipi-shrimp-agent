"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type KeyboardEvent,
} from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { Language } from "@/translations";

const languages: { code: Language; name: string; flag: string }[] = [
  // EN and FR use 🇨🇦 because the project and primary author are
  // Canadian. Other languages use their country's flag.
  { code: "en", name: "English", flag: "🇨🇦" },
  { code: "fr", name: "Français", flag: "🇨🇦" },
  { code: "zh", name: "中文", flag: "🇨🇳" },
  { code: "ko", name: "한국어", flag: "🇰🇷" },
  { code: "vi", name: "Tiếng Việt", flag: "🇻🇳" },
];

interface LanguageSwitcherProps {
  /** When true, hide the language name and only show the flag. */
  compact?: boolean;
  /**
   * Optional callback fired after a language is picked. Used by the
   * mobile drawer to close itself when the user changes language
   * from inside the drawer.
   */
  onSelect?: () => void;
}

export function LanguageSwitcher({
  compact = false,
  onSelect,
}: LanguageSwitcherProps) {
  const { language, setLanguage } = useLanguage();
  const [open, setOpen] = useState(false);
  // Roving-focus index. We initialise it from the active language so
  // the first time the user opens the menu the focus lands on the
  // currently-selected option. While the menu is open, the index is
  // driven entirely by user keyboard navigation; when the menu closes
  // it is recomputed from `language` so the next opening still lands
  // on the right row. We do this synchronously inside `selectAt` /
  // `closeMobile` instead of via a `useEffect` to avoid the
  // cascading-render lint rule (and the actual render cost).
  const initialIndex = Math.max(
    0,
    languages.findIndex((l) => l.code === language),
  );
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = languages.find((l) => l.code === language);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape; restore focus to the trigger so keyboard users
  // don't get stranded inside a hidden dropdown.
  useEffect(() => {
    if (!open) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  // When the dropdown opens, move focus onto the currently-active
  // row so screen readers announce it and keyboard users can pick up
  // from there.
  useEffect(() => {
    if (!open) return;
    // Defer until after the items have rendered.
    const id = requestAnimationFrame(() => {
      itemRefs.current[activeIndex]?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open, activeIndex]);

  const selectAt = useCallback(
    (idx: number) => {
      const lang = languages[idx];
      if (!lang) return;
      setLanguage(lang.code);
      // Keep the roving-focus index on the newly-selected option so
      // the *next* time the menu opens, focus lands on it again. This
      // is the "synchronous" alternative to a useEffect that would
      // re-derive `activeIndex` from `language` whenever it changes.
      setActiveIndex(idx);
      setOpen(false);
      triggerRef.current?.focus();
      onSelect?.();
    },
    [setLanguage, onSelect],
  );

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
    } else if (e.key === "Enter" || e.key === " ") {
      // Native <button> already toggles on Space/Enter; just open the
      // menu and let the active item receive focus.
      e.preventDefault();
      setOpen(true);
    }
  };

  const onListKey = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        const next = (idx + 1) % languages.length;
        setActiveIndex(next);
        itemRefs.current[next]?.focus();
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        const next = (idx - 1 + languages.length) % languages.length;
        setActiveIndex(next);
        itemRefs.current[next]?.focus();
        break;
      }
      case "Home": {
        e.preventDefault();
        setActiveIndex(0);
        itemRefs.current[0]?.focus();
        break;
      }
      case "End": {
        e.preventDefault();
        const last = languages.length - 1;
        setActiveIndex(last);
        itemRefs.current[last]?.focus();
        break;
      }
      case "Enter":
      case " ": {
        e.preventDefault();
        selectAt(idx);
        break;
      }
      default:
        break;
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKey}
        aria-label="Select language"
        aria-haspopup="menu"
        aria-expanded={open}
        className={[
          "inline-flex items-center gap-1.5 rounded-lg border transition-colors",
          compact ? "h-9 px-2 text-sm" : "h-9 px-3 text-sm",
          open
            ? "border-[var(--border)] bg-[var(--background-secondary)] text-[var(--text-primary)]"
            : "border-transparent text-[var(--text-secondary)] hover:border-[var(--border)] hover:bg-[var(--background-secondary)] hover:text-[var(--text-primary)]",
        ].join(" ")}
      >
        <span className="text-base leading-none" aria-hidden="true">
          {current?.flag}
        </span>
        {!compact && (
          <span className="font-medium text-[var(--text-primary)]">
            {current?.name}
          </span>
        )}
        <svg
          width={14}
          height={14}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
          className={`transition-transform ${open ? "rotate-180" : "rotate-0"}`}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Language options"
          className="absolute right-0 z-50 mt-1.5 min-w-[160px] overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-lg"
        >
          {languages.map((lang, idx) => {
            const selected = language === lang.code;
            return (
              <button
                ref={(el) => {
                  itemRefs.current[idx] = el;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                tabIndex={idx === activeIndex ? 0 : -1}
                key={lang.code}
                onClick={() => selectAt(idx)}
                onKeyDown={(e) => onListKey(e, idx)}
                onFocus={() => setActiveIndex(idx)}
                className={[
                  "flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm transition-colors focus-visible:bg-[var(--background-secondary)] focus-visible:outline-none",
                  selected
                    ? "bg-[var(--accent)]/10 font-semibold text-[var(--accent)]"
                    : "text-[var(--text-primary)] hover:bg-[var(--background-secondary)]",
                ].join(" ")}
              >
                <span className="text-base" aria-hidden="true">
                  {lang.flag}
                </span>
                <span className="flex-1">{lang.name}</span>
                {selected && (
                  <svg
                    width={14}
                    height={14}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    className="text-[var(--accent)]"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2.5}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
