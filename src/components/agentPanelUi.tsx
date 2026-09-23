/**
 * Presentational helpers for AgentPanel.
 * Behavior-preserving extract (split-soon / >800 governance).
 */

import React, { useMemo } from 'react';
import { formatCancelInterruptLabel } from '@/store/chat/cancelInterruptVocab';
import { ChatImage } from './ChatImage';

export type SyncedWorkspaceEntry = {
  name: string;
  is_directory: boolean;
  path: string;
  depth: number;
  displayName: string;
};

export function formatCdpHealthLabel(healthOrStatus: string): string {
  return healthOrStatus
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatCdpLaunchLabel(launchMode: string | null | undefined): string | null {
  if (launchMode === 'launch') {
    return 'Launched by PiPi';
  }
  if (launchMode === 'attach') {
    return 'Attached to Existing Chrome';
  }
  return null;
}

export function taskStepDotClassName(status: string): string {
  switch (status) {
    case 'done':
      return 'bg-green-500 text-white';
    case 'running':
      return 'bg-blue-600 text-white shadow-[0_0_8px_rgba(37,99,235,0.3)]';
    case 'cancelling':
      return 'bg-amber-500 text-white shadow-[0_0_8px_rgba(245,158,11,0.3)]';
    case 'validating':
      return 'bg-slate-500 text-white';
    case 'awaiting_confirmation':
      return 'bg-amber-500 text-white';
    case 'approved':
      return 'bg-emerald-500 text-white';
    case 'cancelled':
      return 'bg-slate-400 text-white';
    case 'timed_out':
      return 'bg-orange-500 text-white';
    case 'rejected':
      return 'bg-rose-500 text-white';
    case 'failed':
      return 'bg-red-500 text-white';
    default:
      return 'bg-white border-2 border-gray-100 text-gray-300';
  }
}

export function taskStepLabelClassName(status: string): string {
  switch (status) {
    case 'running':
      return 'text-gray-900 font-bold';
    case 'cancelling':
      return 'text-amber-800 font-bold';
    case 'awaiting_confirmation':
      return 'text-amber-700 font-bold';
    case 'approved':
      return 'text-emerald-700 font-bold';
    case 'validating':
      return 'text-slate-700 font-bold';
    case 'cancelled':
    case 'timed_out':
    case 'rejected':
    case 'failed':
      return 'text-red-600';
    case 'done':
      return 'text-gray-500';
    default:
      return 'text-gray-400';
  }
}

export function cdpStatusDotClassName(status: string): string {
  switch (status) {
    case 'connected':
      return 'bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.5)]';
    case 'connecting':
      return 'bg-yellow-400 animate-pulse';
    case 'error':
      return 'bg-red-400';
    default:
      return 'bg-gray-300';
  }
}

export function skillMatchesActive(
  skill: { id: string; name: string; displayName?: string | null },
  activeSkill: string | null | undefined,
): boolean {
  if (!activeSkill) return false;
  return (
    skill.id === activeSkill ||
    skill.name === activeSkill ||
    (skill.displayName ?? '').toLowerCase() === activeSkill.toLowerCase()
  );
}

export function formatActiveSkillBadgeLabel(activeSkill: string): string {
  if (!activeSkill) return '';
  return activeSkill.charAt(0).toUpperCase() + activeSkill.slice(1);
}

export function combineWorkingFiles<T extends { path: string }>(
  sessionWorkingFiles: T[],
  globalImportedFiles: T[],
): T[] {
  return [
    ...sessionWorkingFiles,
    ...globalImportedFiles.filter((f) => !sessionWorkingFiles.some((sf) => sf.path === f.path)),
  ];
}

export function workingFoldersCountBadge(syncedCount: number, workingCount: number): string | undefined {
  const total = syncedCount + workingCount;
  return total > 0 ? String(total) : undefined;
}

export function footerStatusLabel(taskProgress: Array<{ status: string }>): string {
  if (taskProgress.some((s) => s.status === 'cancelling')) {
    return formatCancelInterruptLabel('cancelling');
  }
  if (taskProgress.some((s) => s.status === 'running')) {
    return 'Processing';
  }
  return 'System Ready';
}

export function findArtifactInMessages(artifactId: string | undefined, messages: any[]): any | null {
  if (!artifactId) return null;
  for (const msg of messages) {
    const found = msg.artifacts?.find((a: any) => a.id === artifactId);
    if (found) return found;
  }
  return null;
}

export function ThinkingPulse() {
  return (
    <div className="flex items-center gap-1.5 mt-1">
      <div className="flex gap-0.5">
        <div className="h-1 w-1 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <div className="h-1 w-1 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
        <div className="h-1 w-1 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
      <span className="text-[9px] text-blue-600 font-bold uppercase tracking-tight">Thinking</span>
    </div>
  );
}

export function CancellingPulse() {
  return (
    <div className="flex items-center gap-1.5 mt-1">
      <div className="flex gap-0.5">
        <div className="h-1 w-1 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <div className="h-1 w-1 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
        <div className="h-1 w-1 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
      <span className="text-[9px] text-amber-600 font-bold uppercase tracking-tight">
        {formatCancelInterruptLabel('cancelling')}
      </span>
    </div>
  );
}

export interface ArtifactRendererProps {
  artifactId?: string;
  messages: any[];
}

/**
 * ArtifactRenderer - Renders specialized artifact types in the side panel
 */
export function ArtifactRenderer({ artifactId, messages }: ArtifactRendererProps) {
  const artifact = useMemo(() => findArtifactInMessages(artifactId, messages), [artifactId, messages]);

  if (!artifact) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-400 opacity-50">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-xs uppercase tracking-widest font-bold">No Artifact Selected</span>
      </div>
    );
  }

  if (artifact.type === 'image' || artifact.type === 'svg') {
    return (
      <div className="h-full flex flex-col">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-tight">{artifact.title || 'Image Artifact'}</h3>
          <span className="text-[9px] font-mono text-gray-300">ID: {artifact.id}</span>
        </div>
        <div className="flex-1 overflow-auto bg-white rounded-xl border border-gray-100 p-2">
          <ChatImage
            src={artifact.content}
            isSVG={artifact.type === 'svg' || artifact.mimeType === 'image/svg+xml'}
            className="w-full"
          />
        </div>
      </div>
    );
  }

  // Fallback for code/html etc.
  return (
    <div className="h-full flex flex-col">
      <div className="mb-2">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-tight">{artifact.title || artifact.type}</h3>
      </div>
      <pre className="flex-1 p-3 bg-gray-900 text-gray-100 rounded-xl font-mono text-[11px] overflow-auto">
        {artifact.content}
      </pre>
    </div>
  );
}
