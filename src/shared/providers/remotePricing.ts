/**
 * Remote model pricing — the OpenRouter price table the Rust backend loads
 * (`get_model_pricing_table`) and refreshes (`refresh_model_pricing`).
 *
 * Prices are USD per million tokens, keyed by OpenRouter model id
 * (`anthropic/claude-haiku-4.5`). Provider model names are resolved to those
 * ids here; an unresolvable name has no remote price rather than a guessed one.
 */

export interface RemoteModelPrice {
  in: number;
  out: number;
  cache_read?: number;
  cache_write?: number;
  name?: string;
  canonical_slug?: string;
  context_length?: number;
  retired?: boolean;
}

export interface RemotePricingMeta {
  source: string;
  updated_at: string;
  count: number;
  active_count: number;
  retained_count: number;
}

export interface RemotePricingTable {
  _meta: RemotePricingMeta;
  models: Record<string, RemoteModelPrice>;
}

export interface ResolvedRemotePrice {
  id: string;
  price: RemoteModelPrice;
}

interface PricingIndex {
  byId: Map<string, string>;
  /** Last path segment (`deepseek-v4-flash`) → ids sharing it, active first. */
  bySegment: Map<string, string[]>;
}

let table: RemotePricingTable | null = null;
let index: PricingIndex = { byId: new Map(), bySegment: new Map() };

function buildIndex(models: Record<string, RemoteModelPrice>): PricingIndex {
  const byId = new Map<string, string>();
  const bySegment = new Map<string, string[]>();
  const ids = Object.keys(models).sort((a, b) => (
    Number(Boolean(models[a].retired)) - Number(Boolean(models[b].retired)) || a.localeCompare(b)
  ));
  for (const id of ids) {
    const key = id.toLowerCase();
    byId.set(key, id);
    const slug = models[id].canonical_slug?.toLowerCase();
    if (slug && !byId.has(slug)) {
      byId.set(slug, id);
    }
    const segment = key.slice(key.lastIndexOf('/') + 1);
    bySegment.set(segment, [...(bySegment.get(segment) ?? []), id]);
  }
  return { byId, bySegment };
}

export function setRemotePricingTable(next: RemotePricingTable | null): void {
  table = next && next.models && typeof next.models === 'object' ? next : null;
  index = buildIndex(table?.models ?? {});
}

export function getRemotePricingMeta(): RemotePricingMeta | null {
  return table?._meta ?? null;
}

const DATE_SUFFIX = /-(?:\d{8}|\d{4}-\d{2}-\d{2})$/;

/** Candidate spellings of a provider model name, most specific first. */
function candidateNames(model: string): string[] {
  let name = model.trim().toLowerCase().replace(/\s+/g, '-').replace(/[:-]free$/, '');
  if (!name || name === '<synthetic>') {
    return [];
  }
  const candidates = [name];
  // Gateway prefixes (`vercel/meta/muse-spark`) → also try the trailing ids.
  const parts = name.split('/');
  for (let start = 1; start < parts.length - 1; start += 1) {
    candidates.push(parts.slice(start).join('/'));
  }

  name = name.replace(/-latest$/, '').replace(DATE_SUFFIX, '');
  candidates.push(name);
  if (name.startsWith('claude')) {
    // Anthropic API ids spell versions with dashes (`claude-opus-4-8`,
    // `claude-3-5-sonnet`); OpenRouter uses dots (`claude-opus-4.8`).
    const dotted = name.replace(/(\d+)-(\d+)(?=-|$)/g, '$1.$2');
    candidates.push(`anthropic/${dotted}`, dotted);
  }
  return [...new Set(candidates)];
}

export function resolveRemoteModelPrice(model: string): ResolvedRemotePrice | null {
  if (!table) {
    return null;
  }
  const candidates = candidateNames(model);
  for (const candidate of candidates) {
    const id = index.byId.get(candidate);
    if (id) {
      return { id, price: table.models[id] };
    }
  }
  // Bare names (`deepseek-v4-flash`, `MiniMax-M3`) match the id's last segment.
  for (const candidate of candidates) {
    if (candidate.includes('/')) {
      continue;
    }
    const id = index.bySegment.get(candidate)?.[0];
    if (id) {
      return { id, price: table.models[id] };
    }
  }
  return null;
}
