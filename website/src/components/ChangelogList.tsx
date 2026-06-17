"use client";

import Image from "next/image";
import { useState, useTransition, useMemo } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  CHANGELOG_REVALIDATE_SECONDS,
  GITHUB_COMMITS_PAGE_URL,
  type ChangelogCommit,
  type ChangelogError,
  type ChangelogResult,
} from "@/lib/changelog";

interface ChangelogListProps {
  initialResult: ChangelogResult;
}

const LOCALE_TAG_MAP: Record<string, string> = {
  en: "en-US",
  fr: "fr-FR",
  zh: "zh-CN",
  ko: "ko-KR",
  vi: "vi-VN",
};

function formatDate(iso: string, locale: string) {
  const tag = LOCALE_TAG_MAP[locale] ?? "en-US";
  try {
    return new Date(iso).toLocaleDateString(tag, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function ErrorCard({ reason }: { reason: ChangelogError }) {
  const { t } = useLanguage();
  return (
    <div
      role="alert"
      className="rounded-2xl border border-[var(--border)] bg-[var(--background-secondary)] p-8 text-center"
    >
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent)]/10 text-[var(--accent)]">
        <svg
          className="h-6 w-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.74-3L13.74 4a2 2 0 00-3.48 0L3.33 16a2 2 0 001.74 3z"
          />
        </svg>
      </div>
      <h3 className="mb-2 text-lg font-semibold text-[var(--text-primary)]">
        {t.changelog.errorTitle}
      </h3>
      <p className="mb-6 text-sm text-[var(--text-secondary)]">
        {reason === "rate-limited"
          ? t.changelog.errorRateLimited
          : reason === "timeout"
            ? t.changelog.errorTimeout
            : reason === "network"
              ? t.changelog.errorNetwork
              : t.changelog.errorGeneric}
      </p>
      <a
        href={GITHUB_COMMITS_PAGE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]"
      >
        {t.changelog.viewOnGithub}
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
          />
        </svg>
      </a>
    </div>
  );
}

function EmptyCard() {
  const { t } = useLanguage();
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--background-secondary)] p-8 text-center">
      <p className="text-[var(--text-secondary)]">{t.changelog.empty}</p>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-white p-6">
      <div className="flex items-start gap-4">
        <div className="skeleton h-10 w-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <div className="skeleton h-3 w-40" />
          <div className="skeleton h-4 w-3/4" />
          <div className="skeleton h-3 w-1/2" />
        </div>
        <div className="skeleton h-5 w-14" />
      </div>
    </div>
  );
}

export function ChangelogSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div
      className="space-y-4"
      role="status"
      aria-live="polite"
      aria-label="Loading commits"
    >
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

function CommitCard({
  commit,
  locale,
  viewOnGithubLabel,
}: {
  commit: ChangelogCommit;
  locale: string;
  viewOnGithubLabel: string;
}) {
  return (
    <article className="rounded-xl border border-[var(--border)] bg-white p-5 transition-colors hover:border-[var(--accent)]/50 sm:p-6">
      <div className="flex items-start gap-4">
        <div className="shrink-0">
          {commit.author.avatarUrl ? (
            <Image
              src={commit.author.avatarUrl}
              alt={commit.author.login}
              width={40}
              height={40}
              className="h-10 w-10 rounded-full"
              unoptimized
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--background-secondary)] text-[var(--text-secondary)]">
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[var(--text-secondary)]">
            <span className="font-medium text-[var(--text-primary)]">
              {commit.author.name}
            </span>
            <span aria-hidden="true">·</span>
            <time dateTime={commit.date}>{formatDate(commit.date, locale)}</time>
          </div>
          <p className="mb-2 break-words font-medium text-[var(--text-primary)]">
            {commit.messageTitle}
          </p>
          {commit.messageBody && (
            <p className="mb-3 whitespace-pre-line break-words text-sm text-[var(--text-secondary)]">
              {commit.messageBody}
            </p>
          )}
          <a
            href={commit.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium text-[var(--accent)] transition-colors hover:text-[var(--accent-hover)]"
          >
            {viewOnGithubLabel}
            <svg
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </a>
        </div>

        <div className="shrink-0">
          <code className="rounded bg-[var(--code-background)] px-2 py-1 font-mono text-xs text-[var(--text-secondary)]">
            {commit.sha.slice(0, 7)}
          </code>
        </div>
      </div>
    </article>
  );
}

export function ChangelogList({ initialResult }: ChangelogListProps) {
  const { t, language } = useLanguage();
  const [result, setResult] = useState<ChangelogResult>(initialResult);
  const [isPending, startTransition] = useTransition();

  const lastUpdated = useMemo(() => {
    if (result.status === "ok" && result.commits[0]) {
      return result.commits[0].date;
    }
    return null;
  }, [result]);

  const handleRetry = () => {
    startTransition(async () => {
      try {
        const res = await fetch("/api/changelog", { cache: "no-store" });
        if (!res.ok) {
          // Preserve the structured error reason returned by the
          // server route so the UI can show the right message
          // (rate-limited vs timeout vs network vs upstream). Fall
          // back to "upstream" only if the body is missing or
          // malformed.
          try {
            const body = (await res.json()) as {
              reason?: ChangelogError;
            };
            const reason: ChangelogError =
              body.reason && typeof body.reason === "string"
                ? body.reason
                : "upstream";
            setResult({ status: "error", reason });
          } catch {
            setResult({ status: "error", reason: "upstream" });
          }
          return;
        }
        const data = (await res.json()) as ChangelogResult;
        setResult(data);
      } catch {
        setResult({ status: "error", reason: "network" });
      }
    });
  };

  // While a manual retry is in-flight, swap the existing list out for
  // a skeleton so the user has clear feedback that something is
  // happening. The retry button itself is disabled during this
  // window so they cannot double-fire it.
  if (isPending) {
    return (
      <div data-testid="changelog-list" aria-busy="true">
        <ChangelogSkeleton count={5} />
      </div>
    );
  }

  return (
    <div data-testid="changelog-list">
      {result.status === "ok" && result.commits.length > 0 && (
        <>
          <ul className="space-y-4">
            {result.commits.map((commit) => (
              <li key={commit.sha}>
                <CommitCard
                  commit={commit}
                  locale={language}
                  viewOnGithubLabel={t.changelog.viewOnGithub}
                />
              </li>
            ))}
          </ul>
          <p className="mt-6 text-center text-xs text-[var(--text-secondary)]">
            {t.changelog.cacheHint.replace(
              "{seconds}",
              String(CHANGELOG_REVALIDATE_SECONDS / 60)
            )}
          </p>
        </>
      )}

      {(result.status === "ok" && result.commits.length === 0) ||
      result.status === "empty" ? (
        <EmptyCard />
      ) : null}

      {result.status === "error" && (
        <div className="space-y-4">
          <ErrorCard reason={result.reason} />
          <div className="text-center">
            <button
              type="button"
              onClick={handleRetry}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t.changelog.retry}
            </button>
          </div>
        </div>
      )}

      {lastUpdated && result.status === "ok" && (
        <p className="sr-only" aria-live="polite">
          {`Loaded ${result.commits.length} commits, latest from ${lastUpdated}`}
        </p>
      )}
    </div>
  );
}
