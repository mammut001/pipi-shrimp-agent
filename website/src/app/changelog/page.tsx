"use client";

import { useState, useEffect } from "react";
import { useLanguage } from "@/contexts/LanguageContext";

interface Commit {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      date: string;
    };
  };
  author: {
    login: string;
    avatar_url: string;
  } | null;
}

const GITHUB_REPO = "mammut001/pipi-shrimp-agent";

export default function ChangelogPage() {
  const { t } = useLanguage();
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchCommits() {
      try {
        const response = await fetch(
          `https://api.github.com/repos/${GITHUB_REPO}/commits?per_page=20`
        );
        if (!response.ok) {
          throw new Error("Failed to fetch commits");
        }
        const data = await response.json();
        setCommits(data);
      } catch (err) {
        setError(t.changelog.error);
      } finally {
        setLoading(false);
      }
    }

    fetchCommits();
  }, [t.changelog.error]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  return (
    <div className="page-enter stack-reset">
      {/* Hero Section */}
      <section className="section-padding bg-secondary pt-32">
        <div className="max-w-[1200px] mx-auto px-6">
          <h1 className="text-4xl md:text-5xl font-bold text-[var(--text-primary)] mb-6">
            {t.changelog.title}
          </h1>
          <p className="text-lg text-[var(--text-secondary)]">
            {t.changelog.subtitle}
          </p>
        </div>
      </section>

      {/* Changelog List */}
      <section className="section-padding">
        <div className="max-w-[1200px] mx-auto px-6">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="flex items-center gap-3 text-[var(--text-secondary)]">
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                {t.changelog.loading}
              </div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-[var(--accent)]">{error}</div>
            </div>
          ) : (
            <div className="space-y-6">
              {commits.map((commit, index) => (
                <div
                  key={commit.sha}
                  className="p-6 bg-white rounded-xl border border-[var(--border)] hover:border-[var(--accent)] transition-colors"
                >
                  <div className="flex items-start gap-4">
                    {/* Avatar */}
                    <div className="flex-shrink-0">
                      {commit.author ? (
                        <img
                          src={commit.author.avatar_url}
                          alt={commit.author.login}
                          className="w-10 h-10 rounded-full"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-[var(--background-secondary)] flex items-center justify-center">
                          <svg className="w-5 h-5 text-[var(--text-secondary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                        </div>
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-sm text-[var(--text-secondary)]">
                          {commit.commit.author.name}
                        </span>
                        <span className="text-sm text-[var(--text-secondary)]">
                          · {formatDate(commit.commit.author.date)}
                        </span>
                      </div>
                      <p className="text-[var(--text-primary)] font-medium mb-3 break-words">
                        {commit.commit.message.split("\n")[0]}
                      </p>
                      {commit.commit.message.split("\n").length > 1 && (
                        <p className="text-sm text-[var(--text-secondary)] mb-3 break-words">
                          {commit.commit.message.split("\n").slice(1).join("\n").trim()}
                        </p>
                      )}
                      <a
                        href={`https://github.com/${GITHUB_REPO}/commit/${commit.sha}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors"
                      >
                        {t.changelog.viewOnGithub}
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    </div>

                    {/* Commit hash */}
                    <div className="flex-shrink-0">
                      <code className="text-xs font-mono text-[var(--text-secondary)] bg-[var(--code-background)] px-2 py-1 rounded">
                        {commit.sha.slice(0, 7)}
                      </code>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
