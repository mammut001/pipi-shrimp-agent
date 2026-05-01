import { describe, expect, it } from '@jest/globals';
import {
  createPermissionLedgerEntry,
  createPermissionRequest,
  prependPermissionLedgerEntry,
  PERMISSION_LEDGER_LIMIT,
} from '../permissionLedger';

describe('permissionLedger', () => {
  it('stamps permission requests with requestedAt when missing', () => {
    const request = createPermissionRequest({
      id: 'perm-1',
      toolName: 'write_file',
      toolInput: '{}',
    });

    expect(request.requestedAt).toEqual(expect.any(Number));
  });

  it('creates bounded permission ledger entries without storing full long inputs', () => {
    const entry = createPermissionLedgerEntry({
      id: 'perm-1',
      toolName: 'write_file',
      toolInput: 'x'.repeat(800),
      requestedAt: 10,
    }, 'approved', 20);

    expect(entry).toEqual({
      id: 'perm-1',
      toolName: 'write_file',
      description: undefined,
      decision: 'approved',
      requestedAt: 10,
      resolvedAt: 20,
      toolInputPreview: 'x'.repeat(500),
      toolInputLength: 800,
    });
  });

  it('deduplicates ledger entries and enforces the retention limit', () => {
    const ledger = Array.from({ length: PERMISSION_LEDGER_LIMIT }, (_, index) => ({
      id: `perm-${index}`,
      toolName: 'tool',
      decision: 'denied' as const,
      requestedAt: index,
      resolvedAt: index,
      toolInputPreview: '',
      toolInputLength: 0,
    }));

    const updated = prependPermissionLedgerEntry(ledger, {
      id: 'perm-5',
      toolName: 'new_tool',
      decision: 'approved',
      requestedAt: 100,
      resolvedAt: 101,
      toolInputPreview: '{}',
      toolInputLength: 2,
    });

    expect(updated).toHaveLength(PERMISSION_LEDGER_LIMIT);
    expect(updated[0]?.id).toBe('perm-5');
    expect(updated.filter((entry) => entry.id === 'perm-5')).toHaveLength(1);
  });
});
