/**
 * AutoResearchPatchGateStatusCard
 *
 * Renders the v2 result summary for one self-improve iteration.
 * Sources its data from `parsedMetrics` (already in the iteration record
 * via the v2-aware loop engine) and falls back to v1 fields when the
 * iteration was parsed from a legacy result.
 *
 * Preference order:
 *   1. v2 fields (`issue.*`, `patch.*`, `verification[]`, `workspace.*`, `decision.*`)
 *   2. v1 fields (`buildPassed`, `testsPassed`, `typecheckPassed`, etc.)
 *
 * The `sourceSchema` field in `parsedMetrics` (set to 1 or 2 by the loop
 * engine) drives the "Source" badge in the header.
 */

import { useMemo } from 'react';
import type { AutoResearchIterationRecord } from '@/services/autoresearch/history';

export interface AutoResearchPatchGateStatusCardProps {
  iteration: Pick<AutoResearchIterationRecord, 'index' | 'status' | 'parsedMetrics' | 'change' | 'reasoning'>;
  className?: string;
}

type BoolLike = boolean | null | 'unknown' | undefined;

function asBool(value: unknown): boolean | null {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  if (value === 'unknown' || value === null || value === undefined) return null;
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function statusBadgeClass(status: string | undefined): string {
  switch (status) {
    case 'IMPROVED': return 'bg-green-100 text-green-700';
    case 'NO_CHANGE': return 'bg-gray-100 text-gray-600';
    case 'NEEDS_REVIEW': return 'bg-amber-100 text-amber-700';
    case 'FAILED': return 'bg-red-100 text-red-700';
    default: return 'bg-gray-100 text-gray-500';
  }
}

function riskBadgeClass(risk: string | undefined): string {
  switch (risk) {
    case 'low': return 'bg-blue-100 text-blue-700';
    case 'medium': return 'bg-amber-100 text-amber-700';
    case 'high': return 'bg-red-100 text-red-700';
    default: return 'bg-gray-100 text-gray-500';
  }
}

export function AutoResearchPatchGateStatusCard({ iteration, className = '' }: AutoResearchPatchGateStatusCardProps) {
  const pm = iteration.parsedMetrics ?? {};
  const sourceSchema = typeof pm.sourceSchema === 'number' ? pm.sourceSchema : 1;
  const status = (pm.decisionStatus as string | undefined) ?? iteration.status ?? 'unknown';
  const riskLevel = (pm.riskLevel as string | undefined) ?? 'low';

  // v2-aware fields
  const issueSummary = (pm.issueSummary as string | undefined) ?? null;
  const issueCategory = (pm.issueCategory as string | undefined) ?? null;
  const issueSeverity = (pm.issueSeverity as string | undefined) ?? null;
  const patchDiffPath = (pm.patchDiffPath as string | undefined) ?? null;
  const patchAdded = asNumber(pm.patchAddedLines);
  const patchDeleted = asNumber(pm.patchDeletedLines);
  const patchReverted = pm.patchReverted === true;
  const dirtyBefore = pm.dirtyBefore === true;
  const dirtyAfter = pm.dirtyAfter === true;
  const verificationCount = asNumber(pm.verificationCount);
  const verificationFailures = asNumber(pm.verificationFailures);
  const decisionStatus = (pm.decisionStatus as string | undefined) ?? null;
  const decisionScore = asNumber(pm.decisionScore);

  // v1 fields (also used as fallback for v2)
  const buildPassed = asBool(pm.buildPassed);
  const testsPassed = asBool(pm.testsPassed);
  const typecheckPassed = asBool(pm.typecheckPassed);

  const changedFiles = useMemo(
    () => (iteration.change ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    [iteration.change],
  );

  return (
    <div className={`rounded-lg border border-emerald-200 bg-emerald-50/30 p-3 space-y-3 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">
          Patch Gate Status
        </h4>
        <div className="flex items-center gap-1.5">
          <span
            data-testid="source-schema-badge"
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${sourceSchema === 2 ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}
            title={`Result was parsed from schemaVersion ${sourceSchema}`}
          >
            v{sourceSchema}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusBadgeClass(status)}`}>
            {status}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${riskBadgeClass(riskLevel)}`}>
            risk: {riskLevel}
          </span>
        </div>
      </div>

      {/* Issue */}
      {issueSummary && (
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Issue</p>
          <p className="text-xs text-gray-800 mt-0.5">{issueSummary}</p>
          {issueCategory && (
            <p className="text-[10px] text-gray-500 mt-0.5">
              Category: <span className="font-mono">{issueCategory}</span>
              {issueSeverity && (
                <span className="ml-2">Severity: <span className="font-mono">{issueSeverity}</span></span>
              )}
            </p>
          )}
        </div>
      )}

      {/* Patch stats */}
      {(patchDiffPath || patchAdded !== null || patchDeleted !== null) && (
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Patch</p>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {patchDiffPath && (
              <span className="rounded-full px-2 py-0.5 text-[10px] font-mono bg-white border border-gray-200 text-gray-700">
                {patchDiffPath}
              </span>
            )}
            {patchAdded !== null && (
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold bg-green-100 text-green-700">
                +{patchAdded} added
              </span>
            )}
            {patchDeleted !== null && (
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold bg-red-100 text-red-700">
                -{patchDeleted} deleted
              </span>
            )}
            {patchReverted && (
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-700">
                reverted
              </span>
            )}
          </div>
        </div>
      )}

      {/* Changed files */}
      {changedFiles.length > 0 && (
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">
            Changed files ({changedFiles.length})
          </p>
          <div className="flex flex-wrap gap-1 mt-1">
            {changedFiles.slice(0, 8).map((file) => (
              <span key={file} className="rounded-full px-2 py-0.5 text-[10px] font-mono bg-white border border-gray-200 text-gray-700">
                {file}
              </span>
            ))}
            {changedFiles.length > 8 && (
              <span className="text-[10px] text-gray-500">+{changedFiles.length - 8} more</span>
            )}
          </div>
        </div>
      )}

      {/* Verification */}
      <div>
        <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1">Verification</p>
        <div className="flex flex-wrap gap-1.5">
          {(['build', 'tests', 'typecheck'] as const).map((kind) => {
            const value = kind === 'build' ? buildPassed : kind === 'tests' ? testsPassed : typecheckPassed;
            const label = kind === 'build' ? 'Build' : kind === 'tests' ? 'Tests' : 'Typecheck';
            const cls = value === true
              ? 'bg-green-100 text-green-700'
              : value === false
                ? 'bg-red-100 text-red-700'
                : 'bg-gray-100 text-gray-500';
            return (
              <span key={kind} className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${cls}`}>
                {label}: {value === true ? 'PASS' : value === false ? 'FAIL' : 'n/a'}
              </span>
            );
          })}
          {verificationCount !== null && (
            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold bg-gray-100 text-gray-700">
              {verificationCount} commands
            </span>
          )}
          {verificationFailures !== null && verificationFailures > 0 && (
            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold bg-red-100 text-red-700">
              {verificationFailures} failure{verificationFailures === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>

      {/* Workspace + decision */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Workspace</p>
          <p className="text-[11px] text-gray-700 mt-0.5">
            dirtyBefore: <span className="font-mono">{String(dirtyBefore)}</span>
            <br />
            dirtyAfter: <span className="font-mono">{String(dirtyAfter)}</span>
          </p>
        </div>
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Decision</p>
          <p className="text-[11px] text-gray-700 mt-0.5">
            status: <span className="font-mono">{decisionStatus ?? status}</span>
            {decisionScore !== null && (
              <>
                <br />
                score: <span className="font-mono">{decisionScore}</span>
              </>
            )}
          </p>
        </div>
      </div>

      {/* Next recommendation (v2) or reasoning (v1) */}
      {(iteration.reasoning || '').trim().length > 0 && (
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Next Recommendation</p>
          <p className="text-[11px] text-gray-700 mt-0.5 whitespace-pre-wrap">{iteration.reasoning}</p>
        </div>
      )}
    </div>
  );
}
