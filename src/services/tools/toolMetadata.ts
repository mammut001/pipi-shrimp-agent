import { invoke } from '@tauri-apps/api/core';

export type ToolConcurrencyClass = 'concurrent' | 'serial';

export interface ToolRetryPolicyMetadata {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface ToolRuntimeMetadata {
  name: string;
  description: string;
  isReadOnly: boolean;
  isConcurrencySafe: boolean;
  concurrencyClass: ToolConcurrencyClass;
  requiresWorkspace: boolean;
  permissionClass: string;
  defaultTimeoutMs: number;
  outputByteLimit?: number | null;
  retryPolicy: ToolRetryPolicyMetadata;
  cancellable: boolean;
  emittedEvents: string[];
  inputSchema: Record<string, unknown>;
}

let metadataPromise: Promise<Map<string, ToolRuntimeMetadata>> | null = null;

async function fetchToolRuntimeMetadata(): Promise<Map<string, ToolRuntimeMetadata>> {
  const metadata = await invoke<ToolRuntimeMetadata[]>('get_available_tools', {
    includeRuntimeMetadata: true,
  });
  return new Map(metadata.map((entry) => [entry.name, entry]));
}

/**
 * Load the authoritative scheduling/policy hints from the Rust ToolRegistry.
 * Unknown or legacy frontend-only tools are deliberately absent and therefore
 * fail closed in helpers below.
 */
export function loadToolRuntimeMetadata(): Promise<Map<string, ToolRuntimeMetadata>> {
  metadataPromise ??= fetchToolRuntimeMetadata().catch((error) => {
    metadataPromise = null;
    throw error;
  });
  return metadataPromise;
}

export async function getToolRuntimeMetadata(
  toolName: string,
): Promise<ToolRuntimeMetadata | undefined> {
  return (await loadToolRuntimeMetadata()).get(toolName);
}

export async function toolNamesRequireWorkspace(toolNames: string[]): Promise<boolean> {
  if (toolNames.length === 0) return false;
  const metadata = await loadToolRuntimeMetadata();
  return toolNames.some((name) => metadata.get(name)?.requiresWorkspace === true);
}

/**
 * Partition by Rust-authored metadata. Unknown/legacy tools are serial by
 * default, which keeps browser/MCP/UI-owned tools fail-closed.
 */
export async function partitionToolsByMetadata<T extends { name: string }>(
  tools: T[],
): Promise<{ concurrent: T[]; serial: T[] }> {
  const metadata = await loadToolRuntimeMetadata();
  const concurrent: T[] = [];
  const serial: T[] = [];

  for (const tool of tools) {
    const entry = metadata.get(tool.name);
    if (entry?.concurrencyClass === 'concurrent' && entry.isConcurrencySafe) {
      concurrent.push(tool);
    } else {
      serial.push(tool);
    }
  }

  return { concurrent, serial };
}

/** Test/support hook: force a fresh registry fetch after backend restart. */
export function invalidateToolRuntimeMetadataCache(): void {
  metadataPromise = null;
}
