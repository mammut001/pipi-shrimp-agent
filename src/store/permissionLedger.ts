import type { PermissionLedgerEntry, PermissionRequest } from '../types/ui';

const MAX_PERMISSION_INPUT_PREVIEW = 500;
export const PERMISSION_LEDGER_LIMIT = 80;

export function createPermissionRequest(input: PermissionRequest): PermissionRequest {
  return {
    ...input,
    requestedAt: input.requestedAt ?? Date.now(),
  };
}

export function createPermissionLedgerEntry(
  request: PermissionRequest,
  decision: PermissionLedgerEntry['decision'],
  resolvedAt = Date.now(),
): PermissionLedgerEntry {
  return {
    id: request.id,
    toolName: request.toolName,
    description: request.description,
    decision,
    requestedAt: request.requestedAt ?? resolvedAt,
    resolvedAt,
    toolInputPreview: request.toolInput.slice(0, MAX_PERMISSION_INPUT_PREVIEW),
    toolInputLength: request.toolInput.length,
  };
}

export function prependPermissionLedgerEntry(
  ledger: PermissionLedgerEntry[],
  entry: PermissionLedgerEntry,
): PermissionLedgerEntry[] {
  return [entry, ...ledger.filter((item) => item.id !== entry.id)].slice(0, PERMISSION_LEDGER_LIMIT);
}
