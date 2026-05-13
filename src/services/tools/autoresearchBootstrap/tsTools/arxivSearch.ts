import type { PaperReference } from '@/services/autoresearch/bootstrap/types';

function readTag(entry: string, tag: string): string | undefined {
  const match = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return match?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').trim();
}

export function parseArxivAtomFeed(feed: string): PaperReference[] {
  return feed
    .split(/<entry>/i)
    .slice(1)
    .map((entry) => {
      const id = readTag(entry, 'id');
      const title = readTag(entry, 'title') || 'Untitled arXiv paper';
      const summary = readTag(entry, 'summary');
      const published = readTag(entry, 'published');
      const authors = Array.from(entry.matchAll(/<name>([^<]+)<\/name>/gi)).map((match) => match[1].trim());
      const year = published ? Number.parseInt(published.slice(0, 4), 10) : undefined;
      return {
        source: 'arxiv' as const,
        title,
        authors: authors.length > 0 ? authors : undefined,
        year: Number.isFinite(year) ? year : undefined,
        abstract: summary,
        originalUrl: id,
      };
    });
}