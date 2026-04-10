import { useCallback } from 'react';
import { useMCPStore } from '@/store/mcpStore';
import { MCPService, parseMCPToolName } from '@/services/mcp';
import type { NormalizedMCPTool, ToolResult } from '@/services/mcp/types';

/**
 * useMCP — React hook for consuming MCP state and calling MCP tools.
 *
 * Usage:
 *   const { connectedCount, isAnyConnecting, normalizedTools, callTool } = useMCP();
 */
export function useMCP() {
  const store = useMCPStore();

  const connectedCount = store.runtimes.filter(r => r.status === 'connected').length;
  const isAnyConnecting = store.runtimes.some(r => r.status === 'connecting');
  const hasError = store.runtimes.some(r => r.status === 'error');
  const isConnected = connectedCount > 0;

  /**
   * Get all normalized tools from currently connected servers.
   * Pulls from the cached runtime tool counts — fetches live from backend.
   */
  const getNormalizedTools = useCallback(async (): Promise<NormalizedMCPTool[]> => {
    return MCPService.getNormalizedTools(store.runtimes);
  }, [store.runtimes]);

  /**
   * Call an MCP tool by its normalized name (mcp__serverName__toolName).
   * Automatically resolves the server ID from the server registry.
   */
  const callTool = useCallback(
    async (normalizedName: string, args: Record<string, unknown>): Promise<ToolResult> => {
      const parsed = parseMCPToolName(normalizedName);
      if (!parsed) {
        throw new Error(`Invalid MCP tool name: ${normalizedName}`);
      }

      // Find server by name among connected runtimes
      const runtime = store.runtimes.find(
        r => r.name === parsed.serverName && r.status === 'connected',
      );
      if (!runtime) {
        throw new Error(
          `MCP server '${parsed.serverName}' is not connected`,
        );
      }

      return MCPService.callTool(runtime.id, parsed.toolName, args);
    },
    [store.runtimes],
  );

  return {
    // State
    runtimes: store.runtimes,
    servers: store.servers,
    connectedCount,
    isAnyConnecting,
    hasError,
    isConnected,
    loading: store.loading,
    error: store.error,

    // Actions
    connectServer: store.connectServer,
    disconnectServer: store.disconnectServer,
    refreshRuntimes: store.refreshRuntimes,
    loadServers: store.loadServers,

    // Tools
    getNormalizedTools,
    callTool,
  };
}
