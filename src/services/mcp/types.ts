// =============================================================================
// MCP Configuration Types
// =============================================================================

export type TransportType = 'stdio' | 'http' | 'sse';

export interface StdioConfig {
  transport: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface HttpConfig {
  transport: 'http';
  url: string;
  headers?: Record<string, string>;
  auth?: AuthConfig;
}

export interface SseConfig {
  transport: 'sse';
  url: string;
  headers?: Record<string, string>;
  auth?: AuthConfig;
}

export type ServerConfig = StdioConfig | HttpConfig | SseConfig;

export type AuthConfig =
  | { type: 'bearer'; token: string }
  | { type: 'api_key'; key: string };

export interface MCPServer {
  id: string;
  name: string;
  display_name?: string;
  description?: string;
  config: ServerConfig;
  enabled: boolean;
  tools?: string[];
}

export interface PresetTemplate {
  id: string;
  name: string;
  display_name: string;
  description: string;
  icon: string;
  config: ServerConfig;
}

// =============================================================================
// Runtime State Types
// =============================================================================

export type ServerStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export interface ServerRuntime {
  id: string;
  name: string;
  display_name: string;
  status: ServerStatus;
  tool_count: number;
  resource_count: number;
  error_message?: string;
  connected_at?: number;
}

// =============================================================================
// Tool Types
// =============================================================================

export interface MCPTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

export interface NormalizedMCPTool {
  name: string;           // mcp__serverName__toolName
  serverName: string;
  originalName: string;
  displayName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  isMCP: true;
}

// =============================================================================
// Resource Types
// =============================================================================

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mime_type?: string;
}

export interface ContentBlock {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mime_type?: string;
  uri?: string;
}

export interface ToolResult {
  content: ContentBlock[];
  is_error: boolean;
}
