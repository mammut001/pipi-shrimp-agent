import { useState, useEffect } from 'react';
import { MCPService } from '@/services/mcp';
import type { MCPTool } from '@/services/mcp/types';

interface MCPToolListProps {
  serverId: string;
  serverName: string;
  onBack: () => void;
}

export function MCPToolList({ serverId, serverName, onBack }: MCPToolListProps) {
  const [tools, setTools] = useState<MCPTool[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    MCPService.listTools(serverId)
      .then(setTools)
      .catch(() => setTools([]))
      .finally(() => setLoading(false));
  }, [serverId]);

  const filtered = search
    ? tools.filter(t =>
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        t.description?.toLowerCase().includes(search.toLowerCase())
      )
    : tools;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-700">
        <button
          className="text-gray-400 hover:text-white text-sm"
          onClick={onBack}
        >
          ← Back
        </button>
        <span className="text-sm font-medium text-gray-200">
          {serverName} Tools ({tools.length})
        </span>
      </div>

      {/* Search */}
      <div className="px-4 py-2">
        <input
          type="text"
          placeholder="Search tools..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Tool list */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
        {loading && <p className="text-xs text-gray-500 text-center py-4">Loading...</p>}
        {!loading && filtered.length === 0 && (
          <p className="text-xs text-gray-500 text-center py-4">No tools found</p>
        )}
        {filtered.map(tool => (
          <div key={tool.name} className="bg-gray-750 border border-gray-700 rounded p-3">
            <div className="text-sm font-medium text-gray-200">
              📝 {tool.name}
            </div>
            {tool.description && (
              <p className="text-xs text-gray-400 mt-1">{tool.description}</p>
            )}
            {tool.input_schema && typeof tool.input_schema === 'object' && 'properties' in tool.input_schema && (
              <div className="text-xs text-gray-500 mt-1">
                Schema keys: {Object.keys((tool.input_schema as { properties?: Record<string, unknown> }).properties ?? {}).join(', ') || 'none'}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
