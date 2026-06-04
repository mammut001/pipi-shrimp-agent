/**
 * AutoResearchPatchGateArtifacts
 *
 * Renders the v2 harness artifacts for one self-improve iteration:
 *   - result.json
 *   - diff.patch
 *   - events.jsonl / run.jsonl
 *   - logs/verify-*.stdout.log + stderr.log
 *   - apply.md
 *   - revert.md
 *
 * Surfaces a `PatchGateStatusCard` summary on top. The actual file buttons
 * delegate to `onOpenArtifact` (provided by the host); the harness does
 * not auto-apply patches.
 */

import { useMemo, type ReactNode } from 'react';
import { openFileExternal } from '@/services/docService';

export interface PatchGateArtifactEntry {
  /** Display label, e.g. "diff.patch". */
  label: string;
  /** Absolute path on the local/remote filesystem. */
  path: string;
  /** What this artifact is for, used in the title attribute. */
  description: string;
  /** Whether the artifact is required for the patch gate. */
  required?: boolean;
}

export interface AutoResearchPatchGateArtifactsProps {
  /** All artifact paths from the iteration record. */
  artifactPaths?: string[];
  /** Optional explicit artifact list (overrides derivation from artifactPaths). */
  artifacts?: PatchGateArtifactEntry[];
  /** Optional callback for opening an artifact. Defaults to `openFileExternal`. */
  onOpenArtifact?: (path: string) => void;
  /** Optional: render compactly (e.g. inside a row). */
  compact?: boolean;
  /** Optional: render a status card summary when parsedMetrics are provided. */
  renderStatusCard?: () => ReactNode;
  className?: string;
}

const KNOWN_ARTIFACTS: Array<{ match: RegExp; label: string; description: string; required?: boolean }> = [
  { match: /\/result\.json$/, label: 'result.json', description: 'Structured SelfImproveResult v2 (or auto-upgraded v1).', required: true },
  { match: /\/diff\.patch$/, label: 'diff.patch', description: 'Unified diff between iteration checkout and baseline.', required: true },
  { match: /\/events\.jsonl$/, label: 'events.jsonl', description: 'JSONL event log (canonical name used by the UI loop).' },
  { match: /\/run\.jsonl$/, label: 'run.jsonl', description: 'JSONL event log (canonical name used by the headless runner).' },
  { match: /\/apply\.md$/, label: 'apply.md', description: 'Manual apply instructions with diff preview.' },
  { match: /\/revert\.md$/, label: 'revert.md', description: 'Revert instructions (`git apply -R`).' },
  { match: /\/logs\/?$/, label: 'logs/', description: 'Per-command verification stdout/stderr logs.' },
];

function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  return trimmed.split(/[\\/]/).filter(Boolean).pop() || trimmed || 'artifact';
}

function deriveArtifactEntries(artifactPaths: string[] | undefined): PatchGateArtifactEntry[] {
  if (!artifactPaths || artifactPaths.length === 0) return [];
  const entries: PatchGateArtifactEntry[] = [];
  for (const fullPath of artifactPaths) {
    const known = KNOWN_ARTIFACTS.find((a) => a.match.test(fullPath));
    if (known) {
      entries.push({ label: known.label, path: fullPath, description: known.description, required: known.required });
    } else {
      entries.push({ label: basename(fullPath), path: fullPath, description: 'Iteration artifact.' });
    }
  }
  // Stable order: known ones first, then unknown.
  const knownLabels = new Set(KNOWN_ARTIFACTS.map((a) => a.label));
  return entries.sort((a, b) => {
    const aKnown = knownLabels.has(a.label);
    const bKnown = knownLabels.has(b.label);
    if (aKnown && !bKnown) return -1;
    if (bKnown && !aKnown) return 1;
    return a.label.localeCompare(b.label);
  });
}

export function AutoResearchPatchGateArtifacts({
  artifactPaths,
  artifacts,
  onOpenArtifact,
  compact,
  renderStatusCard,
  className = '',
}: AutoResearchPatchGateArtifactsProps) {
  const entries = useMemo(
    () => artifacts ?? deriveArtifactEntries(artifactPaths),
    [artifacts, artifactPaths],
  );
  if (entries.length === 0) {
    return null;
  }

  const handleClick = (path: string) => {
    if (onOpenArtifact) {
      onOpenArtifact(path);
      return;
    }
    void openFileExternal(path);
  };

  return (
    <div className={`rounded-lg border border-gray-200 bg-white p-3 space-y-2 ${className}`}>
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-700">
          Patch Gate Artifacts
        </h4>
        <span className="text-[10px] text-gray-500">
          {entries.filter((e) => e.required).length}/{entries.length} required
        </span>
      </div>
      {renderStatusCard?.()}
      <div className={`grid ${compact ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2'} gap-1.5`}>
        {entries.map((entry) => (
          <button
            key={`${entry.label}:${entry.path}`}
            type="button"
            onClick={() => handleClick(entry.path)}
            title={`${entry.description}\n${entry.path}`}
            className="group flex items-center justify-between gap-2 rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-left text-[11px] hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
          >
            <span className="font-mono font-semibold text-gray-700 group-hover:text-indigo-700">{entry.label}</span>
            <span className="text-[10px] text-gray-500 truncate">{basename(entry.path) === entry.label ? '' : basename(entry.path)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export { deriveArtifactEntries as derivePatchGateArtifactEntries };
