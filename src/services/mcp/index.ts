import { invoke } from '@tauri-apps/api/core';
import type { MCPServer, ServerRuntime, MCPTool, MCPResource, ToolResult, PresetTemplate, NormalizedMCPTool } from './types';
import { normalizeTool } from './toolNormalizer';

export type { MCPServer, ServerRuntime, MCPTool, MCPResource, ToolResult, PresetTemplate, NormalizedMCPTool };
export { normalizeTool, parseMCPToolName } from './toolNormalizer';

/**
 * MCP Service — frontend API wrapper for Tauri MCP commands
 */
export const MCPService = {
  // ---------------------------------------------------------------------------
  // Connection Management
  // ---------------------------------------------------------------------------

  async connectServer(serverId: string): Promise<ServerRuntime> {
    return invoke<ServerRuntime>('mcp_connect_server', { serverId });
  },

  async disconnectServer(serverId: string): Promise<void> {
    return invoke<void>('mcp_disconnect_server', { serverId });
  },

  async disconnectAll(): Promise<void> {
    return invoke<void>('mcp_disconnect_all');
  },

  async reconnectServer(serverId: string): Promise<ServerRuntime> {
    return invoke<ServerRuntime>('mcp_reconnect_server', { serverId });
  },

  async getServerRuntimes(): Promise<ServerRuntime[]> {
    return invoke<ServerRuntime[]>('mcp_get_server_runtimes');
  },

  // ---------------------------------------------------------------------------
  // Tools
  // ---------------------------------------------------------------------------

  async listTools(serverId: string): Promise<MCPTool[]> {
    return invoke<MCPTool[]>('mcp_list_tools', { serverId });
  },

  async listAllTools(): Promise<[string, MCPTool[]][]> {
    return invoke<[string, MCPTool[]][]>('mcp_list_all_tools');
  },

  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    return invoke<ToolResult>('mcp_call_tool', { serverId, toolName, args });
  },

  /**
   * Get all tools from connected servers, normalized for the agent tool system.
   */
  async getNormalizedTools(runtimes: ServerRuntime[]): Promise<NormalizedMCPTool[]> {
    const connected = runtimes.filter(s => s.status === 'connected');
    const tools: NormalizedMCPTool[] = [];
    for (const server of connected) {
      const mcpTools = await invoke<MCPTool[]>('mcp_list_tools', { serverId: server.id });
      for (const tool of mcpTools) {
        tools.push(normalizeTool(server.name, tool));
      }
    }
    return tools;
  },

  // ---------------------------------------------------------------------------
  // Resources
  // ---------------------------------------------------------------------------

  async listResources(serverId: string): Promise<MCPResource[]> {
    return invoke<MCPResource[]>('mcp_list_resources', { serverId });
  },

  async readResource(serverId: string, uri: string): Promise<string> {
    return invoke<string>('mcp_read_resource', { serverId, uri });
  },

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  async getConfiguredServers(): Promise<MCPServer[]> {
    return invoke<MCPServer[]>('mcp_get_configured_servers');
  },

  async addServer(server: MCPServer): Promise<MCPServer> {
    return invoke<MCPServer>('mcp_add_server', { server });
  },

  async updateServer(server: MCPServer): Promise<MCPServer> {
    return invoke<MCPServer>('mcp_update_server', { server });
  },

  async removeServer(serverId: string): Promise<void> {
    return invoke<void>('mcp_remove_server', { serverId });
  },

  async getPresetTemplates(): Promise<PresetTemplate[]> {
    return invoke<PresetTemplate[]>('mcp_get_preset_templates');
  },
};
