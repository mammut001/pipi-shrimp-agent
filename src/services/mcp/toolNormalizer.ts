import type { MCPTool, NormalizedMCPTool } from './types';

const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_');

/**
 * Normalize an MCP tool into the standard tool format used by the agent.
 * Name format: mcp__<serverName>__<toolName>
 */
export function normalizeTool(serverName: string, tool: MCPTool): NormalizedMCPTool {
  return {
    name: `mcp__${sanitize(serverName)}__${sanitize(tool.name)}`,
    serverName,
    originalName: tool.name,
    displayName: tool.name.replace(/_/g, ' '),
    description: tool.description || '',
    inputSchema: tool.input_schema || {},
    isMCP: true,
  };
}

/**
 * Parse a normalized MCP tool name back into server + tool name.
 */
export function parseMCPToolName(name: string): { serverName: string; toolName: string } | null {
  const match = name.match(/^mcp__([^_]+(?:_[^_]+)*)__(.+)$/);
  if (!match) return null;
  return { serverName: match[1], toolName: match[2] };
}
