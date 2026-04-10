import { create } from 'zustand';
import { MCPService } from '../services/mcp';
import type { MCPServer, ServerRuntime, PresetTemplate } from '../services/mcp/types';

interface MCPState {
  // Config
  servers: MCPServer[];
  presets: PresetTemplate[];

  // Runtime
  runtimes: ServerRuntime[];
  loading: boolean;
  error: string | null;

  // UI
  dropdownOpen: boolean;

  // Actions
  loadServers: () => Promise<void>;
  loadPresets: () => Promise<void>;
  refreshRuntimes: () => Promise<void>;
  connectServer: (serverId: string) => Promise<void>;
  disconnectServer: (serverId: string) => Promise<void>;
  reconnectServer: (serverId: string) => Promise<void>;
  addServer: (server: MCPServer) => Promise<void>;
  updateServer: (server: MCPServer) => Promise<void>;
  removeServer: (serverId: string) => Promise<void>;
  setDropdownOpen: (open: boolean) => void;
}

export const useMCPStore = create<MCPState>((set, get) => ({
  servers: [],
  presets: [],
  runtimes: [],
  loading: false,
  error: null,
  dropdownOpen: false,

  loadServers: async () => {
    try {
      const servers = await MCPService.getConfiguredServers();
      set({ servers });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadPresets: async () => {
    try {
      const presets = await MCPService.getPresetTemplates();
      set({ presets });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  refreshRuntimes: async () => {
    try {
      const runtimes = await MCPService.getServerRuntimes();
      set({ runtimes });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  connectServer: async (serverId: string) => {
    set({ loading: true, error: null });
    try {
      const runtime = await MCPService.connectServer(serverId);
      const runtimes = get().runtimes.filter(r => r.id !== serverId);
      runtimes.push(runtime);
      set({ runtimes, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  disconnectServer: async (serverId: string) => {
    try {
      await MCPService.disconnectServer(serverId);
      const runtimes = get().runtimes.filter(r => r.id !== serverId);
      set({ runtimes });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  reconnectServer: async (serverId: string) => {
    set({ loading: true, error: null });
    try {
      const runtime = await MCPService.reconnectServer(serverId);
      const runtimes = get().runtimes.filter(r => r.id !== serverId);
      runtimes.push(runtime);
      set({ runtimes, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  addServer: async (server: MCPServer) => {
    try {
      const added = await MCPService.addServer(server);
      set({ servers: [...get().servers, added] });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  updateServer: async (server: MCPServer) => {
    try {
      const updated = await MCPService.updateServer(server);
      set({ servers: get().servers.map(s => s.id === updated.id ? updated : s) });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  removeServer: async (serverId: string) => {
    try {
      await MCPService.removeServer(serverId);
      set({
        servers: get().servers.filter(s => s.id !== serverId),
        runtimes: get().runtimes.filter(r => r.id !== serverId),
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  setDropdownOpen: (open: boolean) => set({ dropdownOpen: open }),
}));
