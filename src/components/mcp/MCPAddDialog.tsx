import { useState, useEffect } from 'react';
import { useMCPStore } from '@/store/mcpStore';
import type { MCPServer, ServerConfig, AuthConfig, PresetTemplate } from '@/services/mcp/types';

interface MCPAddDialogProps {
  open: boolean;
  onClose: () => void;
  editServer?: MCPServer;
}

type Step = 'select' | 'configure';

export function MCPAddDialog({ open, onClose, editServer }: MCPAddDialogProps) {
  const { presets, addServer, updateServer, loadPresets } = useMCPStore();
  const [step, setStep] = useState<Step>(editServer ? 'configure' : 'select');

  // Form state
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [transport, setTransport] = useState<'stdio' | 'http' | 'sse'>('stdio');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [cwd, setCwd] = useState('');
  const [url, setUrl] = useState('');
  const [authType, setAuthType] = useState<'none' | 'bearer' | 'api_key'>('none');
  const [authToken, setAuthToken] = useState('');

  useEffect(() => {
    if (open) loadPresets();
  }, [open]);

  useEffect(() => {
    if (editServer) {
      setStep('configure');
      setName(editServer.name);
      setDisplayName(editServer.display_name || '');
      setDescription(editServer.description || '');
      setTransport(editServer.config.transport);
      if (editServer.config.transport === 'stdio') {
        setCommand(editServer.config.command);
        setArgs((editServer.config.args ?? []).join(' '));
        setCwd(editServer.config.cwd || '');
      } else {
        setUrl(editServer.config.url);
        const auth = editServer.config.auth;
        if (auth?.type === 'bearer') {
          setAuthType('bearer');
          setAuthToken(auth.token || '');
        } else if (auth?.type === 'api_key') {
          setAuthType('api_key');
          setAuthToken(auth.key || '');
        }
      }
    }
  }, [editServer]);

  const handlePresetSelect = (preset: PresetTemplate) => {
    setName(preset.name);
    setDisplayName(preset.display_name);
    setDescription(preset.description);
    setTransport(preset.config.transport);
    if (preset.config.transport === 'stdio') {
      setCommand(preset.config.command);
      setArgs((preset.config.args ?? []).join(' '));
    } else {
      setUrl(preset.config.url);
    }
    setStep('configure');
  };

  const handleSubmit = async () => {
    let config: ServerConfig;
    if (transport === 'stdio') {
      config = {
        transport: 'stdio',
        command,
        args: args.trim() ? args.trim().split(/\s+/) : undefined,
        cwd: cwd.trim() || undefined,
      };
    } else {
      let auth: AuthConfig | undefined;
      if (authType === 'bearer') {
        auth = { type: 'bearer', token: authToken };
      } else if (authType === 'api_key') {
        auth = { type: 'api_key', key: authToken };
      }
      config = {
        transport,
        url,
        auth,
      } as ServerConfig;
    }

    const server: MCPServer = {
      id: editServer?.id || `${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now().toString(36)}`,
      name,
      display_name: displayName || undefined,
      description: description || undefined,
      config,
      enabled: true,
    };

    if (editServer) {
      await updateServer(server);
    } else {
      await addServer(server);
    }
    resetAndClose();
  };

  const resetAndClose = () => {
    setStep('select');
    setName('');
    setDisplayName('');
    setDescription('');
    setTransport('stdio');
    setCommand('');
    setArgs('');
    setCwd('');
    setUrl('');
    setAuthType('none');
    setAuthToken('');
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={resetAndClose}>
      <div
        className="bg-gray-800 border border-gray-700 rounded-lg w-[420px] max-h-[80vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <span className="text-sm font-medium text-gray-200">
            {editServer ? 'Edit Server' : step === 'select' ? 'Add MCP Server' : `Configure ${displayName || name}`}
          </span>
          <button className="text-gray-400 hover:text-white" onClick={resetAndClose}>✕</button>
        </div>

        {/* Content */}
        <div className="p-4">
          {step === 'select' && !editServer && (
            <div className="space-y-2">
              {presets.map(preset => (
                <button
                  key={preset.id}
                  className="w-full flex items-center gap-3 p-3 bg-gray-750 border border-gray-700 rounded-lg hover:bg-gray-700 text-left"
                  onClick={() => handlePresetSelect(preset)}
                >
                  <span className="text-xl">{preset.icon}</span>
                  <div>
                    <div className="text-sm font-medium text-gray-200">{preset.display_name}</div>
                    <div className="text-xs text-gray-500">{preset.description}</div>
                  </div>
                </button>
              ))}
              <button
                className="w-full flex items-center gap-3 p-3 bg-gray-750 border border-gray-700 rounded-lg hover:bg-gray-700 text-left"
                onClick={() => setStep('configure')}
              >
                <span className="text-xl">🔧</span>
                <div>
                  <div className="text-sm font-medium text-gray-200">Custom Server</div>
                  <div className="text-xs text-gray-500">Add any MCP-compatible server</div>
                </div>
              </button>
            </div>
          )}

          {step === 'configure' && (
            <div className="space-y-3">
              {/* Name */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Name</label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                  placeholder="server-name"
                />
              </div>

              {/* Display Name */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Display Name (optional)</label>
                <input
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                  placeholder="My Server"
                />
              </div>

              {/* Transport */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Transport</label>
                <select
                  value={transport}
                  onChange={e => setTransport(e.target.value as 'stdio' | 'http' | 'sse')}
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                >
                  <option value="stdio">Stdio (local process)</option>
                  <option value="http">HTTP</option>
                  <option value="sse">SSE</option>
                </select>
              </div>

              {/* Stdio fields */}
              {transport === 'stdio' && (
                <>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Command</label>
                    <input
                      value={command}
                      onChange={e => setCommand(e.target.value)}
                      className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                      placeholder="npx -y @excalidraw/mcp-server"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Arguments (space-separated)</label>
                    <input
                      value={args}
                      onChange={e => setArgs(e.target.value)}
                      className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                      placeholder="--arg1 --arg2"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Working Directory (optional)</label>
                    <input
                      value={cwd}
                      onChange={e => setCwd(e.target.value)}
                      className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                      placeholder="/path/to/project"
                    />
                  </div>
                </>
              )}

              {/* HTTP/SSE fields */}
              {(transport === 'http' || transport === 'sse') && (
                <>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">URL</label>
                    <input
                      value={url}
                      onChange={e => setUrl(e.target.value)}
                      className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                      placeholder="https://api.example.com/mcp"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Authentication</label>
                    <select
                      value={authType}
                      onChange={e => setAuthType(e.target.value as 'none' | 'bearer' | 'api_key')}
                      className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                    >
                      <option value="none">None</option>
                      <option value="bearer">Bearer Token</option>
                      <option value="api_key">API Key</option>
                    </select>
                  </div>
                  {authType !== 'none' && (
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">
                        {authType === 'bearer' ? 'Token' : 'API Key'}
                      </label>
                      <input
                        type="password"
                        value={authToken}
                        onChange={e => setAuthToken(e.target.value)}
                        className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                        placeholder={authType === 'bearer' ? 'ghp_xxxx...' : 'key_xxxx...'}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-700">
          {step === 'configure' && !editServer && (
            <button
              className="px-3 py-1.5 text-xs text-gray-400 hover:text-white"
              onClick={() => {
                setStep('select');
                  }}
            >
              Back
            </button>
          )}
          <button
            className="px-3 py-1.5 text-xs text-gray-400 hover:text-white"
            onClick={resetAndClose}
          >
            Cancel
          </button>
          {step === 'configure' && (
            <button
              className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50"
              disabled={!name.trim() || (transport === 'stdio' ? !command.trim() : !url.trim())}
              onClick={handleSubmit}
            >
              {editServer ? 'Save' : 'Add Server'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
