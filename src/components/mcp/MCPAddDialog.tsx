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

  const inputCls =
    'w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow';
  const labelCls = 'block text-xs font-medium text-gray-700 mb-1';

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 backdrop-blur-[2px]" onClick={resetAndClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-[440px] max-h-[85vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              {editServer ? 'Edit MCP Server' : step === 'select' ? 'Add MCP Server' : `Configure ${displayName || name || 'Server'}`}
            </h2>
            {step === 'select' && !editServer && (
              <p className="text-xs text-gray-500 mt-0.5">Choose a preset or add a custom server</p>
            )}
          </div>
          <button
            className="p-1.5 hover:bg-gray-200 rounded-lg transition-colors text-gray-500 hover:text-gray-800"
            onClick={resetAndClose}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto flex-1">
          {step === 'select' && !editServer && (
            <div className="space-y-2">
              {presets.map(preset => (
                <button
                  key={preset.id}
                  className="w-full flex items-center gap-4 px-4 py-3.5 bg-white border border-gray-200 rounded-xl hover:border-gray-300 hover:bg-gray-50 text-left transition-all group"
                  onClick={() => handlePresetSelect(preset)}
                >
                  <div className="w-10 h-10 flex items-center justify-center bg-gray-100 rounded-lg text-xl shrink-0 group-hover:bg-white transition-colors border border-gray-200">
                    {preset.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900">{preset.display_name}</div>
                    <div className="text-xs text-gray-500 mt-0.5 leading-relaxed">{preset.description}</div>
                  </div>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-400 shrink-0 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                  </svg>
                </button>
              ))}

              {/* Divider */}
              {presets.length > 0 && (
                <div className="flex items-center gap-3 py-1">
                  <div className="flex-1 h-px bg-gray-200" />
                  <span className="text-xs text-gray-400">or</span>
                  <div className="flex-1 h-px bg-gray-200" />
                </div>
              )}

              <button
                className="w-full flex items-center gap-4 px-4 py-3.5 bg-white border border-dashed border-gray-300 rounded-xl hover:border-gray-400 hover:bg-gray-50 text-left transition-all group"
                onClick={() => setStep('configure')}
              >
                <div className="w-10 h-10 flex items-center justify-center bg-gray-100 rounded-lg text-xl shrink-0 group-hover:bg-white transition-colors border border-gray-200">
                  🔧
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-900">Custom Server</div>
                  <div className="text-xs text-gray-500 mt-0.5">Add any MCP-compatible server</div>
                </div>
              </button>
            </div>
          )}

          {step === 'configure' && (
            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className={labelCls}>Name <span className="text-red-500">*</span></label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className={inputCls}
                  placeholder="server-name"
                />
              </div>

              {/* Display Name */}
              <div>
                <label className={labelCls}>Display Name <span className="text-gray-400 font-normal">(optional)</span></label>
                <input
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  className={inputCls}
                  placeholder="My Server"
                />
              </div>

              {/* Transport */}
              <div>
                <label className={labelCls}>Transport</label>
                <select
                  value={transport}
                  onChange={e => setTransport(e.target.value as 'stdio' | 'http' | 'sse')}
                  className={inputCls}
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
                    <label className={labelCls}>Command <span className="text-red-500">*</span></label>
                    <input
                      value={command}
                      onChange={e => setCommand(e.target.value)}
                      className={inputCls}
                      placeholder="npx -y @excalidraw/mcp-server"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Arguments <span className="text-gray-400 font-normal">(space-separated)</span></label>
                    <input
                      value={args}
                      onChange={e => setArgs(e.target.value)}
                      className={inputCls}
                      placeholder="--arg1 --arg2"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Working Directory <span className="text-gray-400 font-normal">(optional)</span></label>
                    <input
                      value={cwd}
                      onChange={e => setCwd(e.target.value)}
                      className={inputCls}
                      placeholder="/path/to/project"
                    />
                  </div>
                </>
              )}

              {/* HTTP/SSE fields */}
              {(transport === 'http' || transport === 'sse') && (
                <>
                  <div>
                    <label className={labelCls}>URL <span className="text-red-500">*</span></label>
                    <input
                      value={url}
                      onChange={e => setUrl(e.target.value)}
                      className={inputCls}
                      placeholder="https://api.example.com/mcp"
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Authentication</label>
                    <select
                      value={authType}
                      onChange={e => setAuthType(e.target.value as 'none' | 'bearer' | 'api_key')}
                      className={inputCls}
                    >
                      <option value="none">None</option>
                      <option value="bearer">Bearer Token</option>
                      <option value="api_key">API Key</option>
                    </select>
                  </div>
                  {authType !== 'none' && (
                    <div>
                      <label className={labelCls}>
                        {authType === 'bearer' ? 'Token' : 'API Key'}
                      </label>
                      <input
                        type="password"
                        value={authToken}
                        onChange={e => setAuthToken(e.target.value)}
                        className={inputCls}
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
        <div className="flex items-center justify-between px-5 py-4 border-t border-gray-200 bg-gray-50 shrink-0">
          <div>
            {step === 'configure' && !editServer && (
              <button
                className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
                onClick={() => setStep('select')}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Back
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded-lg transition-colors"
              onClick={resetAndClose}
            >
              Cancel
            </button>
            {step === 'configure' && (
              <button
                className="px-4 py-2 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                disabled={!name.trim() || (transport === 'stdio' ? !command.trim() : !url.trim())}
                onClick={handleSubmit}
              >
                {editServer ? 'Save Changes' : 'Add Server'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
